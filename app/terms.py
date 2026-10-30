"""术语库的本地存储与纠错逻辑。

一条术语 = 规范写法 + 可选释义 + 若干别名（ASR 常见的误转写）。
别名用来改写转写文本，释义用来填进系统提示词——两件事互不依赖：
没有释义的词条只参与纠错，不会被塞进提示词。

``terms.db`` 和 ``qa.db`` 并列存放、跟着数据目录走，只有一张 ``terms`` 表，
别名以 JSON 数组存在同一条记录里。内置模板是代码里的常量，首次使用时写进表，
之后按词名只补新增、不覆盖用户改动；用户删掉的模板词用 ``hidden`` 留痕，
免得下次启动又冒出来。
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from app.materials import data_dir

TERMS_FILENAME = "terms.db"
SCHEMA_VERSION = 1
# 模板内容改版时递增：老库下次启动会按新内容重写模板行，自定义词条不受影响。
TEMPLATE_VERSION = 3

MAX_TERM = 32
MAX_ALIAS = 32
MAX_DEFINITION = 500
# 释义在提示词里最多占这么多字；超出部分截断，但库里保留全文。
INJECT_DEFINITION = 50
# 术语段在系统提示词里的字符预算。
PROMPT_BUDGET = 2000
MAX_BULK = 500

TEMPLATE_IDS = ("product", "engineering", "ai", "ops")
TEMPLATE_ORDER = {name: index for index, name in enumerate(TEMPLATE_IDS)}
# 不属于任何具体模板时的归属。内置，用户删不掉。
CUSTOM_TEMPLATE = "custom"
MAX_TEMPLATE_NAME = 32

_lock = threading.RLock()
_initialised: set[str] = set()

# 写入计数：纠错层靠它判断内存快照有没有过期。
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

CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  builtin    INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  id         INTEGER PRIMARY KEY,
  template   TEXT NOT NULL DEFAULT 'custom',
  term       TEXT NOT NULL,
  term_key   TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  aliases    TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 1,
  hidden     INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS terms_key      ON terms(term_key);
CREATE INDEX IF NOT EXISTS terms_template ON terms(template, sort_order);
"""


