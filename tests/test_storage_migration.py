"""数据目录迁移：失败不动配置、重试能补齐、成功后才切目录。"""

from __future__ import annotations

import json
import shutil
import sqlite3

import pytest

import app.config as config
import app.documents as documents
import app.materials as materials
import app.qa as qa
import app.qa_index as qa_index
import app.sessions as sessions
import app.storage_migration as storage_migration
import app.terms as terms


def make_db(path):
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO t(value) VALUES ('x')")
    conn.commit()
    conn.close()


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    home = tmp_path / "home"
    source = home / "config"
    target = tmp_path / "target"
    source.mkdir(parents=True)
    target.mkdir(parents=True)

    monkeypatch.setenv("INTERVIEW_DATA_DIR", str(home))
    monkeypatch.setattr(materials, "data_dir", lambda: source)
    qa.reset_cache()
    terms.reset_cache()
    sessions.reset_cache()
    qa_index.invalidate()

    (source / "profiles.json").write_text(
        json.dumps({"schemaVersion": 1, "profiles": []}), encoding="utf-8"
    )
    (source / "documents.json").write_text(
        json.dumps({"documents": []}), encoding="utf-8"
    )
    (source / "documents").mkdir()
    (source / "documents" / "a.md").write_text("hi", encoding="utf-8")
    make_db(source / "qa.db")
    make_db(source / "terms.db")
    make_db(source / "sessions.db")

    yield source, target

    qa.reset_cache()
    terms.reset_cache()
    sessions.reset_cache()
    qa_index.invalidate()


def saved_data_dir() -> str:
    return str((config.load_settings().get("storage") or {}).get("data_dir") or "")


def test_conflict_leaves_config_and_data_untouched(dirs):
    source, target = dirs
    make_db(target / "terms.db")  # 目标里预先放一个同名文件

    with pytest.raises(storage_migration.StorageConflict):
        storage_migration.migrate_data_dir(str(target))

    assert saved_data_dir() == ""
    assert (source / "sessions.db").is_file()
    assert not (target / "qa.db").exists()
    assert not (target / "profiles.json").exists()


def test_retry_after_removing_conflict_migrates_everything(dirs):
    source, target = dirs
    make_db(target / "terms.db")

    with pytest.raises(storage_migration.StorageConflict):
        storage_migration.migrate_data_dir(str(target))

    (target / "terms.db").unlink()
    storage_migration.migrate_data_dir(str(target))

    assert saved_data_dir() == str(target)
    for name in (
        "profiles.json",
        "documents.json",
        "qa.db",
        "terms.db",
        "sessions.db",
    ):
        assert (target / name).is_file(), name
    assert (target / "documents" / "a.md").is_file()
    # 旧目录保持完整，作为备份。
    assert (source / "sessions.db").is_file()


def test_staging_failure_keeps_old_configuration(dirs):
    source, target = dirs
    # 写一个损坏的数据库，让 VACUUM INTO 在复制阶段失败。
    (source / "qa.db").write_bytes(b"not a sqlite database")

    with pytest.raises(Exception):
        storage_migration.migrate_data_dir(str(target))

    assert saved_data_dir() == ""
    assert not (target / "terms.db").exists()
    assert not (target / "profiles.json").exists()


def test_resume_after_interrupted_move(dirs):
    source, target = dirs
    # 模拟进程在搬了一半时被杀掉：留一个已搬文件 + 迁移标记。
    shutil.copy2(source / "profiles.json", target / "profiles.json")
    (target / storage_migration.MARKER).write_text(
        json.dumps({"source": str(source)}), encoding="utf-8"
    )

    storage_migration.migrate_data_dir(str(target))

    assert saved_data_dir() == str(target)
    assert (target / "sessions.db").is_file()
    assert (target / "documents" / "a.md").is_file()
    assert not (target / storage_migration.MARKER).exists()


def test_migrate_without_copy_switches_empty_directory(dirs):
    _source, target = dirs
    storage_migration.migrate_data_dir(str(target), migrate=False)
    assert saved_data_dir() == str(target)
    assert not (target / "qa.db").exists()


def test_migrates_vector_model_cache_when_following_data(dirs):
    source, target = dirs
    model = source / "models" / "BAAI" / "bge-small-zh-v1.5"
    model.mkdir(parents=True)
    (model / "model.onnx").write_bytes(b"model-bytes")

    storage_migration.migrate_data_dir(str(target))

    migrated = target / "models" / "BAAI" / "bge-small-zh-v1.5" / "model.onnx"
    assert migrated.read_bytes() == b"model-bytes"
