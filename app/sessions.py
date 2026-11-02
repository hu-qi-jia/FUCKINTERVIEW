"""面试会话的历史存储（SQLite 单文件）。

一场实时面试由两条 Pipecat 连接组成（面试官那路 + 候选人麦克风那路），
模拟面试只有一条；前端给每次进入面试页生成一个 ``interview_id``，两条
连接都带上它，后端据此把转写、指标和术语纠错拼成同一场。

写入策略：转写按句增量落库（浏览器半路关掉也留得住），指标和收尾在断开
时一次写入。总时长不足 ``MIN_DURATION_SECONDS`` 的会话按误触处理，整行
删除——热力图和历史列表都不该被一次点错的连接污染。
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from app.materials import data_dir

SESSION_FILENAME = "sessions.db"
SCHEMA_VERSION = 1

# 少于一分钟：误触。整场不落库。
MIN_DURATION_SECONDS = 60

# 断线重连时复用「未收尾」记录的时间窗。超过它说明是上次进程退出留下的
# 孤儿行，另起一行，不并进这次面试。
OPEN_REUSE_HOURS = 12

MODES = ("live", "mock")
STATUSES = ("open", "completed", "interrupted")
ROLES = ("interviewer", "candidate", "ai")
SOURCES = ("interviewer_stt", "candidate_stt", "llm", "qa")

HEATMAP_DAYS = 365
MAX_TURN_CHARS = 8000
MAX_CORRECTIONS = 50

_lock = threading.RLock()
_initialised: set[str] = set()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                    INTEGER PRIMARY KEY,
  interview_id          TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('live','mock')),
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','completed','interrupted')),
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  duration_sec          INTEGER,
  end_reason            TEXT,
  profile_id            TEXT,
  profile_name          TEXT,
  asr_model             TEXT,
  llm_model             TEXT,
  tts_model             TEXT,
  prompt_tokens         INTEGER NOT NULL DEFAULT 0,
  completion_tokens     INTEGER NOT NULL DEFAULT 0,
  total_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  ttfb_sum_ms           REAL NOT NULL DEFAULT 0,
  ttfb_count            INTEGER NOT NULL DEFAULT 0,
  ttft_sum_ms           REAL NOT NULL DEFAULT 0,
  ttft_count            INTEGER NOT NULL DEFAULT 0,
  stt_seconds           REAL NOT NULL DEFAULT 0,
  turn_count            INTEGER NOT NULL DEFAULT 0,
  ai_turn_count         INTEGER NOT NULL DEFAULT 0,
  qa_hit_count          INTEGER NOT NULL DEFAULT 0,
  corrections_dismissed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sessions_interview ON sessions(interview_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_started   ON sessions(started_at);

CREATE TABLE IF NOT EXISTS session_turns (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('interviewer','candidate','ai')),
  source     TEXT NOT NULL
             CHECK (source IN ('interviewer_stt','candidate_stt','llm','qa')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_turns_session
  ON session_turns(session_id, created_at, id);

CREATE TABLE IF NOT EXISTS session_corrections (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  from_text  TEXT NOT NULL,
  to_text    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('corrected','suspected'))
);
CREATE INDEX IF NOT EXISTS session_corrections_session
  ON session_corrections(session_id, id);
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _local_today() -> date:
    return datetime.now().astimezone().date()


def db_path() -> Path:
    return data_dir() / SESSION_FILENAME


# --------------------------------------------------------------------------
# 连接
#
# 和 qa.db / terms.db 同一套做法：进程内复用一条连接，所有调用在 _lock 里
# 串行使用。面试记录写入量很小（每句话一行），复用连接足够了。
# --------------------------------------------------------------------------
_shared: sqlite3.Connection | None = None
_shared_path: str | None = None


class _Borrowed:
    """借出的连接：``close()`` 只表示用完了，不真关，留给下次复用。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def close(self) -> None:
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)


def connect() -> sqlite3.Connection:
    """取当前数据目录的连接。同一个库复用同一条，用 ``_lock`` 串行保护。"""
    global _shared, _shared_path
    path = str(db_path())
    if _shared is None or _shared_path != path:
        if _shared is not None:
            _shared.close()
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            target, timeout=10, isolation_level=None, check_same_thread=False
        )
        conn.row_factory = sqlite3.Row
        # foreign_keys 是连接级设置，每次都得设；journal_mode 记在库文件里，
        # 设一次就持久生效，见 _ensure_schema。
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        _ensure_schema(conn)
        _shared, _shared_path = conn, path
    return _Borrowed(_shared)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    key = str(db_path())
    if key in _initialised:
        return
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(SCHEMA_VERSION),),
    )
    _initialised.add(key)