# --------------------------------------------------------------------------
# 内置模板：只有词和常见误转写，不带释义
#
# 释义留给用户填：模型本来就知道 GMV 是什么，它不知道的是公司内部的黑话。
# 别名只收高置信的字形/发音混淆，宁可少写，写错一次就是一次误改。
# --------------------------------------------------------------------------
_TEMPLATES: dict[str, list[tuple[str, list[str]]]] = {
    "product": [
        ("PRD", ["PRT", "P2D"]),
        ("MRD", ["MRT", "MR0"]),
        ("BRD", ["BRT", "BR0"]),
        ("MVP", ["NVP", "MBV"]),
        ("PMF", ["PME", "PNF"]),
        ("NPS", ["MPS", "NP5"]),
        ("KPI", ["KPL", "KPE"]),
        ("OKR", ["OKB", "OKL"]),
        ("Persona", ["Parsona", "Personer"]),
        ("User Journey", ["User Journy", "User Jorney"]),
        ("Wireframe", ["Wire Frame", "Whyerframe"]),
        ("Prototype", ["Prototipe", "Prototyp"]),
        ("High Fidelity", ["Hi Fidelity", "High Fidellity"]),
        ("Interaction Design", ["Interaction Desine", "Interraction Design"]),
        ("Information Architecture", ["Infomation Architecture", "Information Architecure"]),
        ("Requirement Pool", ["Requirment Pool", "Requirement Pull"]),
        ("Requirement Review", ["Requirment Review", "Requirement Revise"]),
        ("Release Plan", ["Release Plane", "Relase Plan"]),
        ("Iteration", ["Itteration", "Iterasion"]),
        ("Tracking", ["Tranking", "Tracting"]),
        ("Canary Release", ["Canery Release", "Canary Relase"]),
        ("AB Test", ["AB Tes", "A B Test"]),
        ("Retention Rate", ["Retension Rate", "Retention Rat"]),
        ("Conversion Rate", ["Converion Rate", "Conversion Rat"]),
        ("User Story", ["User Storey", "User Stori"]),
        ("North Star Metric", ["North Star Matric", "North Star Metrik"]),
        ("Competitive Analysis", ["Competative Analysis", "Competitive Analisis"]),
        ("User Interview", ["User Intervew", "User Intervue"]),
        ("Usability Testing", ["Usability Testting", "Usabillity Testing"]),
        ("Cold Start", ["Cold Stat", "Cold Star"]),
    ],
    "engineering": [
        ("API", ["APY", "A P I"]),
        ("SDK", ["SDG", "S D K"]),
        ("CI", ["C1", "C I"]),
        ("CD", ["C0", "C D"]),
        ("QPS", ["QBS", "QP S"]),
        ("TPS", ["TBS", "TP S"]),
        ("SLA", ["SLR", "S L A"]),
        ("SLO", ["SL0", "S L O"]),
        ("SRE", ["SBE", "S R E"]),
        ("DDD", ["DBD", "D D D"]),
        ("TDD", ["TDB", "T D D"]),
        ("BDD", ["BDB", "B D D"]),
        ("ORM", ["0RM", "ORN"]),
        ("CRUD", ["CRUT", "C R U D"]),
        ("RPC", ["RBC", "R P C"]),
        ("MQ", ["NQ", "M Q"]),
        ("GC", ["JC", "G C"]),
        ("JVM", ["GVM", "J V M"]),
        ("Kubernetes", ["Kubernets", "Kuberneters"]),
        ("Docker", ["Doker", "Dockers"]),
        ("Microservices", ["Micro Service", "Microservises"]),
        ("Middle Platform", ["Middle Plaform", "Mid Platform"]),
        ("Circuit Breaker", ["Circuit Breker", "Circuit Breake"]),
        ("Rate Limiting", ["Rate Limitting", "Rate Limite"]),
        ("Degradation", ["Degradasion", "Degration"]),
        ("Idempotency", ["Idempotent", "Idempotancy"]),
        ("Load Testing", ["Load Testting", "Load Testin"]),
        ("Distributed Transaction", ["Distributed Transation", "Distribued Transaction"]),
        ("Sharding", ["Shardin", "Shardingg"]),
        ("Gateway", ["Gatway", "Gate Way"]),
    ],
    "ai": [
        ("LLM", ["LLN", "L L M"]),
        ("RAG", ["LAG", "RAJ"]),
        ("RLHF", ["RLHE", "R L H F"]),
        ("SFT", ["SFE", "S F T"]),
        ("LoRA", ["劳拉", "洛拉"]),
        ("PEFT", ["PEFE", "P E F T"]),
        ("Embedding", ["Embedin", "Embdding"]),
        ("Token", ["Tokin", "Tocken"]),
        ("Prompt", ["Promt", "Pronpt"]),
        ("Fine-tuning", ["Fine Tuning", "Finetuning"]),
        ("Inference", ["Inferance", "Inferrence"]),
        ("Hallucination", ["Halucination", "Hallucinaton"]),
        ("Transformer", ["Transformers", "Transfomer"]),
        ("Attention", ["Atention", "Attension"]),
        ("MoE", ["Mo E", "M O E"]),
        ("Agent", ["Agents", "Ajent"]),
        ("MCP", ["MCB", "M C P"]),
        ("Multimodal", ["Multi-modal", "Multimodel"]),
        ("Knowledge Base", ["Knowlege Base", "Knowledge Case"]),
        ("Vector Search", ["Vector Serch", "Vecter Search"]),
        ("Cosine Similarity", ["Cosign Similarity", "Cosine Similiarity"]),
        ("Context Window", ["Context Windows", "Contex Window"]),
        ("Temperature", ["Temprature", "Temperatur"]),
        ("Chain of Thought", ["Chain of Thoght", "Chian of Thought"]),
        ("Prompt Engineering", ["Promt Engineering", "Prompt Enginering"]),
        ("Function Calling", ["Fuction Calling", "Function Callin"]),
        ("Streaming", ["Streamin", "Streming"]),
        ("Latency", ["Latancy", "Latensy"]),
        ("Throughput", ["Throughtput", "Throughputt"]),
        ("Benchmark", ["Bench Mark", "Benchmakr"]),
    ],
    "ops": [
        ("GMV", ["JGV", "GMB"]),
        ("ROI", ["RUA", "RUI"]),
        ("CPA", ["CBA", "CP A"]),
        ("CPC", ["CBC", "CP C"]),
        ("CPM", ["CPN", "CP M"]),
        ("CTR", ["CTB", "CT R"]),
        ("CVR", ["CVB", "CV R"]),
        ("DAU", ["DAV", "DAO"]),
        ("MAU", ["NAU", "MA0"]),
        ("ARPU", ["ARPV", "A RPU"]),
        ("LTV", ["LTB", "L T V"]),
        ("CAC", ["CAB", "C A C"]),
        ("AOV", ["A0V", "A OV"]),
        ("SKU", ["SKV", "S KU"]),
        ("SPU", ["SPV", "S PU"]),
        ("UV", ["UB", "U W"]),
        ("PV", ["PB", "P W"]),
        ("Repurchase Rate", ["Repurchse Rate", "Repurchase Rat"]),
        ("Private Domain", ["Privat Domain", "Private Domian"]),
        ("Public Domain", ["Pubic Domain", "Public Domian"]),
        ("Acquisition", ["Acqusition", "Aquisation"]),
        ("Activation", ["Activasion", "Activationn"]),
        ("Retention", ["Retension", "Rentention"]),
        ("Reactivation", ["Re-activation", "Reactvation"]),
        ("Viral Growth", ["Viral Groth", "Viral Grouth"]),
        ("Attribution", ["Attribusion", "Attributon"]),
        ("User Growth", ["User Groth", "User Grouth"]),
        ("Conversion Funnel", ["Converion Funnel", "Conversion Funel"]),
        ("Impression", ["Impresion", "Imprestion"]),
        ("Churn Rate", ["Chun Rate", "Churn Rat"]),
    ],
}


