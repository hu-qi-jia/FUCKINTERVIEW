"""问答库的本地存储（SQLite 单文件）。

一条问答 = 主问题 + 答案 + 若干别名问法 + 标签 + 分类 / 类型 / 熟练度，
外加一份向量和全文索引。向量本身由 ``app.qa_index`` 负责计算，
这里只负责落盘、版本号与搜索所需的读取。

``qa.db`` 跟着数据目录走（和 ``profiles.json`` 同住），
按档案隔离靠表里的 ``profile_id`` 字段，和文件位置无关。
"""

from __future__ import annotations

import re
import sqlite3
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from app.materials import data_dir

QA_FILENAME = "qa.db"
SCHEMA_VERSION = 2

TYPE_VALUES = ("general", "behavioral", "knowledge", "project")
INDEX_STATES = ("pending", "indexing", "ready", "failed")
VECTOR_KINDS = ("question", "alias", "answer")

# 改了这些字段才需要重算向量；标签 / 分类 / 类型 / 熟练度只影响全文索引。
CONTENT_FIELDS = ("question", "answer", "aliases")

MAX_QUESTION = 500
MAX_ANSWER = 20000
MAX_ALIASES = 20

_lock = threading.RLock()
_initialised: set[str] = set()

# 写入计数：检索层靠它判断内存里的向量快照有没有过期。
_stamp = 0


def stamp() -> int:
    return _stamp


def _touch() -> None:
    global _stamp
    _stamp += 1