def reset_cache() -> None:
    """数据目录切换后调用：关掉旧连接，下次连接重新建表。"""
    global _shared, _shared_path
    with _lock:
        if _shared is not None:
            _shared.close()
        _shared, _shared_path = None, None
        _initialised.clear()


def migrate_db(source: Path, target: Path) -> bool:
    """把会话库搬到新目录；WAL 模式下用 ``VACUUM INTO`` 导出一份干净副本。"""
    if not source.is_file() or source == target:
        return False
    if target.exists():
        raise ValueError(f"目标目录已存在 {target.name}，请先备份或换一个目录")
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(source))
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()
    reset_cache()
    return True


# --------------------------------------------------------------------------
# 写入
# --------------------------------------------------------------------------
def open_session(
    interview_id: str,
    mode: str,
    *,
    models: dict[str, str | None] | None = None,
    started_at: datetime | None = None,
) -> int:
    """取本场尚未收尾的行；没有就新建。两条连接谁先到都行。

    面试中途断开重连时旧行已经收尾，这里会自然另起一行。
    """
    interview_id = str(interview_id or "").strip()
    if not interview_id:
        raise ValueError("interview_id 不能为空")
    if mode not in MODES:
        raise ValueError(f"未知的会话类型：{mode}")

    now = started_at or _now()
    cutoff = _iso(now - timedelta(hours=OPEN_REUSE_HOURS))
    with _lock:
        conn = connect()
        row = conn.execute(
            "SELECT id FROM sessions "
            "WHERE interview_id = ? AND ended_at IS NULL AND started_at >= ? "
            "ORDER BY started_at DESC, id DESC LIMIT 1",
            (interview_id, cutoff),
        ).fetchone()
        if row:
            if models:
                _update_models(conn, int(row["id"]), models)
            return int(row["id"])

        cursor = conn.execute(
            "INSERT INTO sessions("
            "  interview_id, mode, started_at, asr_model, llm_model, tts_model"
            ") VALUES (?, ?, ?, ?, ?, ?)",
            (
                interview_id,
                mode,
                _iso(now),
                (models or {}).get("asr"),
                (models or {}).get("llm"),
                (models or {}).get("tts"),
            ),
        )
        session_id = int(cursor.lastrowid or 0)
    return session_id


def _update_models(
    conn: sqlite3.Connection, session_id: int, models: dict[str, str | None]
) -> None:
    conn.execute(
        "UPDATE sessions SET "
        "asr_model = COALESCE(?, asr_model), "
        "llm_model = COALESCE(?, llm_model), "
        "tts_model = COALESCE(?, tts_model) "
        "WHERE id = ?",
        (models.get("asr"), models.get("llm"), models.get("tts"), session_id),
    )


def set_profile(session_id: int, profile_id: str | None, profile_name: str | None) -> None:
    """记下这场用的是哪份档案；档案删掉后历史里仍显示当时的名字。"""
    with _lock:
        connect().execute(
            "UPDATE sessions SET profile_id = COALESCE(?, profile_id), "
            "profile_name = COALESCE(?, profile_name) WHERE id = ?",
            (
                str(profile_id).strip() if profile_id else None,
                str(profile_name).strip() if profile_name else None,
                session_id,
            ),
        )


def add_turn(
    session_id: int,
    role: str,
    source: str,
    text: str,
    *,
    created_at: datetime | None = None,
) -> bool:
    """追加一句话；会话已被丢弃（例如不足一分钟）时返回 False。"""
    if role not in ROLES or source not in SOURCES:
        return False
    value = str(text or "").strip()[:MAX_TURN_CHARS]
    if not value:
        return False

    with _lock:
        conn = connect()
        cursor = conn.execute(
            "INSERT INTO session_turns(session_id, role, source, text, created_at) "
            "SELECT ?, ?, ?, ?, ? "
            "WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?)",
            (session_id, role, source, value, _iso(created_at or _now()), session_id),
        )
        if cursor.rowcount == 0:
            return False
        conn.execute(
            "UPDATE sessions SET turn_count = turn_count + 1, "
            "ai_turn_count = ai_turn_count + ?, "
            "qa_hit_count = qa_hit_count + ? WHERE id = ?",
            (
                1 if source in ("llm", "qa") else 0,
                1 if source == "qa" else 0,
                session_id,
            ),
        )
    return True