def _seed_templates(conn: sqlite3.Connection) -> None:
    """内置模板写进 templates 表；用户自建的模板行不会被覆盖。"""
    now = _now()
    for index, name in enumerate(TEMPLATE_IDS):
        conn.execute(
            "INSERT INTO templates(id, name, builtin, sort_order, created_at) "
            "VALUES (?, '', 1, ?, ?) ON CONFLICT(id) DO NOTHING",
            (name, index, now),
        )
    conn.execute(
        "INSERT INTO templates(id, name, builtin, sort_order, created_at) "
        "VALUES (?, '', 1, -1, ?) ON CONFLICT(id) DO NOTHING",
        (CUSTOM_TEMPLATE, now),
    )


def list_templates() -> list[dict[str, Any]]:
    """模板清单。内置模板的 name 留空，由界面按语言取文案；自建的直接用名字。"""
    with _lock:
        conn = connect()
        try:
            enabled = _templates_state(conn)
            rows = conn.execute(
                "SELECT * FROM templates ORDER BY sort_order, created_at"
            ).fetchall()
            counts = {
                row[0]: row[1]
                for row in conn.execute(
                    "SELECT template, COUNT(*) FROM terms "
                    "WHERE hidden = 0 AND enabled = 1 GROUP BY template"
                )
            }
        finally:
            conn.close()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "builtin": bool(row["builtin"]),
            "count": counts.get(row["id"], 0),
            "enabled": enabled.get(row["id"], True),
        }
        for row in rows
    ]


def _template_names(conn: sqlite3.Connection) -> dict[str, str]:
    return {row[0]: row[1] for row in conn.execute("SELECT id, name FROM templates")}


def create_template(name: str) -> dict[str, Any]:
    clean = _clean_text(name, MAX_TEMPLATE_NAME)
    if not clean:
        raise ValueError("模板名称不能为空")
    key = normalize(clean)
    now = _now()
    template_id = "u" + uuid.uuid4().hex[:8]

    with _lock:
        conn = connect()
        try:
            for row in conn.execute("SELECT name FROM templates"):
                if normalize(row[0]) == key:
                    raise ValueError("已经有同名模板")
            order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) FROM templates WHERE builtin = 0"
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO templates(id, name, builtin, sort_order, created_at) "
                "VALUES (?, ?, 0, ?, ?)",
                (template_id, clean, max(int(order), len(TEMPLATE_IDS)) + 1, now),
            )
        finally:
            conn.close()
    _touch()
    return {
        "id": template_id,
        "name": clean,
        "builtin": False,
        "count": 0,
        "enabled": True,
    }


def rename_template(template_id: str, name: str) -> None:
    clean = _clean_text(name, MAX_TEMPLATE_NAME)
    if not clean:
        raise ValueError("模板名称不能为空")
    with _lock:
        conn = connect()
        try:
            row = conn.execute(
                "SELECT builtin FROM templates WHERE id = ?", (template_id,)
            ).fetchone()
            if row is None:
                raise KeyError(template_id)
            if row[0]:
                raise ValueError("内置模板不能改名")
            conn.execute(
                "UPDATE templates SET name = ? WHERE id = ?", (clean, template_id)
            )
        finally:
            conn.close()
    _touch()


