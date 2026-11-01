"""面试历史存储的纯逻辑测试：不启动服务、不碰模型。

每个用例换一个临时目录，避免读写真实的 ``config/sessions.db``。
时间全部由用例注入，不靠 sleep。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

import app.sessions as sessions


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions, "data_dir", lambda: tmp_path)
    sessions.reset_cache()
    yield sessions
    sessions.reset_cache()


def now() -> datetime:
    return datetime.now(timezone.utc)


def test_open_session_reuses_the_open_row(store):
    first = store.open_session("abc", "live", models={"asr": "minimax/asr-1.0"})
    second = store.open_session("abc", "live", models={"llm": "deepseek/flash"})
    assert first == second

    payload = store.get_session(first)
    assert payload["models"]["asr"] == "minimax/asr-1.0"
    assert payload["models"]["llm"] == "deepseek/flash"


def test_open_session_starts_a_new_row_after_finalize(store):
    first = store.open_session("abc", "live", started_at=now() - timedelta(minutes=5))
    store.add_metrics(first, total_tokens=10)
    store.finalize_session(
        first, end_reason="user", ended_at=now() - timedelta(minutes=1)
    )

    second = store.open_session("abc", "live")
    assert second != first


def test_short_sessions_are_dropped(store):
    session_id = store.open_session("abc", "live", started_at=now() - timedelta(seconds=30))
    store.add_turn(session_id, "interviewer", "interviewer_stt", "先做个自我介绍")
    assert store.finalize_session(session_id, ended_at=now()) is None
    assert store.get_session(session_id) is None


def test_finalize_marks_interrupted_without_end_reason(store):
    session_id = store.open_session("abc", "live", started_at=now() - timedelta(minutes=3))
    result = store.finalize_session(session_id, ended_at=now())
    assert result == {"id": session_id, "status": "interrupted", "durationSec": 180}

    detail = store.get_session(session_id)
    assert detail["status"] == "interrupted"
    assert detail["durationSec"] == 180


def test_mark_completed_works_before_and_after_finalize(store):
    before = store.open_session("before", "live", started_at=now() - timedelta(minutes=2))
    assert store.mark_completed("before") is True
    assert store.finalize_session(before, ended_at=now())["status"] == "completed"

    after = store.open_session("after", "mock", started_at=now() - timedelta(minutes=2))
    assert store.finalize_session(after, ended_at=now())["status"] == "interrupted"
    assert store.mark_completed("after") is True
    assert store.get_session(after)["status"] == "completed"


def test_turns_and_qa_counters(store):
    session_id = store.open_session("abc", "live", started_at=now() - timedelta(minutes=5))
    assert store.add_turn(session_id, "interviewer", "interviewer_stt", " 讲一个项目 ")
    assert store.add_turn(session_id, "ai", "qa", "我在金山云负责控制台优化。")
    assert store.add_turn(session_id, "ai", "llm", "补充一点细节。")
    assert store.add_turn(session_id, "candidate", "candidate_stt", "好的。")

    detail = store.get_session(session_id)
    assert detail["turnCount"] == 4
    assert detail["aiTurnCount"] == 2
    assert detail["qaHitCount"] == 1
    assert [turn["source"] for turn in detail["turns"]] == [
        "interviewer_stt",
        "qa",
        "llm",
        "candidate_stt",
    ]
    assert store.add_turn(9999, "ai", "llm", "no session") is False


def test_stats_only_counts_finalized_live_sessions(store):
    started = now() - timedelta(minutes=10)
    live = store.open_session("live-1", "live", started_at=started)
    store.add_turn(live, "ai", "qa", "第一句")
    store.add_turn(live, "ai", "llm", "第二句")
    store.finalize_session(
        live,
        metrics={
            "total_tokens": 100,
            "prompt_tokens": 60,
            "completion_tokens": 40,
            "ttfb_sum_ms": 400,
            "ttfb_count": 2,
            "ttft_sum_ms": 900,
            "ttft_count": 2,
        },
        ended_at=now(),
    )

    mock = store.open_session("mock-1", "mock", started_at=started)
    store.finalize_session(mock, ended_at=now())

    open_row = store.open_session("live-2", "live", started_at=now())

    payload = store.stats()
    assert payload["summary"]["totalSessions"] == 1
    assert payload["summary"]["weekSessions"] == 1
    assert payload["summary"]["totalTokens"] == 100
    assert payload["summary"]["avgTokens"] == 100
    assert payload["summary"]["avgTtfbMs"] == 200
    assert payload["summary"]["avgTtftMs"] == 450
    assert payload["summary"]["qaRatio"] == 0.5
    assert payload["summary"]["totalTurns"] == 2
    assert payload["summary"]["mockSessions"] == 1
    assert payload["summary"]["mockAccuracy"] is None

    days = {day["date"]: day for day in payload["heatmap"]["days"]}
    today = datetime.now().astimezone().date().isoformat()
    assert days[today]["sessions"] == 1
    assert days[today]["tokens"] == 100
    assert open_row != live


def test_corrections_are_kept_and_dismissable(store):
    session_id = store.open_session("abc", "live", started_at=now() - timedelta(minutes=5))
    store.add_corrections(
        session_id,
        [
            {"from": "JGV", "to": "GMV"},
            {"from": "JGV", "to": "GMV"},
        ],
        [{"from": "QWEJ", "to": "QWEK", "reason": "near-miss"}],
    )
    store.finalize_session(session_id, end_reason="user", ended_at=now())

    recent = store.recent_corrections()
    assert recent["corrections"] == [{"from": "JGV", "to": "GMV"}]
    assert recent["suggestions"] == [
        {"from": "QWEJ", "to": "QWEK", "reason": "near-miss"}
    ]
    assert store.get_session(session_id)["corrections"] == [
        {"from": "JGV", "to": "GMV", "kind": "corrected"},
        {"from": "QWEJ", "to": "QWEK", "kind": "suspected"},
    ]

    store.clear_recent_corrections()
    assert store.recent_corrections() == {"corrections": [], "suggestions": []}


def test_list_filters_by_mode_and_pages(store):
    for index in range(3):
        session_id = store.open_session(
            f"live-{index}", "live", started_at=now() - timedelta(minutes=10 - index)
        )
        store.finalize_session(session_id, ended_at=now() - timedelta(minutes=5 - index))
    mock = store.open_session("mock-1", "mock", started_at=now() - timedelta(minutes=10))
    store.finalize_session(mock, ended_at=now() - timedelta(minutes=5))

    everything = store.list_sessions(limit=2)
    assert everything["total"] == 4
    assert len(everything["sessions"]) == 2

    live_only = store.list_sessions(mode="live", limit=10)
    assert live_only["total"] == 3
    assert {item["mode"] for item in live_only["sessions"]} == {"live"}
