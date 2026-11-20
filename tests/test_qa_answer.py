"""实时面试的问答库直出与多轮融合。

一条问题走的是这条流转：追问判定 → 检索（融合串 / 单问）→ 直出或放行给 LLM。
这里按节点钉住每一环的判据，因为判据错了不会报错，只会答歪。
"""

from __future__ import annotations

import asyncio
import re

import pytest
from loguru import logger
from pipecat.processors.aggregators.llm_context import LLMContext

import server

LONG_QUESTION = "你们当时是怎么把峰值那段时间的下单链路扛住的"
LONG_REPLY = (
    "我们是靠幂等键落库做的，请求进来先写一张流水表，唯一索引挡住重复。"
    "失败的那部分由对账任务捞出来重放，重放本身也带幂等键，不会二次扣减。"
    "这套上线后重复扣减的工单基本归零了。"
)


def make_answer(threshold: float = 0.75, tracker=None) -> server.QaAnswer:
    return server.QaAnswer(
        {"embedding": {"relevance_threshold": threshold}}, tracker=tracker
    )


class Clock:
    """可控的 monotonic 时钟：追问判据全看时间，测试得能拨动它。"""

    def __init__(self, start: float = 100.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


@pytest.fixture()
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(server.time, "monotonic", fake)
    return fake


@pytest.fixture()
def silence(monkeypatch):
    """让 _handle 直出时的 push_frame 不去要一条真 pipeline。"""
    pushed: list = []

    async def _push(self, frame, direction=None):
        pushed.append(frame)

    monkeypatch.setattr(server.QaAnswer, "push_frame", _push)
    return pushed


# --------------------------------------------------------------------------
# 追问判定（LiveTurnTracker.fusion_reason）
# --------------------------------------------------------------------------


def test_first_question_never_fuses(clock):
    tracker = server.LiveTurnTracker()
    tracker.note_speech()
    assert tracker.fusion_reason("你先自我介绍一下", prev_question="") == ""


def test_cutoff_when_the_previous_answer_is_still_streaming(clock):
    """一句话被断句切成两段：上一答还在出字，新问题就到了。"""
    tracker = server.LiveTurnTracker()
    tracker.note_answer_start()
    tracker.note_speech()
    assert tracker.fusion_reason(LONG_QUESTION, prev_question="上一问") == "cutoff"


def test_window_measures_answer_done_to_question_start(clock):
    """追问的形状是「答完立刻接话」，所以量的是答完到下一问开口。"""
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()  # answer_done_at = 100.0
    clock.now += 2.0
    tracker.note_speech()  # question_started_at = 102.0
    reason = tracker.fusion_reason(LONG_QUESTION, prev_question="上一问")
    assert reason.startswith("window"), reason
    assert "2.0s" in reason


def test_window_misses_when_the_next_question_comes_late(clock):
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 30.0
    tracker.note_speech()
    assert (
        tracker.fusion_reason(
            "你们团队一共多少人，分工是怎么安排的", prev_question="上一问"
        )
        == ""
    )


def test_short_followup_fuses_even_without_a_time_window(clock):
    """追问隔在回答后面，时间窗口早过了；短句本身就是信号。"""
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 30.0
    tracker.note_speech()
    assert tracker.fusion_reason("那并发呢", prev_question="上一问") == "short:4"


def test_brief_reply_followup_fuses_even_without_a_time_window(clock):
    """候选人只回一句就又被追问：答完立刻接话，本身就是追问的形状。"""
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 30.0
    tracker.note_speech()
    reason = tracker.fusion_reason(
        "那次重试是业务代码显式发起的，还是客户端自动重试的？",
        prev_answer="走的是同步扣减，超时会重试。",
        prev_question="上一问",
    )
    assert reason.startswith("brief"), reason


def test_a_full_reply_leaves_the_next_question_alone(clock):
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 30.0
    tracker.note_speech()
    assert (
        tracker.fusion_reason(
            "你们团队一共多少人，分工是怎么安排的",
            prev_answer=LONG_REPLY,
            prev_question="上一问",
        )
        == ""
    )


# --------------------------------------------------------------------------
# 作答层融合：只有切碎 / 连问才把两问并起来作答
# --------------------------------------------------------------------------


def _context(last: str) -> LLMContext:
    return LLMContext(
        [
            {"role": "user", "content": "你们峰值 QPS 是多少"},
            {"role": "assistant", "content": "峰值日订单 40 万。"},
            {"role": "user", "content": last},
        ]
    )


def _no_hits(*args, **kwargs):
    return {"results": []}


def test_cutoff_and_window_merge_both_questions_into_the_ask(
    clock, silence, monkeypatch
):
    monkeypatch.setattr(server.qa_index, "search", _no_hits)
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 2.0
    tracker.note_speech()

    qa = make_answer(tracker=tracker)
    qa._last_question = "你们峰值 QPS 是多少"
    context = _context(LONG_QUESTION)

    assert asyncio.run(qa._handle(context)) is False
    assert (
        context.messages[-1]["content"]
        == f"你们峰值 QPS 是多少\n{LONG_QUESTION}"
    )


def test_genuine_followup_keeps_its_own_question(clock, silence, monkeypatch):
    """真追问不该并起来——并起来会把上一答重说一遍。"""
    monkeypatch.setattr(server.qa_index, "search", _no_hits)
    tracker = server.LiveTurnTracker()
    tracker.note_answer_done()
    clock.now += 30.0
    tracker.note_speech()

    qa = make_answer(tracker=tracker)
    qa._last_question = "你们峰值 QPS 是多少"
    context = _context("那并发呢")

    assert asyncio.run(qa._handle(context)) is False
    assert context.messages[-1]["content"] == "那并发呢"


def test_fusion_never_chains_older_questions(clock, silence, monkeypatch):
    monkeypatch.setattr(server.qa_index, "search", _no_hits)
    tracker = server.LiveTurnTracker()
    qa = make_answer(tracker=tracker)
    qa._last_question = "第二个问题"

    tracker.note_answer_done()
    clock.now += 2.0
    tracker.note_speech()
    context = LLMContext([{"role": "user", "content": "第三个问题是个够长的问题"}])

    asyncio.run(qa._handle(context))
    assert context.messages[-1]["content"] == "第二个问题\n第三个问题是个够长的问题"


# --------------------------------------------------------------------------
# 检索：融合、回退、去重
# --------------------------------------------------------------------------


def test_fused_lookup_falls_back_to_the_single_question(clock, silence, monkeypatch):
    """融合串更长，相似度会被稀释；没命中要退回单问再查一次。"""
    seen: list[str] = []

    def search(query, *args, **kwargs):
        seen.append(query)
        if "\n" in query:
            return {"results": []}
        return {"results": [{"score": 0.93, "answer": "单问命中", "question": "q"}]}

    monkeypatch.setattr(server.qa_index, "search", search)
    tracker = server.LiveTurnTracker()
    qa = make_answer(tracker=tracker)
    qa._last_question = "你们峰值 QPS 是多少"

    tracker.note_answer_done()
    clock.now += 2.0
    tracker.note_speech()

    assert asyncio.run(qa._handle(_context(LONG_QUESTION))) is True
    assert seen == [f"你们峰值 QPS 是多少\n{LONG_QUESTION}", LONG_QUESTION]


def test_fused_lookup_hits_on_the_merged_query(clock, silence, monkeypatch):
    seen: list[str] = []

    def search(query, *args, **kwargs):
        seen.append(query)
        return {"results": [{"score": 0.91, "answer": "融合命中", "question": "q"}]}

    monkeypatch.setattr(server.qa_index, "search", search)
    tracker = server.LiveTurnTracker()
    qa = make_answer(tracker=tracker)
    qa._last_question = "你们峰值 QPS 是多少"

    tracker.note_answer_done()
    clock.now += 2.0
    tracker.note_speech()

    assert asyncio.run(qa._handle(_context(LONG_QUESTION))) is True
    assert seen == [f"你们峰值 QPS 是多少\n{LONG_QUESTION}"]


def test_skips_the_entry_that_was_just_direct_answered(clock, monkeypatch):
    """融合会把相似度拉回上一轮那条；同一条再贴一遍，面试官就听了两遍一样的话。"""

    def search(query, *args, **kwargs):
        return {
            "results": [{"score": 0.95, "answer": "同一个答案", "question": "同一条问题"}]
        }

    monkeypatch.setattr(server.qa_index, "search", search)
    qa = make_answer()

    assert asyncio.run(qa._lookup("问题一")) == "同一个答案"
    assert asyncio.run(qa._lookup("问题二")) is None


# --------------------------------------------------------------------------
# 直出与放行
# --------------------------------------------------------------------------


def test_lookup_skips_keyword_hit_and_picks_vector_hit(monkeypatch):
    result = {
        "results": [
            {"score": 0.0, "answer": "关键词命中的答案", "question": "关键词问题"},
            {"score": 0.96, "answer": "应直出的高相似度答案", "question": "向量问题"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) == "应直出的高相似度答案"


def test_lookup_falls_back_when_only_low_scores(monkeypatch):
    result = {
        "results": [
            {"score": 0.1, "answer": "低分答案", "question": "q1"},
            {"score": 0.2, "answer": "还是低分", "question": "q2"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) is None


def test_lookup_ignores_candidates_without_answer(monkeypatch):
    result = {
        "results": [
            {"score": 0.91, "answer": "  ", "question": "空答案"},
            {"score": 0.80, "answer": "可用答案", "question": "有答案"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) == "可用答案"


def test_direct_answer_is_pushed_out_and_the_llm_is_skipped(
    clock, silence, monkeypatch
):
    monkeypatch.setattr(
        server.qa_index,
        "search",
        lambda *a, **k: {"results": [{"score": 0.9, "answer": "直出", "question": "q"}]},
    )
    pushed = silence
    qa = make_answer()

    assert asyncio.run(qa._handle(_context("你先自我介绍一下"))) is True
    assert [type(frame).__name__ for frame in pushed] == [
        "LLMFullResponseStartFrame",
        "LLMTextFrame",
        "LLMFullResponseEndFrame",
    ]


# --------------------------------------------------------------------------
# 节点日志：一问走完，每一环都要留痕，且共用同一个 trace
# --------------------------------------------------------------------------


@pytest.fixture()
def captured():
    lines: list[str] = []
    sink = logger.add(lambda msg: lines.append(str(msg)), level="INFO")
    yield lines
    logger.remove(sink)


def test_a_turn_leaves_one_node_line_per_stage(clock, silence, monkeypatch, captured):
    """融合 + 落空这条路径：start → fuse → qa.miss（两次）→ 放行。"""
    monkeypatch.setattr(server.qa_index, "search", _no_hits)
    tracker = server.LiveTurnTracker()
    qa = make_answer(tracker=tracker)
    qa._last_question = "你们峰值 QPS 是多少"

    tracker.note_answer_done()
    clock.now += 2.0
    tracker.note_speech()
    asyncio.run(qa._handle(_context(LONG_QUESTION)))

    trace = tracker.trace
    assert trace
    nodes = [
        re.search(r"\[obs\] (\S+)", line).group(1)
        for line in captured
        if "[obs]" in line and f"trace={trace}" in line
    ]
    assert nodes == ["live.turn.start", "live.fuse", "live.qa.miss", "live.qa.miss"]


def test_a_direct_hit_leaves_a_trace_line_per_stage(clock, silence, monkeypatch, captured):
    monkeypatch.setattr(
        server.qa_index,
        "search",
        lambda *a, **k: {"results": [{"score": 0.9, "answer": "直出", "question": "q"}]},
    )
    tracker = server.LiveTurnTracker()
    qa = make_answer(tracker=tracker)

    asyncio.run(qa._handle(_context("你先自我介绍一下")))

    trace = tracker.trace
    nodes = [
        re.search(r"\[obs\] (\S+)", line).group(1)
        for line in captured
        if "[obs]" in line and f"trace={trace}" in line
    ]
    assert nodes == ["live.turn.start", "live.qa.hit", "live.answer.direct"]


def test_each_turn_gets_its_own_trace_id(clock, silence, monkeypatch, captured):
    monkeypatch.setattr(server.qa_index, "search", _no_hits)
    qa = make_answer()

    asyncio.run(qa._handle(_context("你先自我介绍一下")))
    asyncio.run(qa._handle(_context("那你再说说别的")))

    assert qa.tracker.turn == 2
    # 两问各有各的 trace，日志里不能混成一条链。
    seen = {line.split("trace=")[1].split()[0] for line in captured if "trace=" in line}
    assert len(seen) >= 2