def delete_template(template_id: str) -> None:
    """删掉自建模板，里面的词条退回「自定义」，不跟着一起消失。"""
    with _lock:
        conn = connect()
        try:
            row = conn.execute(
                "SELECT builtin FROM templates WHERE id = ?", (template_id,)
            ).fetchone()
            if row is None:
                raise KeyError(template_id)
            if row[0]:
                raise ValueError("内置模板不能删除")
            conn.execute(
                "UPDATE terms SET template = ? WHERE template = ?",
                (CUSTOM_TEMPLATE, template_id),
            )
            conn.execute("DELETE FROM templates WHERE id = ?", (template_id,))
        finally:
            conn.close()
    _touch()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_path() -> Path:
    return data_dir() / TERMS_FILENAME


# --------------------------------------------------------------------------
# 连接
# --------------------------------------------------------------------------
# 开连接贵的不在 ``sqlite3.connect()`` 本身，而在新连接上的**第一条语句**
# （读库头、载入 WAL 索引，Windows 上约 4ms）。所以进程内复用一条连接：
# 所有调用都在 ``_lock`` 里串行使用，复用的前提就是这一条。
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
        # synchronous 是连接级设置，得每次设；journal_mode 记在库文件里，见 _ensure_schema。
        conn.execute("PRAGMA synchronous=NORMAL")
        _ensure_schema(conn)
        _shared, _shared_path = conn, path
    return _Borrowed(_shared)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    key = str(db_path())
    if key in _initialised:
        return
    # WAL 写进库文件的头部，设一次就持久生效。每次连接都设要多花约 4ms，
    # 这在本项目里是每个接口调用都要付的钱，所以只在建库那次设。
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(SCHEMA_VERSION),),
    )
    sync_templates(conn)
    _seed_templates(conn)
    upgrade_templates(conn)
    _initialised.add(key)


def upgrade_templates(conn: sqlite3.Connection) -> int:
    """模板内容改版后重写老库里的模板行。自定义词条不动。"""
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'template_version'"
    ).fetchone()
    version = int(row[0]) if row and str(row[0]).isdigit() else 0
    if version >= TEMPLATE_VERSION:
        return 0
    for name in TEMPLATE_IDS:
        _reset_template(conn, name)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('template_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(TEMPLATE_VERSION),),
    )
    _touch()
    return len(TEMPLATE_IDS)


def reset_cache() -> None:
    """数据目录切换后调用：关掉旧连接，下次连接重新建表。"""
    global _shared, _shared_path
    if _shared is not None:
        _shared.close()
    _shared, _shared_path = None, None
    _initialised.clear()
    _cache.clear()
    _templates_cache.clear()
    _touch()


def migrate_db(source: Path, target: Path) -> bool:
    """把术语库搬到新目录；WAL 模式下用 ``VACUUM INTO`` 导出一份干净副本。"""
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
def normalize(text: str) -> str:
    """判重用的键：全半角统一、去掉空白和标点、小写。"""
    value = unicodedata.normalize("NFKC", str(text or "")).casefold()
    return "".join(ch for ch in value if ch.isalnum())


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _split_aliases(values: Any) -> list[str]:
    if isinstance(values, str):
        values = re.split(r"[|;,、\n]", values)
    if not isinstance(values, (list, tuple)):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = _clean_text(item, MAX_ALIAS)
        key = normalize(text)
        if text and key and key not in seen:
            seen.add(key)
            result.append(text)
        if len(result) >= 20:
            break
    return result


def _row_aliases(raw: Any) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in value if str(item or "").strip()]


# --------------------------------------------------------------------------
# 模板开关
# --------------------------------------------------------------------------
_templates_cache: dict[str, tuple[int, dict[str, bool]]] = {}


def _templates_state(conn: sqlite3.Connection) -> dict[str, bool]:
    """在已经打开的连接上读模板开关。"""
    ids = [row[0] for row in conn.execute("SELECT id FROM templates")]
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'templates'"
    ).fetchone()
    stored: dict[str, Any] = {}
    if row:
        try:
            stored = json.loads(row[0])
        except (TypeError, ValueError):
            stored = {}
    return {name: bool(stored.get(name, True)) for name in ids}


def templates_enabled() -> dict[str, bool]:
    """模板开关，按 ``_stamp`` 缓存；任何写操作都会让缓存失效。

    返回的是副本——``set_template_enabled`` 会就地改这个 dict。
    """
    key = str(db_path())
    cached = _templates_cache.get(key)
    if cached is not None and cached[0] == _stamp:
        return dict(cached[1])
    with _lock:
        conn = connect()
        try:
            state = _templates_state(conn)
            # 在锁内取 stamp：写操作都要拿这把锁，这样缓存的版本号不会和内容错位。
            stamp = _stamp
        finally:
            conn.close()
    _templates_cache[key] = (stamp, state)
    return dict(state)


