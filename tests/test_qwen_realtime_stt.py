"""Qwen 实时识别的协议细节（不连网）。"""

import asyncio

from app.services.qwen_realtime_stt import (
    DEFAULT_BASE_URL,
    QwenRealtimeSTTService,
)


def make_service(**overrides):
    values = {
        "api_key": "test-key",
        "base_url": DEFAULT_BASE_URL,
        "model": "qwen3-asr-flash-realtime",
        "language": "zh",
    }
    values.update(overrides)
    return QwenRealtimeSTTService(**values)


def test_endpoint_adds_model_query():
    service = make_service(base_url="wss://example.com/api-ws/v1/realtime")
    assert (
        service._endpoint()
        == "wss://example.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
    )


def test_endpoint_keeps_existing_model_query():
    service = make_service(
        base_url="wss://example.com/api-ws/v1/realtime?model=custom",
        model="qwen3-asr-flash-realtime",
    )
    assert service._endpoint().endswith("model=custom")


def test_completed_event_pushes_final_transcript(monkeypatch):
    service = make_service()
    frames = []

    async def push(frame, direction=None):
        frames.append(frame)

    monkeypatch.setattr(service, "push_frame", push)
    asyncio.run(
        service._handle_event(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "transcript": "请先做一个自我介绍。",
            }
        )
    )

    assert len(frames) == 1
    assert frames[0].text == "请先做一个自我介绍。"
    assert frames[0].finalized is True


def test_partial_event_uses_text_and_stash(monkeypatch):
    service = make_service()
    frames = []

    async def push(frame, direction=None):
        frames.append(frame)

    monkeypatch.setattr(service, "push_frame", push)
    asyncio.run(
        service._handle_event(
            {
                "type": "conversation.item.input_audio_transcription.text",
                "text": "请先做",
                "stash": "一个自我",
            }
        )
    )

    assert len(frames) == 1
    assert frames[0].text == "请先做一个自我"


def test_session_finished_sets_event():
    service = make_service()
    asyncio.run(service._handle_event({"type": "session.finished"}))
    assert service._finished.is_set()