def add_corrections(
    session_id: int,
    corrections: Iterable[dict[str, Any]],
    suggestions: Iterable[dict[str, Any]] = (),
) -> None:
    """本场纠正过的词和疑似误听，随场次留档。"""
    rows: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for kind, items in (("corrected", corrections), ("suspected", suggestions)):
        for item in items:
            source = str(item.get("from") or "").strip()[:64]
            target = str(item.get("to") or "").strip()[:64]
            if not source or not target or source == target:
                continue
            key = (source, target, kind)
            if key in seen:
                continue
            seen.add(key)
            rows.append((source, target, kind))
            if len(rows) >= MAX_CORRECTIONS:
                break
        if len(rows) >= MAX_CORRECTIONS:
            break
    if not rows:
        return

    with _lock:
        conn = connect()
        if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone():
            return
        conn.executemany(
            "INSERT INTO session_corrections(session_id, from_text, to_text, kind) "
            "VALUES (?, ?, ?, ?)",
            [(session_id, source, target, kind) for source, target, kind in rows],
        )


def add_metrics(
    session_id: int,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    cache_read_tokens: int = 0,
    ttfb_sum_ms: float = 0,
    ttfb_count: int = 0,
    ttft_sum_ms: float = 0,
    ttft_count: int = 0,
    stt_seconds: float = 0,
) -> bool:
    """累加一场会话的指标。候选人那路只有 STT，token 和延迟都是 0。"""
    with _lock:
        conn = connect()
        exists = conn.execute(
            "SELECT 1 FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if exists is None:
            return False
        conn.execute(
            "UPDATE sessions SET "
            "prompt_tokens = prompt_tokens + ?, "
            "completion_tokens = completion_tokens + ?, "
            "total_tokens = total_tokens + ?, "
            "cache_read_tokens = cache_read_tokens + ?, "
            "ttfb_sum_ms = ttfb_sum_ms + ?, ttfb_count = ttfb_count + ?, "
            "ttft_sum_ms = ttft_sum_ms + ?, ttft_count = ttft_count + ?, "
            "stt_seconds = stt_seconds + ? "
            "WHERE id = ?",
            (
                max(0, int(prompt_tokens or 0)),
                max(0, int(completion_tokens or 0)),
                max(0, int(total_tokens or 0)),
                max(0, int(cache_read_tokens or 0)),
                max(0.0, float(ttfb_sum_ms or 0)),
                max(0, int(ttfb_count or 0)),
                max(0.0, float(ttft_sum_ms or 0)),
                max(0, int(ttft_count or 0)),
                max(0.0, float(stt_seconds or 0)),
                session_id,
            ),
        )
    return True


def finalize_session(
    session_id: int,
    *,
    metrics: dict[str, float | int] | None = None,
    end_reason: str | None = None,
    ended_at: datetime | None = None,
) -> dict[str, Any] | None:
    """收尾一场会话；不足一分钟的整行删除并返回 None。"""
    if metrics:
        add_metrics(session_id, **metrics)

    now = ended_at or _now()
    with _lock:
        conn = connect()
        row = conn.execute(
            "SELECT started_at, end_reason FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        started = _parse(row["started_at"]) or now
        duration = max(0, int(round((now - started).total_seconds())))

        if duration < MIN_DURATION_SECONDS:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return None

        # 前端可能在断开之前就上报了「主动结束」，以先到的为准。
        reason = str(end_reason or row["end_reason"] or "").strip() or None
        status = "completed" if reason else "interrupted"
        conn.execute(
            "UPDATE sessions SET ended_at = ?, duration_sec = ?, end_reason = ?, "
            "status = ? WHERE id = ? AND ended_at IS NULL",
            (_iso(now), duration, reason, status, session_id),
        )
        current = conn.execute(
            "SELECT status, duration_sec FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if current is None:
            return None
    return {
        "id": session_id,
        "status": current["status"],
        "durationSec": int(current["duration_sec"] or 0),
    }


def mark_completed(interview_id: str) -> bool:
    """前端主动结束（点断开、切页）时调用。

    正常路径是它先到、服务端收尾时读 ``end_reason``；反过来也行：收尾
    已经跑过，这里把刚写下的 interrupted 改成 completed。
    """
    interview_id = str(interview_id or "").strip()
    if not interview_id:
        return False

    # 面试可能开很久，只更新最近几小时内开始的那一场。
    cutoff = _iso(_now() - timedelta(hours=6))
    with _lock:
        conn = connect()
        row = conn.execute(
            "SELECT id, ended_at FROM sessions WHERE interview_id = ? "
            "AND started_at >= ? ORDER BY started_at DESC, id DESC LIMIT 1",
            (interview_id, cutoff),
        ).fetchone()
        if row is None:
            return False
        session_id = int(row["id"])
        if row["ended_at"] is None:
            conn.execute(
                "UPDATE sessions SET end_reason = 'user' WHERE id = ?", (session_id,)
            )
        else:
            conn.execute(
                "UPDATE sessions SET status = 'completed', end_reason = 'user' "
                "WHERE id = ? AND status = 'interrupted'",
                (session_id,),
            )
    return True


# --------------------------------------------------------------------------
# 读取：历史列表 / 详情 / 统计
# --------------------------------------------------------------------------
_SESSION_COLUMNS = """
  id, interview_id, mode, status, started_at, ended_at, duration_sec,
  profile_id, profile_name, asr_model, llm_model, tts_model,
  prompt_tokens, completion_tokens, total_tokens, cache_read_tokens,
  ttfb_sum_ms, ttfb_count, ttft_sum_ms, ttft_count, stt_seconds,
  turn_count, ai_turn_count, qa_hit_count
"""


def _average(total: float | int, count: float | int) -> float | None:
    return round(float(total) / float(count), 1) if count else None


def _session_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "interviewId": row["interview_id"],
        "mode": row["mode"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "durationSec": int(row["duration_sec"] or 0),
        "profileId": row["profile_id"],
        "profileName": row["profile_name"],
        "models": {
            "asr": row["asr_model"],
            "llm": row["llm_model"],
            "tts": row["tts_model"],
        },
        "tokens": {
            "prompt": int(row["prompt_tokens"] or 0),
            "completion": int(row["completion_tokens"] or 0),
            "total": int(row["total_tokens"] or 0),
            "cacheRead": int(row["cache_read_tokens"] or 0),
        },
        "ttfbAvgMs": _average(row["ttfb_sum_ms"] or 0, row["ttfb_count"] or 0),
        "ttftAvgMs": _average(row["ttft_sum_ms"] or 0, row["ttft_count"] or 0),
        "sttSeconds": round(float(row["stt_seconds"] or 0), 1),
        "turnCount": int(row["turn_count"] or 0),
        "aiTurnCount": int(row["ai_turn_count"] or 0),
        "qaHitCount": int(row["qa_hit_count"] or 0),
    }


def list_sessions(
    *, mode: str | None = None, limit: int = 30, offset: int = 0
) -> dict[str, Any]:
    """历史列表：只返回已经收尾的会话，最新在前。"""
    limit = min(100, max(1, int(limit or 30)))
    offset = max(0, int(offset or 0))
    where = "ended_at IS NOT NULL"
    params: list[Any] = []
    if mode in MODES:
        where += " AND mode = ?"
        params.append(mode)

    with _lock:
        conn = connect()
        total = int(
            conn.execute(f"SELECT COUNT(*) FROM sessions WHERE {where}", params).fetchone()[0]
        )
        rows = conn.execute(
            f"SELECT {_SESSION_COLUMNS} FROM sessions WHERE {where} "
            "ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return {
        "sessions": [_session_dict(row) for row in rows],
        "total": total,
    }


def get_session(session_id: int) -> dict[str, Any] | None:
    with _lock:
        conn = connect()
        row = conn.execute(
            f"SELECT {_SESSION_COLUMNS} FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        turns = conn.execute(
            "SELECT id, role, source, text, created_at FROM session_turns "
            "WHERE session_id = ? ORDER BY created_at, id",
            (session_id,),
        ).fetchall()
        corrections = conn.execute(
            "SELECT from_text, to_text, kind FROM session_corrections "
            "WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()

    payload = _session_dict(row)
    payload["turns"] = [
        {
            "id": int(turn["id"]),
            "role": turn["role"],
            "source": turn["source"],
            "text": turn["text"],
            "createdAt": turn["created_at"],
        }
        for turn in turns
    ]
    payload["corrections"] = [
        {"from": item["from_text"], "to": item["to_text"], "kind": item["kind"]}
        for item in corrections
    ]
    return payload


def stats(*, days: int = HEATMAP_DAYS) -> dict[str, Any]:
    """首页要的热力图和汇总。

    热力图和 token / 延迟汇总只统计实时面试；模拟面试单独计数。模拟报告的
    准确率由后续的报告功能写入 ``mockAccuracy``，目前恒为 None。
    """
    today = _local_today()
    start = today - timedelta(days=max(1, int(days)))
    # 对齐到周一，热力图每一列才是一整周。
    start -= timedelta(days=start.weekday())
    week_start = today - timedelta(days=today.weekday())
    where = "mode = 'live' AND ended_at IS NOT NULL"

    with _lock:
        conn = connect()
        heat_rows = conn.execute(
            "SELECT date(started_at, 'localtime') AS day, COUNT(*) AS sessions, "
            "COALESCE(SUM(total_tokens), 0) AS tokens FROM sessions "
            f"WHERE {where} AND date(started_at, 'localtime') >= ? "
            "GROUP BY day",
            (start.isoformat(),),
        ).fetchall()

        summary = conn.execute(
            "SELECT COUNT(*) AS sessions, "
            "COALESCE(SUM(total_tokens), 0) AS tokens, "
            "COALESCE(SUM(duration_sec), 0) AS duration, "
            "COALESCE(SUM(turn_count), 0) AS turns, "
            "COALESCE(SUM(ai_turn_count), 0) AS ai_turns, "
            "COALESCE(SUM(qa_hit_count), 0) AS qa_hits, "
            "COALESCE(SUM(ttfb_sum_ms), 0) AS ttfb_sum, "
            "COALESCE(SUM(ttfb_count), 0) AS ttfb_count, "
            "COALESCE(SUM(ttft_sum_ms), 0) AS ttft_sum, "
            "COALESCE(SUM(ttft_count), 0) AS ttft_count "
            f"FROM sessions WHERE {where}"
        ).fetchone()

        week_row = conn.execute(
            "SELECT COUNT(*) AS sessions, COALESCE(SUM(total_tokens), 0) AS tokens "
            f"FROM sessions WHERE {where} AND date(started_at, 'localtime') >= ?",
            (week_start.isoformat(),),
        ).fetchone()

        mock_row = conn.execute(
            "SELECT COUNT(*) AS sessions FROM sessions "
            "WHERE mode = 'mock' AND ended_at IS NOT NULL"
        ).fetchone()

    session_count = int(summary["sessions"] or 0)
    return {
        "heatmap": {
            "start": start.isoformat(),
            "end": today.isoformat(),
            "days": [
                {
                    "date": row["day"],
                    "sessions": int(row["sessions"]),
                    "tokens": int(row["tokens"]),
                }
                for row in heat_rows
            ],
        },
        "summary": {
            "totalSessions": session_count,
            "weekSessions": int(week_row["sessions"] or 0),
            "totalTokens": int(summary["tokens"] or 0),
            "avgTokens": _average(summary["tokens"] or 0, session_count),
            "totalDurationSec": int(summary["duration"] or 0),
            "totalTurns": int(summary["turns"] or 0),
            "qaHitCount": int(summary["qa_hits"] or 0),
            "qaRatio": _average(summary["qa_hits"] or 0, summary["ai_turns"] or 0),
            "avgTtfbMs": _average(summary["ttfb_sum"] or 0, summary["ttfb_count"] or 0),
            "avgTtftMs": _average(summary["ttft_sum"] or 0, summary["ttft_count"] or 0),
            "mockSessions": int(mock_row["sessions"] or 0),
            "mockAccuracy": None,
        },
    }


# --------------------------------------------------------------------------
# 术语库的「上一场回顾」
# --------------------------------------------------------------------------
def _latest_live_session(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, corrections_dismissed FROM sessions "
        "WHERE mode = 'live' AND ended_at IS NOT NULL "
        "ORDER BY started_at DESC, id DESC LIMIT 1"
    ).fetchone()


def recent_corrections() -> dict[str, list[dict[str, Any]]]:
    """最近一场实时面试的纠错与疑似误听，重启后仍在。"""
    with _lock:
        conn = connect()
        row = _latest_live_session(conn)
        if row is None or int(row["corrections_dismissed"] or 0):
            return {"corrections": [], "suggestions": []}
        items = conn.execute(
            "SELECT from_text, to_text, kind FROM session_corrections "
            "WHERE session_id = ? ORDER BY id",
            (int(row["id"]),),
        ).fetchall()

    corrections = [
        {"from": item["from_text"], "to": item["to_text"]}
        for item in items
        if item["kind"] == "corrected"
    ]
    suggestions = [
        {"from": item["from_text"], "to": item["to_text"], "reason": "near-miss"}
        for item in items
        if item["kind"] == "suspected"
    ]
    return {"corrections": corrections, "suggestions": suggestions}


def clear_recent_corrections() -> None:
    with _lock:
        conn = connect()
        row = _latest_live_session(conn)
        if row is None:
            return
        conn.execute(
            "UPDATE sessions SET corrections_dismissed = 1 WHERE id = ?",
            (int(row["id"]),),
        )