def _require_template(conn: sqlite3.Connection, template_id: str) -> None:
    if conn.execute(
        "SELECT 1 FROM templates WHERE id = ?", (template_id,)
    ).fetchone() is None:
        raise ValueError(f"未知模板：{template_id}")


def set_template_enabled(name: str, enabled: bool) -> dict[str, bool]:
    with _lock:
        conn = connect()
        try:
            _require_template(conn, name)
        finally:
            conn.close()
    state = templates_enabled()
    state[name] = bool(enabled)
    with _lock:
        conn = connect()
        try:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES ('templates', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (json.dumps(state, ensure_ascii=False),),
            )
        finally:
            conn.close()
    _touch()
    return state


def sync_templates(conn: sqlite3.Connection) -> int:
    """把模板里新增的词补进表；已有记录一律不动。"""
    added = 0
    now = _now()
    for name in TEMPLATE_IDS:
        for position, (term, aliases) in enumerate(_TEMPLATES[name]):
            key = normalize(term)
            exists = conn.execute(
                "SELECT 1 FROM terms WHERE template = ? AND term_key = ?",
                (name, key),
            ).fetchone()
            if exists:
                continue
            conn.execute(
                """INSERT INTO terms(template, term, term_key, definition, aliases,
                                     enabled, hidden, sort_order, created_at, updated_at)
                   VALUES (?,?,?,'',?,1,0,?,?,?)""",
                (
                    name,
                    term,
                    key,
                    json.dumps(aliases, ensure_ascii=False),
                    position,
                    now,
                    now,
                ),
            )
            added += 1
    if added:
        _touch()
    return added