_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id         INTEGER PRIMARY KEY,
  source     TEXT NOT NULL,
  format     TEXT NOT NULL,
  file_hash  TEXT,
  inserted   INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qa (
  id           INTEGER PRIMARY KEY,
  profile_id   TEXT,
  question     TEXT NOT NULL,
  question_key TEXT NOT NULL,
  answer       TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'general'
               CHECK (type IN ('general','behavioral','knowledge','project')),
  proficiency  INTEGER NOT NULL DEFAULT 3 CHECK (proficiency BETWEEN 1 AND 5),
  enabled      INTEGER NOT NULL DEFAULT 1,
  source       TEXT NOT NULL DEFAULT 'manual',
  import_id    INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  source_ref   TEXT,
  content_rev  INTEGER NOT NULL DEFAULT 0,
  index_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (index_status IN ('pending','indexing','ready','failed')),
  index_error  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS qa_question_key ON qa(question_key);
CREATE INDEX IF NOT EXISTS qa_type         ON qa(type, enabled);
CREATE INDEX IF NOT EXISTS qa_profile      ON qa(profile_id);
CREATE INDEX IF NOT EXISTS qa_index_status ON qa(index_status);
CREATE INDEX IF NOT EXISTS qa_import       ON qa(import_id);

CREATE TABLE IF NOT EXISTS qa_aliases (
  id       INTEGER PRIMARY KEY,
  qa_id    INTEGER NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS qa_aliases_qa ON qa_aliases(qa_id);

CREATE TABLE IF NOT EXISTS qa_vectors (
  id          INTEGER PRIMARY KEY,
  qa_id       INTEGER NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('question','alias','answer')),
  ref_id      INTEGER,
  text        TEXT NOT NULL,
  model       TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      BLOB NOT NULL,
  content_rev INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_vectors_key
  ON qa_vectors(qa_id, kind, COALESCE(ref_id, 0));
CREATE INDEX IF NOT EXISTS qa_vectors_model ON qa_vectors(model);

CREATE VIRTUAL TABLE IF NOT EXISTS qa_fts USING fts5(
  question, answer, aliases, tokenize = 'trigram'
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_path() -> Path:
    return data_dir() / QA_FILENAME


# --------------------------------------------------------------------------
# 连接
# --------------------------------------------------------------------------
# 开连接贵的不在 ``sqlite3.connect()`` 本身，而在新连接上的**第一条语句**
# （读库头、载入 WAL 索引，Windows 上约 4ms）。检索每回合都要读库，所以
# 进程内复用一条连接——所有调用都在 ``_lock`` 里串行使用。
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
        # foreign_keys / synchronous 是连接级设置，每次都得设；
        # journal_mode 记在库文件里，设一次就持久生效，见 _ensure_schema。
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        _ensure_schema(conn)
        _shared, _shared_path = conn, path
    return _Borrowed(_shared)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    key = str(db_path())
    if key in _initialised:
        return
    # 每次连接都设 WAL 要多花约 4ms，而每个检索、每个接口都要开连接。
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    version = int(row[0]) if row and str(row[0]).isdigit() else 0
    if version < 2:
        _migrate_to_v2(conn)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(SCHEMA_VERSION),),
    )
    _initialised.add(key)


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    """v2：只留「类型」一条分类轴，去掉「分类」和「标签」。

    - 删 ``qa.category`` 列（先删依赖它的索引）和 ``qa_tags`` 表
    - 全文索引重建为三列，并补一次全文，避免旧库里残留标签词
    """
    columns = {row[1] for row in conn.execute("PRAGMA table_info(qa)")}
    if "category" in columns:
        conn.execute("DROP INDEX IF EXISTS qa_category")
        conn.execute("ALTER TABLE qa DROP COLUMN category")
    conn.execute("DROP TABLE IF EXISTS qa_tags")
    conn.execute("DROP TABLE IF EXISTS qa_fts")
    conn.execute(
        "CREATE VIRTUAL TABLE qa_fts USING fts5("
        "question, answer, aliases, tokenize = 'trigram')"
    )
    for row in conn.execute(
        "SELECT q.id, q.question, q.answer, "
        "(SELECT group_concat(text, ' ') FROM qa_aliases WHERE qa_id = q.id) FROM qa q"
    ):
        conn.execute(
            "INSERT INTO qa_fts(rowid, question, answer, aliases) VALUES (?,?,?,?)",
            (row[0], row[1], row[2], row[3] or ""),
        )


def reset_cache() -> None:
    """数据目录切换后调用：关掉旧连接，下次连接重新建表。"""
    global _shared, _shared_path
    # 后台索引线程也在用这条共享连接；必须和 connect() 一样串行关闭。
    with _lock:
        if _shared is not None:
            _shared.close()
        _shared, _shared_path = None, None
        _initialised.clear()


def migrate_db(source: Path, target: Path) -> bool:
    """把问答库搬到新目录。

    WAL 模式下不能直接复制文件（会拿到不一致的快照），用 ``VACUUM INTO``
    让 SQLite 自己导出一份干净的副本。
    """
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
# 归一化
# --------------------------------------------------------------------------
_PUNCT_RE = re.compile(r"[\s　!-/:-@\[-`{-~、-〿！-／：-＠［-｀｛-･]+")


def normalize_question(text: str) -> str:
    """去掉空白、标点、全半角差异和大小写，用于「是不是同一道题」的判断。"""
    value = unicodedata.normalize("NFKC", str(text or "")).lower()
    return _PUNCT_RE.sub("", value)


def _clean_list(values: Any, limit: int, max_len: int) -> list[str]:
    if isinstance(values, str):
        values = re.split(r"[|;,、\n]", values)
    if not isinstance(values, (list, tuple)):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = str(item or "").strip()[:max_len]
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _clean_type(value: Any) -> str:
    text = str(value or "").strip()
    return text if text in TYPE_VALUES else "general"


def _clean_proficiency(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 3
    return max(1, min(5, number))


# --------------------------------------------------------------------------
# 全文索引
# --------------------------------------------------------------------------
def _fts_refresh(
    conn: sqlite3.Connection,
    qa_id: int,
    question: str,
    answer: str,
    aliases: Iterable[str],
) -> None:
    conn.execute("DELETE FROM qa_fts WHERE rowid = ?", (qa_id,))
    conn.execute(
        "INSERT INTO qa_fts(rowid, question, answer, aliases) VALUES (?,?,?,?)",
        (qa_id, question, answer, " ".join(aliases)),
    )


def _fts_query(text: str) -> str:
    """把用户输入变成一个 FTS5 phrase，避免特殊字符被当成语法。"""
    return '"' + text.replace('"', '""') + '"'


def keyword_search(text: str, limit: int = 50) -> list[dict[str, Any]]:
    """全文召回。trigram 分词器要求至少 3 个字符，短查询退化成子串扫描。"""
    text = (text or "").strip()
    if not text:
        return []
    limit = max(1, min(200, int(limit or 50)))
    with _lock:
        conn = connect()
        try:
            if len(text) < 3:
                like = f"%{text}%"
                rows = conn.execute(
                    """SELECT id FROM qa
                       WHERE enabled = 1 AND (question LIKE ? OR answer LIKE ?)
                       ORDER BY updated_at DESC LIMIT ?""",
                    (like, like, limit),
                ).fetchall()
                return [{"qa_id": row[0], "score": 0.0} for row in rows]
            try:
                rows = conn.execute(
                    """SELECT f.rowid FROM qa_fts f
                       JOIN qa q ON q.id = f.rowid
                       WHERE qa_fts MATCH ? AND q.enabled = 1
                       ORDER BY bm25(qa_fts) LIMIT ?""",
                    (_fts_query(text), limit),
                ).fetchall()
            except sqlite3.OperationalError:
                return []
            return [{"qa_id": row[0], "score": 0.0} for row in rows]
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 读取
# --------------------------------------------------------------------------
def _hydrate(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    ids = [row["id"] for row in rows]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    aliases: dict[int, list[str]] = {}
    for row in conn.execute(
        f"SELECT qa_id, text FROM qa_aliases WHERE qa_id IN ({marks}) ORDER BY qa_id, position",
        ids,
    ):
        aliases.setdefault(row["qa_id"], []).append(row["text"])

    result = []
    for row in rows:
        item = dict(row)
        item["aliases"] = aliases.get(item["id"], [])
        item["enabled"] = bool(item["enabled"])
        result.append(item)
    return result


def get_qa(qa_id: int) -> dict[str, Any] | None:
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM qa WHERE id = ?", (qa_id,)).fetchone()
            return _hydrate(conn, [row])[0] if row else None
        finally:
            conn.close()


def find_by_key(question_key: str) -> list[dict[str, Any]]:
    with _lock:
        conn = connect()
        try:
            rows = conn.execute(
                "SELECT * FROM qa WHERE question_key = ? ORDER BY id", (question_key,)
            ).fetchall()
            return _hydrate(conn, rows)
        finally:
            conn.close()


def _where(
    q: str = "",
    type_: str = "",
    status: str = "",
    profile_id: str | None = None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if q.strip():
        clauses.append("(question LIKE ? OR answer LIKE ?)")
        like = f"%{q.strip()}%"
        params += [like, like]
    if type_.strip():
        clauses.append("type = ?")
        params.append(type_.strip())
    if status.strip():
        clauses.append("index_status = ?")
        params.append(status.strip())
    if profile_id is not None:
        clauses.append("(profile_id IS NULL OR profile_id = ?)")
        params.append(profile_id)
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def list_qa(
    q: str = "",
    type_: str = "",
    status: str = "",
    profile_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    where, params = _where(q, type_, status, profile_id)
    limit = max(1, min(200, int(limit or 50)))
    offset = max(0, int(offset or 0))
    with _lock:
        conn = connect()
        try:
            total = conn.execute(f"SELECT COUNT(*) FROM qa{where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM qa{where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
            return {"items": _hydrate(conn, rows), "total": total}
        finally:
            conn.close()


def stats() -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            total = conn.execute("SELECT COUNT(*) FROM qa").fetchone()[0]
            by_status = {
                row[0]: row[1]
                for row in conn.execute(
                    "SELECT index_status, COUNT(*) FROM qa GROUP BY index_status"
                )
            }
            by_type = {
                row[0]: row[1]
                for row in conn.execute("SELECT type, COUNT(*) FROM qa GROUP BY type")
            }
            return {
                "total": total,
                "byStatus": by_status,
                "byType": by_type,
                "model": get_meta(conn, "embedding_model"),
                "dim": get_meta(conn, "embedding_dim"),
            }
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 写入
# --------------------------------------------------------------------------
def _write_aliases(conn: sqlite3.Connection, qa_id: int, aliases: list[str]) -> None:
    conn.execute("DELETE FROM qa_aliases WHERE qa_id = ?", (qa_id,))
    for position, text in enumerate(aliases):
        conn.execute(
            "INSERT INTO qa_aliases(qa_id, text, position) VALUES (?,?,?)",
            (qa_id, text, position),
        )


def create_qa(fields: dict[str, Any]) -> dict[str, Any]:
    question = str(fields.get("question") or "").strip()[:MAX_QUESTION]
    answer = str(fields.get("answer") or "").strip()[:MAX_ANSWER]
    if not question:
        raise ValueError("问题不能为空")
    if not answer:
        raise ValueError("答案不能为空")

    aliases = _clean_list(fields.get("aliases"), MAX_ALIASES, MAX_QUESTION)
    now = _now()
    _touch()

    with _lock:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                """INSERT INTO qa(profile_id, question, question_key, answer, type,
                                  proficiency, enabled, source, import_id, source_ref,
                                  content_rev, index_status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,0,'pending',?,?)""",
                (
                    fields.get("profile_id"),
                    question,
                    normalize_question(question),
                    answer,
                    _clean_type(fields.get("type")),
                    _clean_proficiency(fields.get("proficiency")),
                    1 if fields.get("enabled", True) else 0,
                    str(fields.get("source") or "manual"),
                    fields.get("import_id"),
                    fields.get("source_ref"),
                    now,
                    now,
                ),
            )
            qa_id = int(cursor.lastrowid)
            _write_aliases(conn, qa_id, aliases)
            _fts_refresh(conn, qa_id, question, answer, aliases)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            row = conn.execute("SELECT * FROM qa WHERE id = ?", (qa_id,)).fetchone()
            result = _hydrate(conn, [row])[0]
            conn.close()
    return result


def update_qa(qa_id: int, patch: dict[str, Any]) -> dict[str, Any]:
    _touch()
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM qa WHERE id = ?", (qa_id,)).fetchone()
            if row is None:
                raise KeyError(qa_id)
            current = dict(row)

            question = str(patch.get("question", current["question"])).strip()[:MAX_QUESTION]
            answer = str(patch.get("answer", current["answer"])).strip()[:MAX_ANSWER]
            if not question:
                raise ValueError("问题不能为空")
            if not answer:
                raise ValueError("答案不能为空")

            alias_rows = conn.execute(
                "SELECT text FROM qa_aliases WHERE qa_id = ? ORDER BY position", (qa_id,)
            ).fetchall()
            aliases = (
                _clean_list(patch.get("aliases"), MAX_ALIASES, MAX_QUESTION)
                if "aliases" in patch
                else [r["text"] for r in alias_rows]
            )

            content_changed = (
                question != current["question"]
                or answer != current["answer"]
                or aliases != [r["text"] for r in alias_rows]
            )

            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """UPDATE qa SET question=?, question_key=?, answer=?, type=?,
                                 proficiency=?, enabled=?, content_rev=?, index_status=?, updated_at=?
                   WHERE id=?""",
                (
                    question,
                    normalize_question(question),
                    answer,
                    _clean_type(patch.get("type", current["type"])),
                    _clean_proficiency(patch.get("proficiency", current["proficiency"])),
                    1 if patch.get("enabled", bool(current["enabled"])) else 0,
                    current["content_rev"] + (1 if content_changed else 0),
                    "pending" if content_changed else current["index_status"],
                    _now(),
                    qa_id,
                ),
            )
            _write_aliases(conn, qa_id, aliases)
            _fts_refresh(conn, qa_id, question, answer, aliases)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            row = conn.execute("SELECT * FROM qa WHERE id = ?", (qa_id,)).fetchone()
            result = _hydrate(conn, [row])[0] if row else None
            conn.close()
    return result  # type: ignore[return-value]


def delete_qa(qa_id: int) -> None:
    bulk_delete([qa_id])


def bulk_delete(ids: list[int]) -> int:
    clean = [int(i) for i in ids if str(i).strip()]
    if not clean:
        return 0
    marks = ",".join("?" * len(clean))
    _touch()
    with _lock:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(f"DELETE FROM qa_fts WHERE rowid IN ({marks})", clean)
            conn.execute(f"DELETE FROM qa WHERE id IN ({marks})", clean)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()
    return len(clean)


# --------------------------------------------------------------------------
# 索引状态
# --------------------------------------------------------------------------
def mark_index(qa_id: int, status: str, error: str | None = None) -> None:
    if status not in INDEX_STATES:
        return
    with _lock:
        conn = connect()
        try:
            conn.execute(
                "UPDATE qa SET index_status = ?, index_error = ? WHERE id = ?",
                (status, (error or None) if status == "failed" else None, qa_id),
            )
        finally:
            conn.close()


def pending_ids(limit: int = 500) -> list[int]:
    with _lock:
        conn = connect()
        try:
            return [
                row[0]
                for row in conn.execute(
                    "SELECT id FROM qa WHERE index_status IN ('pending','failed') ORDER BY id LIMIT ?",
                    (limit,),
                )
            ]
        finally:
            conn.close()


def reset_indexing() -> int:
    """上次退出时正在索引的条目会被卡在 indexing，启动时退回 pending。"""
    with _lock:
        conn = connect()
        try:
            cursor = conn.execute(
                "UPDATE qa SET index_status = 'pending' WHERE index_status = 'indexing'"
            )
            return cursor.rowcount or 0
        finally:
            conn.close()


def stale_ids() -> list[int]:
    """内容改过但向量还没跟上的条目。"""
    with _lock:
        conn = connect()
        try:
            return [
                row[0]
                for row in conn.execute(
                    """SELECT q.id FROM qa q
                       WHERE q.enabled = 1
                         AND NOT EXISTS (
                           SELECT 1 FROM qa_vectors v
                           WHERE v.qa_id = q.id AND v.content_rev = q.content_rev
                             AND v.kind IN ('question','alias')
                         )
                       ORDER BY q.id"""
                )
            ]
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 向量读写
# --------------------------------------------------------------------------
def replace_vectors(qa_id: int, vectors: list[dict[str, Any]], content_rev: int) -> None:
    _touch()
    with _lock:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM qa_vectors WHERE qa_id = ?", (qa_id,))
            for vector in vectors:
                conn.execute(
                    """INSERT INTO qa_vectors(qa_id, kind, ref_id, text, model, dim, vector,
                                              content_rev, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        qa_id,
                        vector["kind"],
                        vector.get("ref_id"),
                        vector["text"],
                        vector["model"],
                        vector["dim"],
                        vector["vector"],
                        content_rev,
                        _now(),
                    ),
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()


def vector_rows(model: str) -> list[sqlite3.Row]:
    """检索用的向量快照：只取问题侧、且版本跟得上的条目。"""
    with _lock:
        conn = connect()
        try:
            return conn.execute(
                """SELECT v.qa_id, v.kind, v.ref_id, v.text, v.dim, v.vector
                   FROM qa_vectors v
                   JOIN qa q ON q.id = v.qa_id
                   WHERE v.model = ? AND v.content_rev = q.content_rev
                     AND q.enabled = 1 AND v.kind IN ('question','alias')""",
                (model,),
            ).fetchall()
        finally:
            conn.close()


def alias_map(qa_ids: list[int]) -> dict[int, list[str]]:
    if not qa_ids:
        return {}
    marks = ",".join("?" * len(qa_ids))
    with _lock:
        conn = connect()
        try:
            result: dict[int, list[str]] = {}
            for row in conn.execute(
                f"SELECT qa_id, text FROM qa_aliases WHERE qa_id IN ({marks}) ORDER BY position",
                qa_ids,
            ):
                result.setdefault(row["qa_id"], []).append(row["text"])
            return result
        finally:
            conn.close()


def load_qa_many(ids: list[int]) -> dict[int, dict[str, Any]]:
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    with _lock:
        conn = connect()
        try:
            rows = conn.execute(f"SELECT * FROM qa WHERE id IN ({marks})", ids).fetchall()
            return {item["id"]: item for item in _hydrate(conn, rows)}
        finally:
            conn.close()


# --------------------------------------------------------------------------
# meta
# --------------------------------------------------------------------------
def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(**values: Any) -> None:
    with _lock:
        conn = connect()
        try:
            for key, value in values.items():
                conn.execute(
                    "INSERT INTO meta(key, value) VALUES (?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, str(value)),
                )
        finally:
            conn.close()


def read_meta() -> dict[str, str]:
    with _lock:
        conn = connect()
        try:
            return {row[0]: row[1] for row in conn.execute("SELECT key, value FROM meta")}
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 导入批次
# --------------------------------------------------------------------------
def record_import(
    source: str, format_: str, file_hash: str | None, inserted: int, updated: int, skipped: int
) -> int:
    with _lock:
        conn = connect()
        try:
            cursor = conn.execute(
                """INSERT INTO imports(source, format, file_hash, inserted, updated, skipped, created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (source, format_, file_hash, inserted, updated, skipped, _now()),
            )
            return int(cursor.lastrowid)
        finally:
            conn.close()


def find_import_by_hash(file_hash: str) -> dict[str, Any] | None:
    with _lock:
        conn = connect()
        try:
            row = conn.execute(
                "SELECT * FROM imports WHERE file_hash = ? ORDER BY id DESC LIMIT 1", (file_hash,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def undo_import(import_id: int) -> int:
    _touch()
    with _lock:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            ids = [r[0] for r in conn.execute("SELECT id FROM qa WHERE import_id = ?", (import_id,))]
            if ids:
                marks = ",".join("?" * len(ids))
                conn.execute(f"DELETE FROM qa_fts WHERE rowid IN ({marks})", ids)
            conn.execute("DELETE FROM qa WHERE import_id = ?", (import_id,))
            conn.execute("DELETE FROM imports WHERE id = ?", (import_id,))
            conn.execute("COMMIT")
            return len(ids)
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()
