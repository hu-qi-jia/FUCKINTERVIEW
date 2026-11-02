"""数据目录迁移：先把所有文件备到目标目录里的临时区，全部成功后才切配置。

旧实现是一个文件一个文件地搬，每搬一类就检查一次目标冲突；中途失败时
``settings.json`` 已经指向新目录，重试又会因为「源 == 目标」把缺失的数据
静默跳过。这里改成：

1. 预检所有目标冲突和可写性，任何一项不满足都直接报错，配置不动；
2. 把档案 / 问答库 / 术语库 / 历史 / 资料复制到目标目录下的临时目录；
3. 逐项 rename 到最终位置（同一文件系统内是原子的），全部成功才写配置；
4. 任何一步失败都删除临时区、回滚已经 rename 的文件，旧目录继续生效。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path

from app import documents, materials, qa, qa_index, sessions, terms
from app.config import save_storage_paths
from app.fsutil import atomic_replace

MARKER = ".interview-migration.json"


class StorageConflict(ValueError):
    """目标目录里已经有同名数据，拒绝覆盖。"""


def _source_items(source: Path) -> list[tuple[str, str]]:
    """(文件名, 类型)：file / db / dir。只收录源目录里真实存在的项。"""
    items: list[tuple[str, str]] = []
    for name in (materials.PROFILES_FILENAME, documents.DOCUMENTS_FILENAME):
        if (source / name).is_file():
            items.append((name, "file"))
    for name in (qa.QA_FILENAME, terms.TERMS_FILENAME, sessions.SESSION_FILENAME):
        if (source / name).is_file():
            items.append((name, "db"))
    files_dir = source / documents.FILES_DIRNAME
    if files_dir.is_dir() and any(files_dir.iterdir()):
        items.append((documents.FILES_DIRNAME, "dir"))
    return items


def _assert_writable(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    fd, probe = tempfile.mkstemp(dir=directory, prefix=".write-test-")
    os.close(fd)
    os.unlink(probe)


def _preflight(source: Path, target: Path) -> list[tuple[str, str]]:
    items = _source_items(source)
    conflicts = []
    for name, kind in items:
        dest = target / name
        if kind == "dir":
            if dest.is_dir() and any(dest.iterdir()):
                conflicts.append(name)
        elif dest.exists():
            conflicts.append(name)
    if conflicts:
        raise StorageConflict(
            "目标目录已存在同名数据："
            + "、".join(conflicts)
            + "。请先备份或换一个空目录。"
        )
    return items


def _vacuum_into(source: Path, target: Path) -> None:
    """WAL 模式下不能直接复制 .db；让 SQLite 导出一份一致快照。"""
    conn = sqlite3.connect(str(source), timeout=10)
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()


def _stage(source: Path, staging: Path, items: list[tuple[str, str]]) -> None:
    for name, kind in items:
        src = source / name
        dst = staging / name
        if kind == "db":
            _vacuum_into(src, dst)
        elif kind == "dir":
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)


def _remove(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink()
    except OSError:
        pass


def _remove_marker(target: Path) -> None:
    _remove(target / MARKER)


def _write_marker(target: Path, source: Path) -> None:
    # 进程在 rename 中途被杀掉时，下一次可以接着搬缺的文件，
    # 而不是因为配置还没切就以为「什么都没发生」。
    (target / MARKER).write_text(
        json.dumps(
            {"source": str(source), "startedAt": time.time()}, ensure_ascii=False
        ),
        encoding="utf-8",
    )


def _read_marker(target: Path) -> dict | None:
    path = target / MARKER
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def migrate_data_dir(raw_target: str, *, migrate: bool = True) -> dict:
    """切换数据目录。失败时抛异常，配置仍指向旧目录。

    ``migrate=False`` 表示只换目录、不复制已有数据（用户明确要一个空库）。
    """
    configured = materials.data_dir()
    target = materials.resolve_dir(raw_target)
    if target.exists() and not target.is_dir():
        raise ValueError(f"{target} 不是目录")

    try:
        _assert_writable(target)
    except OSError as error:
        raise ValueError(f"目标目录不可写：{target}（{error}）") from error

    marker = _read_marker(target)
    source = configured
    resuming = False
    if marker:
        old_source = str(marker.get("source") or "").strip()
        if old_source:
            candidate = Path(old_source)
            if candidate.is_dir() and candidate.resolve() != target.resolve():
                source = candidate
                resuming = True

    if target.resolve() == source.resolve():
        if not migrate:
            save_storage_paths(data_dir=str(target))
        _remove_marker(target)
        return materials.storage_info()

    if not migrate:
        _remove_marker(target)
        save_storage_paths(data_dir=str(target))
        _reset_caches()
        return materials.storage_info()

    items = _source_items(source)
    if resuming:
        # 上一次已经搬过去的文件不用再搬，也不当成目标冲突。
        items = [(name, kind) for name, kind in items if not (target / name).exists()]
    else:
        items = _preflight(source, target)
    if not items:
        save_storage_paths(data_dir=str(target))
        _remove_marker(target)
        _reset_caches()
        return materials.storage_info()

    staging = target / f".migrate-{uuid.uuid4().hex}"
    moved: list[Path] = []
    wrote_marker = False
    try:
        staging.mkdir()
        _write_marker(target, source)
        wrote_marker = True
        _stage(source, staging, items)
        for name, _kind in items:
            destination = target / name
            atomic_replace(staging / name, destination)
            moved.append(destination)
        save_storage_paths(data_dir=str(target))
    except Exception:
        # 配置还没写成功（或写配置本身失败）：把已经 rename 的文件撤掉，
        # 旧目录里的原件从未被移动，仍然完整可用。
        for path in moved:
            _remove(path)
        if wrote_marker:
            _remove_marker(target)
        _reset_caches()
        raise
    finally:
        _remove(staging)

    _remove_marker(target)
    _reset_caches()
    return materials.storage_info()


def _reset_caches() -> None:
    qa.reset_cache()
    terms.reset_cache()
    sessions.reset_cache()
    qa_index.invalidate()