# --------------------------------------------------------------------------
# 读取
# --------------------------------------------------------------------------
def _hydrate(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["aliases"] = _row_aliases(item.get("aliases"))
    item["enabled"] = bool(item["enabled"])
    item["hidden"] = bool(item["hidden"])
    return item


def _template_order(conn: sqlite3.Connection) -> dict[str, int]:
    return {row[0]: row[1] for row in conn.execute("SELECT id, sort_order FROM templates")}


def _sort_key(order: dict[str, int]):
    """「自定义」排最前，其余按模板在表里的顺序；未知模板垫底。"""

    def key(item: dict[str, Any]) -> tuple[int, int, int]:
        return (
            order.get(item["template"], 99),
            int(item["sort_order"] or 0),
            int(item["id"]),
        )

    return key


def active_terms() -> list[dict[str, Any]]:
    """当前生效的词条：「自定义」优先，其次按模板顺序；停用、屏蔽、模板关掉的不算。"""
    with _lock:
        conn = connect()
        try:
            enabled_templates = _templates_state(conn)
            rows = conn.execute(
                "SELECT * FROM terms WHERE enabled = 1 AND hidden = 0"
            ).fetchall()
            order = _template_order(conn)
        finally:
            conn.close()

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in sorted((_hydrate(row) for row in rows), key=_sort_key(order)):
        if row["template"] != CUSTOM_TEMPLATE and not enabled_templates.get(
            row["template"], True
        ):
            continue
        key = normalize(row["term"])
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def list_terms(q: str = "", template: str = "") -> dict[str, Any]:
    clauses = ["hidden = 0"]
    params: list[Any] = []
    text = (q or "").strip()
    if text:
        clauses.append("(term LIKE ? OR definition LIKE ? OR aliases LIKE ?)")
        like = f"%{text}%"
        params += [like, like, like]
    if template.strip():
        clauses.append("template = ?")
        params.append(template.strip())

    with _lock:
        conn = connect()
        try:
            rows = conn.execute(
                f"SELECT * FROM terms WHERE {' AND '.join(clauses)}", params
            ).fetchall()
            order = _template_order(conn)
        finally:
            conn.close()

    items = sorted((_hydrate(row) for row in rows), key=_sort_key(order))
    return {"items": items, "total": len(items)}


def stats() -> dict[str, Any]:
    """只统计当前生效的词条：停用的、屏蔽的、整套关掉的模板都不算。"""
    with _lock:
        conn = connect()
        try:
            enabled_templates = _templates_state(conn)
            rows = conn.execute(
                "SELECT template, COUNT(*) FROM terms WHERE hidden = 0 "
                "AND enabled = 1 GROUP BY template"
            ).fetchall()
        finally:
            conn.close()
    counts = {row[0]: row[1] for row in rows}
    active = sum(
        count
        for template, count in counts.items()
        if template == "custom" or enabled_templates.get(template, True)
    )
    return {
        "total": active,
        "custom": counts.get("custom", 0),
        "templates": enabled_templates,
        "version": stamp(),
    }


# --------------------------------------------------------------------------
# 写入
# --------------------------------------------------------------------------
def create_term(fields: dict[str, Any]) -> dict[str, Any]:
    term = _clean_text(fields.get("term"), MAX_TERM)
    if not term:
        raise ValueError("术语不能为空")
    aliases = _split_aliases(fields.get("aliases"))
    definition = _clean_text(fields.get("definition"), MAX_DEFINITION)
    template = str(fields.get("template") or CUSTOM_TEMPLATE).strip()
    now = _now()

    with _lock:
        conn = connect()
        try:
            _require_template(conn, template)
            cursor = conn.execute(
                """INSERT INTO terms(template, term, term_key, definition, aliases,
                                     enabled, hidden, sort_order, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,0,0,?,?)""",
                (
                    template,
                    term,
                    normalize(term),
                    definition,
                    json.dumps(aliases, ensure_ascii=False),
                    1 if fields.get("enabled", True) else 0,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM terms WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        finally:
            conn.close()
    _touch()
    return _hydrate(row)


def get_term(term_id: int) -> dict[str, Any] | None:
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM terms WHERE id = ?", (term_id,)).fetchone()
        finally:
            conn.close()
    return _hydrate(row) if row else None


def update_term(term_id: int, patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM terms WHERE id = ?", (term_id,)).fetchone()
            if row is None:
                raise KeyError(term_id)
            current = _hydrate(row)
            owner = conn.execute(
                "SELECT builtin FROM templates WHERE id = ?", (current["template"],)
            ).fetchone()
            if owner is not None and owner[0] and "term" in patch:
                raise ValueError("内置模板的术语不能改名，可以停用它")

            fields: dict[str, Any] = {}
            if "term" in patch:
                term = _clean_text(patch.get("term"), MAX_TERM)
                if not term:
                    raise ValueError("术语不能为空")
                fields["term"] = term
                fields["term_key"] = normalize(term)
            if "definition" in patch:
                fields["definition"] = _clean_text(patch.get("definition"), MAX_DEFINITION)
            if "aliases" in patch:
                fields["aliases"] = json.dumps(
                    _split_aliases(patch.get("aliases")), ensure_ascii=False
                )
            if "enabled" in patch:
                fields["enabled"] = 1 if patch.get("enabled") else 0

            if not fields:
                return current
            fields["updated_at"] = _now()
            assignments = ", ".join(f"{key} = ?" for key in fields)
            conn.execute(
                f"UPDATE terms SET {assignments} WHERE id = ?",
                [*fields.values(), term_id],
            )
            fresh = conn.execute("SELECT * FROM terms WHERE id = ?", (term_id,)).fetchone()
        finally:
            conn.close()
    _touch()
    return _hydrate(fresh)


def delete_term(term_id: int) -> bool:
    """自定义词条直接删；模板词条留一行 ``hidden``，免得下次启动又补回来。"""
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM terms WHERE id = ?", (term_id,)).fetchone()
            if row is None:
                return False
            if row["template"] == "custom":
                conn.execute("DELETE FROM terms WHERE id = ?", (term_id,))
            else:
                conn.execute(
                    "UPDATE terms SET hidden = 1, enabled = 0, updated_at = ? WHERE id = ?",
                    (_now(), term_id),
                )
        finally:
            conn.close()
    _touch()
    return True


def _reset_template(conn: sqlite3.Connection, name: str, prune: bool = True) -> int:
    """按内置内容重写一套模板：恢复屏蔽、覆盖用户改动、补齐缺失的词。

    ``prune`` 为真时把模板里多出来的行也删掉——模板内容改版时用，
    否则用户自己加进内置模板的词条会被误伤。
    """
    now = _now()
    if prune:
        conn.execute(
            "DELETE FROM terms WHERE template = ? AND term_key NOT IN ("
            + ",".join("?" * len(_TEMPLATES[name]))
            + ")",
            [name, *[normalize(term) for term, _ in _TEMPLATES[name]]],
        )
    conn.execute(
        "UPDATE terms SET hidden = 0, enabled = 1, updated_at = ? WHERE template = ?",
        (now, name),
    )
    for position, (term, aliases) in enumerate(_TEMPLATES[name]):
        key = normalize(term)
        existing = conn.execute(
            "SELECT id FROM terms WHERE template = ? AND term_key = ?",
            (name, key),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE terms SET term = ?, definition = '', aliases = ?, "
                "sort_order = ?, updated_at = ? WHERE id = ?",
                (
                    term,
                    json.dumps(aliases, ensure_ascii=False),
                    position,
                    now,
                    existing[0],
                ),
            )
        else:
            conn.execute(
                """INSERT INTO terms(template, term, term_key, definition, aliases,
                                     enabled, hidden, sort_order, created_at, updated_at)
                   VALUES (?,?,?,'',?,1,0,?,?,?)""",
                (
                    name,
                    term,
                    key,
                    json.dumps(aliases, ensure_ascii=False),
                    position,
                    now,
                    now,
                ),
            )
    return len(_TEMPLATES[name])


def reset_template(name: str) -> int:
    """把某套模板恢复到内置内容：取消屏蔽、清掉用户改动、补齐缺失的词。"""
    if name not in TEMPLATE_IDS:
        raise ValueError(f"未知模板：{name}")
    with _lock:
        conn = connect()
        try:
            restored = _reset_template(conn, name, prune=False)
        finally:
            conn.close()
    _touch()
    return restored


# --------------------------------------------------------------------------
# 批量粘贴
# --------------------------------------------------------------------------
def parse_bulk(text: str) -> dict[str, Any]:
    """一行一条，用英文逗号分列。

    ``词`` / ``词,释义`` / ``词,替换词1,替换词2,释义``——
    三段以上时，中间的都是替换词，最后一段是释义。
    """
    items: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()

    for number, raw in enumerate(str(text or "").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in re.split(r"[,，]", line)]
        term = _clean_text(parts[0] if parts else "", MAX_TERM)
        if not term:
            errors.append({"line": number, "message": "缺少术语", "text": line})
            continue
        if len(parts) >= 3:
            aliases = _split_aliases(parts[1:-1])
            definition = _clean_text(parts[-1], MAX_DEFINITION)
        elif len(parts) == 2:
            aliases = []
            definition = _clean_text(parts[1], MAX_DEFINITION)
        else:
            aliases = []
            definition = ""
        key = normalize(term)
        if key in seen:
            errors.append({"line": number, "message": "同一批里重复", "text": line})
            continue
        seen.add(key)
        items.append({"term": term, "aliases": aliases, "definition": definition})
        if len(items) >= MAX_BULK:
            break
    return {"items": items, "errors": errors, "truncated": len(items) >= MAX_BULK}


def bulk_create(text: str) -> dict[str, int]:
    parsed = parse_bulk(text)
    created = updated = 0
    now = _now()
    with _lock:
        conn = connect()
        try:
            for item in parsed["items"]:
                key = normalize(item["term"])
                existing = conn.execute(
                    "SELECT id FROM terms WHERE template = 'custom' AND term_key = ?",
                    (key,),
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE terms SET aliases = ?, definition = ?, updated_at = ? "
                        "WHERE id = ?",
                        (
                            json.dumps(item["aliases"], ensure_ascii=False),
                            item["definition"],
                            now,
                            existing[0],
                        ),
                    )
                    updated += 1
                else:
                    conn.execute(
                        """INSERT INTO terms(template, term, term_key, definition, aliases,
                                             enabled, hidden, sort_order, created_at, updated_at)
                           VALUES ('custom',?,?,?,?,1,0,0,?,?)""",
                        (
                            item["term"],
                            key,
                            item["definition"],
                            json.dumps(item["aliases"], ensure_ascii=False),
                            now,
                            now,
                        ),
                    )
                    created += 1
        finally:
            conn.close()
    if created or updated:
        _touch()
    return {"created": created, "updated": updated, "errors": len(parsed["errors"])}


# --------------------------------------------------------------------------
# 纠错
#
# 快照在内存里：别名 -> 规范写法。转写每句都要过一遍，不值得每回合碰 SQLite。
# --------------------------------------------------------------------------
class _Snapshot:
    __slots__ = ("stamp", "terms", "aliases", "pattern")

    def __init__(self, terms: list[dict[str, Any]]):
        self.stamp = _stamp
        self.terms = terms
        self.aliases: dict[str, str] = {}
        for item in terms:
            key = item["term"].casefold()
            self.aliases.setdefault(key, item["term"])
        for item in terms:
            for alias in item["aliases"]:
                key = alias.casefold()
                if key and key not in self.aliases:
                    self.aliases[key] = item["term"]

        keys = sorted(self.aliases, key=len, reverse=True)
        self.pattern = (
            re.compile(
                r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(key) for key in keys) + r")(?![A-Za-z0-9])",
                re.IGNORECASE,
            )
            if keys
            else None
        )


_cache: dict[str, _Snapshot] = {}


def _snapshot() -> _Snapshot:
    key = str(db_path())
    cached = _cache.get(key)
    if cached is not None and cached.stamp == _stamp:
        return cached
    with _lock:
        built = _Snapshot(active_terms())
    _cache[key] = built
    return built


def correct(text: str) -> tuple[str, list[dict[str, str]]]:
    """把转写里被听错的术语改回规范写法；返回新文本和命中列表。"""
    snapshot = _snapshot()
    if not text or snapshot.pattern is None:
        return text, []

    hits: list[dict[str, str]] = []

    def replace(match: re.Match[str]) -> str:
        raw = match.group(0)
        canonical = snapshot.aliases.get(raw.casefold())
        if not canonical or canonical == raw:
            return raw
        hits.append({"from": raw, "to": canonical})
        return canonical

    return snapshot.pattern.sub(replace, text), hits


def mentions(text: str, item: dict[str, Any]) -> bool:
    return _mentioned((text or "").casefold(), item)


def _mentioned(lowered: str, item: dict[str, Any]) -> bool:
    if not lowered:
        return False
    if item["term"].casefold() in lowered:
        return True
    return any(alias.casefold() in lowered for alias in item["aliases"])


def render_glossary(text: str) -> str:
    """本场对话里出现过的、带释义的词条，压成一段提示词；空时返回空串。"""
    lowered = (text or "").casefold()
    lines: list[str] = []
    used = 0
    for item in _snapshot().terms:
        definition = str(item.get("definition") or "").strip()
        if not definition or not _mentioned(lowered, item):
            continue
        line = f"{item['term']}：{definition[:INJECT_DEFINITION]}"
        if used + len(line) + 1 > PROMPT_BUDGET:
            break
        lines.append(line)
        used += len(line) + 1
    if not lines:
        return ""
    return "<glossary>\n以下几句话里出现过的术语，按这里的含义理解：\n" + "\n".join(lines) + "\n</glossary>"


def referenced_confusions(text: str) -> list[dict[str, Any]]:
    """会话结束后找「疑似被听错的术语」：转写里出现、但没被纠正的近似词。

    离线跑，不进实时链路：编辑距离只在整场结束后算一次，误判的代价只是
    多给用户看一眼，不会改坏任何一句话。
    """
    snapshot = _snapshot()
    if not text:
        return []

    known = set(snapshot.aliases)
    tokens = set(re.findall(r"[A-Za-z][A-Za-z0-9]{1,9}", text))
    suggestions: list[dict[str, Any]] = []
    for token in tokens:
        lowered = token.casefold()
        if lowered in known:
            continue
        best: tuple[int, str] | None = None
        for key in known:
            if len(key) != len(lowered):
                continue
            distance = sum(1 for a, b in zip(key, lowered) if a != b)
            if distance == 1 and (best is None or key < best[1]):
                best = (distance, key)
        if best is not None:
            suggestions.append(
                {"from": token, "to": snapshot.aliases[best[1]], "reason": "near-miss"}
            )
    return suggestions[:20]


# --------------------------------------------------------------------------
# 上一场会话的回顾
#
# 只在内存里，进程重启就没了——它是给「刚面完，回头看一眼」用的，
# 不是需要留档的数据。
# --------------------------------------------------------------------------
_recent: dict[str, list[dict[str, Any]]] = {"corrections": [], "suggestions": []}


def record_session(raw_text: str, corrections: Iterable[dict[str, str]]) -> None:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for hit in corrections:
        key = (str(hit.get("from") or ""), str(hit.get("to") or ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append({"from": key[0], "to": key[1]})
    _recent["corrections"] = deduped[:20]
    _recent["suggestions"] = referenced_confusions(raw_text)


def recent() -> dict[str, list[dict[str, Any]]]:
    return {"corrections": list(_recent["corrections"]), "suggestions": list(_recent["suggestions"])}


def clear_recent() -> None:
    _recent["corrections"] = []
    _recent["suggestions"] = []
