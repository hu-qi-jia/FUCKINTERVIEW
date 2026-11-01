"""「其他资料」的本地存储：原件 + 一份元数据索引。

原件放在 ``data_dir/documents/<id>.<md|pdf>``，索引是同目录下的
``documents.json``（和 profiles.json 平级）。这份数据只在面试页展示，
不参与 prompt、检索或任何模型调用——它和面试档案是两套东西。

读取失败时返回空索引而不是抛错，和面试档案保持同一种容错策略。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.materials import data_dir

SCHEMA_VERSION = 1
DOCUMENTS_FILENAME = "documents.json"
FILES_DIRNAME = "documents"

# 扩展名 → 存储用的类型；顺手也给前端一个不用猜的字段。
ALLOWED_EXTENSIONS = {".md": "md", ".pdf": "pdf"}
MAX_BYTES = 100 * 1024 * 1024
MAX_TITLE = 120

_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# 路径与读写
# --------------------------------------------------------------------------
def documents_dir() -> Path:
    return data_dir() / FILES_DIRNAME


def index_path() -> Path:
    return data_dir() / DOCUMENTS_FILENAME


def _empty_store() -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "documents": []}


def _read_store() -> dict[str, Any]:
    path = index_path()
    if not path.exists():
        return _empty_store()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_store()
    if not isinstance(data, dict) or not isinstance(data.get("documents"), list):
        return _empty_store()
    documents = [entry for raw in data["documents"] if (entry := _sanitize(raw))]
    data["documents"] = documents
    data.setdefault("schemaVersion", SCHEMA_VERSION)
    return data


def _write_store(store: dict[str, Any]) -> None:
    path = index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# --------------------------------------------------------------------------
# 形状
# --------------------------------------------------------------------------
def _sanitize(raw: Any) -> dict[str, Any] | None:
    """把索引里的一条记录整理成固定形状；关键字段不对就丢掉这一条。"""
    if not isinstance(raw, dict):
        return None
    doc_id = str(raw.get("id") or "")
    if not _ID_PATTERN.match(doc_id):
        return None
    ext = str(raw.get("ext") or "")
    if ext not in ("md", "pdf"):
        return None
    try:
        size = int(raw.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    return {
        "id": doc_id,
        "title": str(raw.get("title") or "").strip()[:MAX_TITLE] or "未命名资料",
        "filename": str(raw.get("filename") or ""),
        "ext": ext,
        "size": max(size, 0),
        "createdAt": str(raw.get("createdAt") or _now()),
    }


def _find(store: dict[str, Any], doc_id: str) -> dict[str, Any]:
    for entry in store["documents"]:
        if entry["id"] == doc_id:
            return entry
    raise KeyError(doc_id)


def _document_path(entry: dict[str, Any]) -> Path:
    return documents_dir() / f"{entry['id']}.{entry['ext']}"


def _unique_title(taken: set[str], base: str) -> str:
    """同名资料自动加序号，不覆盖已有条目。

    截断在前、拼序号在后：否则名字顶满 MAX_TITLE 时，序号会被截掉，
    ``title in taken`` 永远成立，循环停不下来。
    """
    title = base
    index = 1
    while title in taken:
        suffix = f" ({index})"
        title = base[: MAX_TITLE - len(suffix)] + suffix
        index += 1
    return title


# --------------------------------------------------------------------------
# 接口
# --------------------------------------------------------------------------
def list_documents() -> list[dict[str, Any]]:
    """按上传顺序倒序：最新上传的排在最前面。"""
    with _lock:
        documents = _read_store()["documents"]
    return list(reversed(documents))


def get_document(doc_id: str) -> dict[str, Any]:
    with _lock:
        return _find(_read_store(), doc_id)


def document_file(doc_id: str) -> tuple[Path, dict[str, Any]]:
    """返回原件路径和它的索引记录；索引或文件缺失都按 404 处理。"""
    with _lock:
        entry = _find(_read_store(), doc_id)
        path = _document_path(entry)
    if not path.is_file():
        raise KeyError(doc_id)
    return path, entry


def add_document(filename: str, data: bytes) -> dict[str, Any]:
    name = Path(filename or "").name.strip()
    ext = Path(name).suffix.lower()
    kind = ALLOWED_EXTENSIONS.get(ext)
    if not kind:
        raise ValueError("只支持 .md 和 .pdf 文件")
    if not data:
        raise ValueError("文件是空的")
    if len(data) > MAX_BYTES:
        raise ValueError("文件超过 100MB")

    base = name[: -len(ext)].strip()[:MAX_TITLE] or "未命名资料"
    doc_id = uuid.uuid4().hex
    entry = {
        "id": doc_id,
        "title": base,
        "filename": name,
        "ext": kind,
        "size": len(data),
        "createdAt": _now(),
    }

    target_dir = documents_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{doc_id}.{kind}"
    fd, tmp_path = tempfile.mkstemp(dir=target_dir, suffix=".upload")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp_path, path)
    except OSError:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

    with _lock:
        store = _read_store()
        taken = {item["title"] for item in store["documents"]}
        entry["title"] = _unique_title(taken, base)
        store["documents"].append(entry)
        try:
            _write_store(store)
        except OSError:
            path.unlink(missing_ok=True)
            raise
    return entry


def rename_document(doc_id: str, title: str) -> dict[str, Any]:
    value = str(title or "").strip()[:MAX_TITLE]
    if not value:
        raise ValueError("名称不能为空")

    with _lock:
        store = _read_store()
        entry = _find(store, doc_id)
        taken = {item["title"] for item in store["documents"] if item["id"] != doc_id}
        if value in taken:
            value = _unique_title(taken, value)
        entry["title"] = value
        _write_store(store)
        return entry


def delete_document(doc_id: str) -> None:
    with _lock:
        store = _read_store()
        entry = _find(store, doc_id)
        store["documents"] = [item for item in store["documents"] if item["id"] != doc_id]
        _write_store(store)
    _document_path(entry).unlink(missing_ok=True)


def migrate_to(source: Path, target: Path) -> bool:
    """切换数据目录：把索引和原件复制到新目录，旧目录原样保留。

    目标目录已有 documents.json 就拒绝，和 profiles.json 的迁移规则一致。
    原件先复制、索引最后落位，中途失败时新目录不会出现「有索引没文件」。
    """
    source = Path(source)
    target = Path(target)
    if source == target:
        return False
    src_index = source / DOCUMENTS_FILENAME
    if not src_index.is_file():
        return False
    dst_index = target / DOCUMENTS_FILENAME
    if dst_index.exists():
        raise ValueError(
            f"目标目录已存在 {DOCUMENTS_FILENAME}，请先备份或换一个目录"
        )

    src_files = source / FILES_DIRNAME
    target.mkdir(parents=True, exist_ok=True)
    if src_files.is_dir():
        shutil.copytree(src_files, target / FILES_DIRNAME, dirs_exist_ok=True)
    shutil.copy2(src_index, dst_index)
    return True
