"""SessionRecorder 的帧解析测试：用假帧走一遍观察器，不启动 pipeline。"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    MetricsFrame,
    TranscriptionFrame,
)
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    STTUsage,
    STTUsageMetricsData,
    TTFATMetricsData,
    TTFBMetricsData,
)
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.frame_processor import FrameDirection

import app.sessions as sessions
from app.session_recorder import SessionRecorder


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions, "data_dir", lambda: tmp_path)
    sessions.reset_cache()
    yield sessions
    sessions.reset_cache()


class QaAnswer:
    """只用来验证「问答库直出」的 source 判定。"""


def push(recorder: SessionRecorder, frame, source=None) -> None:
    asyncio.run(
        recorder.on_push_frame(
            FramePushed(
                source=source or object(),
                destination=object(),
                frame=frame,
                direction=FrameDirection.DOWNSTREAM,
                timestamp=0,
            )
        )
    )


def test_recorder_collects_turns_metrics_and_qa(store):
    now = datetime.now(timezone.utc)
    session_id = store.open_session("abc", "live", started_at=now - timedelta(minutes=3))
    recorder = SessionRecorder(
        session_id=session_id,
        role="interviewer",
        record_assistant=True,
        qa_source="QaAnswer",
    )

    push(recorder, TranscriptionFrame(text="先做个自我介绍", user_id="u", timestamp="t"))

    push(recorder, LLMFullResponseStartFrame())
    push(recorder, LLMTextFrame(text="好的，"))
    push(recorder, LLMTextFrame(text="我从最近一段经历说起。"))
    push(recorder, LLMFullResponseEndFrame())

    qa = QaAnswer()
    push(recorder, LLMFullResponseStartFrame(), source=qa)
    push(recorder, LLMTextFrame(text="我在金山云负责控制台优化。"), source=qa)
    push(recorder, LLMFullResponseEndFrame(), source=qa)

    push(
        recorder,
        MetricsFrame(
            data=[
                TTFBMetricsData(processor="llm", value=0.2),
                TTFATMetricsData(
                    processor="llm", ttfat=0.5, ttfb=0.2, thinking_time=0.3
                ),
                LLMUsageMetricsData(
                    processor="llm",
                    value=LLMTokenUsage(
                        prompt_tokens=10, completion_tokens=5, total_tokens=15
                    ),
                ),
                STTUsageMetricsData(
                    processor="stt", value=STTUsage(audio_seconds=2.5)
                ),
            ]
        ),
    )

    metrics = recorder.finish()
    store.finalize_session(session_id, metrics=metrics)

    detail = store.get_session(session_id)
    assert [turn["role"] for turn in detail["turns"]] == [
        "interviewer",
        "ai",
        "ai",
    ]
    assert [turn["source"] for turn in detail["turns"]] == [
        "interviewer_stt",
        "llm",
        "qa",
    ]
    assert detail["turns"][1]["text"] == "好的，我从最近一段经历说起。"
    assert detail["tokens"] == {
        "prompt": 10,
        "completion": 5,
        "total": 15,
        "cacheRead": 0,
    }
    assert detail["ttfbAvgMs"] == 200
    assert detail["ttftAvgMs"] == 500
    assert detail["sttSeconds"] == 2.5
    assert detail["qaHitCount"] == 1


def test_listen_recorder_only_records_candidate(store):
    now = datetime.now(timezone.utc)
    session_id = store.open_session("abc", "live", started_at=now - timedelta(minutes=3))
    recorder = SessionRecorder(
        session_id=session_id,
        role="candidate",
        record_assistant=False,
    )

    push(recorder, TranscriptionFrame(text="我主要负责控制台优化。", user_id="u", timestamp="t"))
    push(recorder, LLMTextFrame(text="这段不应该被记录"))

    store.add_metrics(session_id, **recorder.finish())
    detail = store.get_session(session_id)
    assert [turn["role"] for turn in detail["turns"]] == ["candidate"]
    assert detail["turns"][0]["text"] == "我主要负责控制台优化。"


def test_listen_recorder_still_collects_stt_metrics(store):
    """listen 路不记 AI 文本，但候选人麦克风的 STT 用量必须进历史。"""
    now = datetime.now(timezone.utc)
    session_id = store.open_session("abc", "live", started_at=now - timedelta(minutes=3))
    recorder = SessionRecorder(
        session_id=session_id,
        role="candidate",
        record_assistant=False,
    )

    push(
        recorder,
        MetricsFrame(
            data=[STTUsageMetricsData(processor="stt", value=STTUsage(audio_seconds=2.5))]
        ),
    )
    push(recorder, LLMTextFrame(text="这段不应该被记录"))

    store.add_metrics(session_id, **recorder.finish())
    detail = store.get_session(session_id)
    assert detail["sttSeconds"] == 2.5
    assert detail["turns"] == []
