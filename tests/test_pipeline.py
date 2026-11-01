"""语音链路里的术语纠错与提示词注入。

处理器住在 ``server.py``（它们只服务 pipeline），这里用 pipecat 的
``run_test`` 把帧真的过一遍，确认接上去之后确实生效。
"""

from __future__ import annotations

import asyncio

import pytest
from pipecat.frames.frames import (
    LLMContextFrame,
    OutputTransportMessageFrame,
    TranscriptionFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import run_test

import app.terms as terms
from server import GlossaryPrompt, TermCorrector, TextOnlyOutput, _apply_system_prompt


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(terms, "data_dir", lambda: tmp_path)
    terms.reset_cache()
    yield terms
    terms.reset_cache()


class _FakeLLM:
    """只保留 GlossaryPrompt 会碰的那几个属性，不联网。"""

    class _Settings:
        system_instruction = "base"

    def __init__(self):
        self._settings = self._Settings()
        self._base_system_instruction = "base"

    def _compose_system_instruction(self):
        self._settings.system_instruction = self._base_system_instruction


# --------------------------------------------------------------------------
# 纠错
# --------------------------------------------------------------------------
def test_transcription_is_corrected_before_the_aggregator(store):
    corrector = TermCorrector()
    down, _ = asyncio.run(
        run_test(
            corrector,
            frames_to_send=[
                TranscriptionFrame(text="我们这季度JGV涨了", user_id="u", timestamp="t")
            ],
        )
    )

    texts = [frame.text for frame in down if isinstance(frame, TranscriptionFrame)]
    assert texts == ["我们这季度GMV涨了"]

    notices = [frame for frame in down if isinstance(frame, OutputTransportMessageFrame)]
    assert notices[0].message["data"]["corrections"] == [{"from": "JGV", "to": "GMV"}]
    assert corrector.hits == [{"from": "JGV", "to": "GMV"}]


def test_transcript_only_keeps_the_corrected_text(store):
    corrector = TermCorrector()
    asyncio.run(
        run_test(
            corrector,
            frames_to_send=[
                TranscriptionFrame(text="JGV 和 ROI", user_id="u", timestamp="t")
            ],
        )
    )
    assert corrector.transcript == ["GMV 和 ROI"]
    assert corrector.raw == ["JGV 和 ROI"]


# --------------------------------------------------------------------------
# 提示词
# --------------------------------------------------------------------------
def test_defined_term_reaches_the_system_prompt(store):
    store.create_term(
        {
            "term": "内部黑话",
            "definition": "团队内部对核心目标的叫法",
            "aliases": ["内部黑化"],
        }
    )
    llm = _FakeLLM()
    processor = GlossaryPrompt(llm, lambda glossary: f"SYS\n{glossary}", ["我们聊聊内部黑化"])
    context = LLMContext([{"role": "user", "content": "第 0 轮"}])

    asyncio.run(run_test(processor, frames_to_send=[LLMContextFrame(context=context)]))

    prompt = llm._settings.system_instruction
    assert prompt.startswith("SYS")
    assert "内部黑话：团队内部对核心目标的叫法" in prompt


def test_term_without_definition_is_not_injected(store):
    store.create_term({"term": "内部黑话", "aliases": ["内部黑化"]})
    llm = _FakeLLM()
    processor = GlossaryPrompt(llm, lambda glossary: f"SYS\n{glossary}", ["我们聊聊内部黑化"])

    asyncio.run(
        run_test(
            processor,
            frames_to_send=[LLMContextFrame(context=LLMContext([{"role": "user", "content": "在吗"}]))],
        )
    )

    assert "内部黑话" not in llm._settings.system_instruction


def test_history_is_trimmed_to_the_recent_turns(store):
    llm = _FakeLLM()
    processor = GlossaryPrompt(llm, lambda glossary: glossary or "SYS", [])
    context = LLMContext([{"role": "user", "content": f"第 {i} 轮"} for i in range(30)])

    asyncio.run(run_test(processor, frames_to_send=[LLMContextFrame(context=context)]))

    assert len(context.messages) == 20
    assert context.messages[-1]["content"] == "第 29 轮"


def test_apply_system_prompt_keeps_composed_instructions():
    """走 _compose_system_instruction，附加指令（回合补全等）不会被冲掉。"""

    class _LLM(_FakeLLM):
        def _compose_system_instruction(self):
            self._settings.system_instruction = self._base_system_instruction + "\n\n附加指令"

    llm = _LLM()
    _apply_system_prompt(llm, "新提示词")
    assert llm._settings.system_instruction == "新提示词\n\n附加指令"


# --------------------------------------------------------------------------
# 流式输出
# --------------------------------------------------------------------------
def _live_text_chain():
    """实时面试那一段：标记不朗读 + 按 token 聚合。"""
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.processors.aggregators.llm_text_processor import LLMTextProcessor
    from pipecat.utils.text.base_text_aggregator import TextType
    from pipecat.utils.text.simple_text_aggregator import SimpleTextAggregator

    return Pipeline(
        [
            TextOnlyOutput(),
            LLMTextProcessor(
                text_aggregator=SimpleTextAggregator(aggregation_type=TextType.TOKEN)
            ),
        ]
    )


def test_live_mode_emits_one_aggregation_per_token():
    """每个 LLM token 都会立刻变成一条 BotOutput，前端才能逐字显示。"""
    from pipecat.frames.frames import AggregatedTextFrame, LLMTextFrame

    down, _ = asyncio.run(
        run_test(
            _live_text_chain(),
            frames_to_send=[
                LLMTextFrame(text="你"),
                LLMTextFrame(text="好"),
                LLMTextFrame(text="，"),
                LLMTextFrame(text="我"),
            ],
        )
    )

    aggregated = [frame for frame in down if isinstance(frame, AggregatedTextFrame)]
    assert [frame.text for frame in aggregated] == ["你", "好", "，", "我"]
    assert all(frame.skip_tts for frame in aggregated)


def test_mock_mode_still_aggregates_by_sentence():
    """模拟面试要朗读，仍然按句输出，不能拆成一字一条。"""
    from pipecat.frames.frames import AggregatedTextFrame, LLMTextFrame
    from pipecat.processors.aggregators.llm_text_processor import LLMTextProcessor

    down, _ = asyncio.run(
        run_test(
            LLMTextProcessor(),
            frames_to_send=[
                LLMTextFrame(text="第一句。"),
                LLMTextFrame(text="第二句。"),
            ],
        )
    )

    aggregated = [frame.text for frame in down if isinstance(frame, AggregatedTextFrame)]
    assert aggregated == ["第一句。", "第二句。"]
