"""向量化与检索。

模型在进程内做单例懒加载，向量由一条后台线程异步补算；
检索把「向量召回」和「全文召回」用 RRF 融合，避免两套分数量纲对不上。

模型默认 ``BAAI/bge-small-zh-v1.5``（512 维，ONNX，不依赖 torch）。
两侧都不加 bge 的查询指令前缀：我们的检索是问题对问题、同分布，
实测加前缀反而把同义问题的相似度从 0.82 压到 0.70。
"""

from __future__ import annotations

import os
import queue
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from app import qa as store
from app.config import ROOT, load_settings

# HuggingFace 直连不通，默认走镜像；用户自己设了就尊重用户的。
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
RRF_K = 60
ANSWER_PREVIEW_CHARS = 1200

_model_lock = threading.Lock()
_model: Any = None
_model_name: str | None = None
# 模型加载失败后记住原因，冷却期内直接失败，不再每次检索都走一遍
# fastembed 的 3 + 9 + 27 秒下载退避。冷却期结束或用户改配置后可重试。
_model_error: str | None = None
_model_failed_at = 0.0
MODEL_RETRY_COOLDOWN_SECS = 600.0

_worker_started = False
_worker_lock = threading.Lock()
_queue: "queue.Queue[tuple[int, bool]]" = queue.Queue()
_last_error: str | None = None


# --------------------------------------------------------------------------
# 模型
# --------------------------------------------------------------------------
def model_name() -> str:
    settings = load_settings()
    return str(settings.get("embedding", {}).get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def model_dir() -> Path:
    raw = str(load_settings().get("storage", {}).get("model_dir") or "").strip()
    if not raw:
        # 默认跟随当前数据目录：开发版是 config/models，安装版是
        # userData/data/models；用户把数据目录改到别的盘时，模型也跟过去。
        from app.materials import data_dir

        return data_dir() / "models"
    path = Path(raw).expanduser()
    return path if path.is_absolute() else (ROOT / path)


def get_model(*, force: bool = False):
    """懒加载单例；模型常驻内存（约 200MB），用完不卸载。

    加载失败会缓存错误，``MODEL_RETRY_COOLDOWN_SECS`` 内不再重试——
    检索会立刻降级为关键词召回，而不是让每个请求都卡 39 秒。
    """
    global _model, _model_name, _model_error, _model_failed_at
    name = model_name()
    if _model is not None and _model_name == name:
        return _model
    with _model_lock:
        if _model is not None and _model_name == name:
            return _model
        if (
            not force
            and _model_error is not None
            and time.monotonic() - _model_failed_at < MODEL_RETRY_COOLDOWN_SECS
        ):
            raise RuntimeError(_model_error)
        from fastembed import TextEmbedding

        try:
            loaded = TextEmbedding(model_name=name, cache_dir=str(model_dir()))
        except Exception as error:  # 下载失败 / 目录不可写 / 模型名不认识
            _model_error = (
                f"加载向量模型 {name} 失败：{error}。"
                f"模型缓存在 {model_dir()}，首次使用需要联网下载（当前走 {os.environ.get('HF_ENDPOINT')}）。"
            )
            _model_failed_at = time.monotonic()
            raise RuntimeError(_model_error) from error
        _model = loaded
        _model_name = name
        _model_error = None
        return _model


def reset_model_failure() -> None:
    """清掉失败缓存（用户改了模型目录 / 模型名，或主动重试后调用）。"""
    global _model_error
    with _model_lock:
        _model_error = None


def model_available() -> bool:
    return _model is not None and _model_name == model_name()


def embed(texts: list[str]) -> np.ndarray:
    """返回已 L2 归一化的 float32 矩阵。"""
    if not texts:
        return np.zeros((0, 0), dtype=np.float32)
    model = get_model()
    vectors = np.asarray(list(model.embed(texts)), dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


def embed_one(text: str) -> np.ndarray:
    return embed([text])[0]


# --------------------------------------------------------------------------
# 后台索引
# --------------------------------------------------------------------------
def ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    with _worker_lock:
        if _worker_started:
            return
        store.reset_indexing()
        thread = threading.Thread(target=_worker_loop, name="qa-indexer", daemon=True)
        thread.start()
        _worker_started = True


def enqueue(qa_id: int) -> None:
    ensure_worker()
    _queue.put(int(qa_id))


def enqueue_many(ids: list[int]) -> None:
    for qa_id in ids:
        enqueue(qa_id)


def _worker_loop() -> None:
    global _last_error
    while True:
        qa_id = _queue.get()
        try:
            _index_one(qa_id)
        except Exception as error:  # 单条失败不能拖垮整条队列
            _last_error = str(error)
            try:
                store.mark_index(qa_id, "failed", str(error))
            except Exception:
                pass
        finally:
            _queue.task_done()


def _index_one(qa_id: int) -> None:
    row = store.get_qa(qa_id)
    if row is None:
        return
    store.mark_index(qa_id, "indexing")

    name = model_name()
    content_rev = int(row["content_rev"])

    texts: list[str] = [row["question"]]
    kinds: list[tuple[str, int | None]] = [("question", None)]
    for alias_id, text in _alias_rows(qa_id):
        texts.append(text)
        kinds.append(("alias", alias_id))
    answer_text = str(row["answer"] or "")[:ANSWER_PREVIEW_CHARS]
    if answer_text:
        texts.append(answer_text)
        kinds.append(("answer", None))

    vectors = embed(texts)
    dim = int(vectors.shape[1])
    payload = [
        {
            "kind": kind,
            "ref_id": ref_id,
            "text": text,
            "model": name,
            "dim": dim,
            "vector": vectors[index].astype(np.float32).tobytes(),
        }
        for index, ((kind, ref_id), text) in enumerate(zip(kinds, texts))
    ]
    store.replace_vectors(qa_id, payload, content_rev)
    store.mark_index(qa_id, "ready")
    store.set_meta(embedding_model=name, embedding_dim=dim)


def _alias_rows(qa_id: int) -> list[tuple[int, str]]:
    with store._lock:  # 同模块内的读，复用存储层的锁与连接
        conn = store.connect()
        try:
            return [
                (row[0], row[1])
                for row in conn.execute(
                    "SELECT id, text FROM qa_aliases WHERE qa_id = ? ORDER BY position", (qa_id,)
                )
            ]
        finally:
            conn.close()


def index_now(qa_id: int) -> None:
    """同步索引一条（导入确认后用，省一次排队）。"""
    _index_one(qa_id)


def status() -> dict[str, Any]:
    counts = store.stats()
    by_status = counts.get("byStatus") or {}
    return {
        "model": model_name(),
        "modelDir": str(model_dir()),
        "dim": counts.get("dim"),
        "total": counts.get("total", 0),
        "ready": by_status.get("ready", 0),
        "pending": by_status.get("pending", 0),
        "indexing": by_status.get("indexing", 0),
        "failed": by_status.get("failed", 0),
        "queue": _queue.qsize(),
        "lastError": _last_error,
        "modelReady": _model is not None,
        "modelError": _model_error,
    }


def reindex(scope: str = "all") -> int:
    if scope == "failed":
        ids = [
            row[0]
            for row in _query_ids("SELECT id FROM qa WHERE index_status = 'failed'")
        ]
    elif scope == "stale":
        ids = store.stale_ids()
    else:
        ids = _query_ids("SELECT id FROM qa")
        for qa_id in ids:
            store.mark_index(qa_id, "pending")
    enqueue_many(ids)
    return len(ids)


def _query_ids(sql: str) -> list[int]:
    with store._lock:
        conn = store.connect()
        try:
            return [row[0] for row in conn.execute(sql)]
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 向量快照（内存缓存，写入计数变化即失效）
# --------------------------------------------------------------------------
_snapshot_lock = threading.Lock()
_snapshot: dict[str, Any] = {"stamp": -1, "model": None, "ids": None, "mat": None, "rows": []}


def invalidate() -> None:
    with _snapshot_lock:
        _snapshot["stamp"] = -1


def _get_snapshot() -> dict[str, Any]:
    name = model_name()
    stamp = store.stamp()
    with _snapshot_lock:
        if _snapshot["stamp"] == stamp and _snapshot["model"] == name:
            return _snapshot

    rows = store.vector_rows(name)
    ids: list[int] = []
    meta: list[dict[str, Any]] = []
    vectors: list[np.ndarray] = []
    for row in rows:
        vector = np.frombuffer(row["vector"], dtype=np.float32)
        if vector.size != int(row["dim"]):
            continue
        ids.append(int(row["qa_id"]))
        meta.append(
            {
                "qa_id": int(row["qa_id"]),
                "kind": row["kind"],
                "ref_id": row["ref_id"],
                "text": row["text"],
            }
        )
        vectors.append(vector)

    with _snapshot_lock:
        _snapshot.update(
            {
                "stamp": stamp,
                "model": name,
                "ids": np.asarray(ids, dtype=np.int64) if ids else np.zeros(0, dtype=np.int64),
                "mat": np.vstack(vectors) if vectors else np.zeros((0, 0), dtype=np.float32),
                "rows": meta,
            }
        )
        return _snapshot


# --------------------------------------------------------------------------
# 检索
# --------------------------------------------------------------------------
def _vector_hits(query: str, top: int) -> list[dict[str, Any]]:
    snapshot = _get_snapshot()
    matrix = snapshot["mat"]
    if matrix.size == 0:
        return []
    vector = embed_one(query)
    if vector.shape[0] != matrix.shape[1]:
        return []  # 换了模型但还没重建索引
    scores = matrix @ vector
    take = min(top, scores.shape[0])
    top_index = np.argpartition(-scores, take - 1)[:take]
    top_index = top_index[np.argsort(-scores[top_index])]

    best: dict[int, dict[str, Any]] = {}
    for index in top_index:
        row = snapshot["rows"][int(index)]
        qa_id = row["qa_id"]
        score = float(scores[int(index)])
        existing = best.get(qa_id)
        if existing is None or score > existing["score"]:
            best[qa_id] = {
                "qa_id": qa_id,
                "score": score,
                "matchedText": row["text"],
                "matchedKind": row["kind"],
            }
    return sorted(best.values(), key=lambda item: -item["score"])


def _keyword_hits(query: str, top: int) -> list[dict[str, Any]]:
    return store.keyword_search(query, top)


def _rrf(lists: list[tuple[str, list[dict[str, Any]]]]) -> dict[int, dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}
    for source, hits in lists:
        for rank, hit in enumerate(hits):
            entry = merged.setdefault(
                hit["qa_id"],
                {"qa_id": hit["qa_id"], "rrf": 0.0, "score": 0.0, "matchedBy": [], "matchedText": None},
            )
            entry["rrf"] += 1.0 / (RRF_K + rank + 1)
            entry["matchedBy"].append(source)
            if source == "vector":
                # 余弦是唯一有绝对意义的分数，直接对外给这个。
                entry["score"] = max(entry["score"], hit["score"])
                entry["matchedText"] = entry["matchedText"] or hit["matchedText"]
    return merged


def search(
    query: str,
    limit: int = 20,
    types: list[str] | None = None,
    profile_id: str | None = None,
) -> dict[str, Any]:
    text = (query or "").strip()
    if not text:
        return {"results": [], "mode": "empty", "vectorAvailable": model_available()}

    limit = max(1, min(100, int(limit or 20)))
    vector_error: str | None = None
    try:
        vector_hits = _vector_hits(text, 50)
    except Exception as error:
        # 模型没下载 / 目录不可写时不能把检索整体打死：退回关键词召回，
        # 界面上给一条明确的提示。
        vector_error = str(error)
        vector_hits = []
    keyword_hits = _keyword_hits(text, 50)
    merged = _rrf([("vector", vector_hits), ("keyword", keyword_hits)])

    vector_ok = vector_error is None
    if not merged:
        return {
            "results": [],
            "mode": "empty",
            "vectorAvailable": vector_ok,
            "vectorError": vector_error,
        }

    rows = store.load_qa_many(list(merged.keys()))
    types = {t for t in (types or []) if t}

    results = []
    for qa_id, entry in merged.items():
        item = rows.get(qa_id)
        if not item or not item["enabled"]:
            continue
        if types and item["type"] not in types:
            continue
        if profile_id and item["profile_id"] not in (None, profile_id):
            continue
        results.append(
            {
                **item,
                "score": round(entry["score"], 4),
                "rrf": round(entry["rrf"], 6),
                "matchedText": entry["matchedText"],
                "matchedBy": entry["matchedBy"],
            }
        )

    results.sort(key=lambda item: (-item["rrf"], item["id"]))
    if not vector_ok:
        mode = "keyword"
    elif len(results) and {m for r in results for m in r["matchedBy"]} == {
        "vector",
        "keyword",
    }:
        mode = "hybrid"
    else:
        mode = "search"
    return {
        "results": results[:limit],
        "mode": mode,
        "vectorAvailable": vector_ok,
        "vectorError": vector_error,
    }
