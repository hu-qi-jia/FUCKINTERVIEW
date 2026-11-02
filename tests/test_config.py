"""数据根目录：开发版 config/ 与安装版 userData 隔离，旧数据可迁移。"""

from __future__ import annotations

import json

import app.config as config
import app.materials as materials
import app.qa_index as qa_index


def test_env_data_dir_drives_config_and_models(tmp_path, monkeypatch):
    home = tmp_path / "userdata"
    monkeypatch.setenv(config.ENV_DATA_DIR, str(home))

    assert config.data_root() == home
    assert config.config_path() == home / "settings.json"
    assert materials.data_dir() == home
    assert qa_index.model_dir() == home / "models"


def test_legacy_relative_paths_are_normalized(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    legacy = repo / "config"
    legacy.mkdir(parents=True)
    home = tmp_path / "userdata"
    monkeypatch.setenv(config.ENV_DATA_DIR, str(home))
    monkeypatch.setattr(config, "ROOT", repo)

    (legacy / "settings.json").write_text(
        json.dumps(
            {
                "storage": {"data_dir": "config", "model_dir": "config/models"},
                "llm": {"api_key": "sk-test"},
            }
        ),
        encoding="utf-8",
    )
    (legacy / "profiles.json").write_text(
        json.dumps({"schemaVersion": 1, "profiles": []}), encoding="utf-8"
    )
    (legacy / "qa.db").write_bytes(b"db")
    (legacy / "models").mkdir()
    (legacy / "models" / "model.onnx").write_bytes(b"onnx")

    copied = config.migrate_legacy_data()

    assert "settings.json" in copied
    assert (home / "profiles.json").is_file()
    assert (home / "qa.db").is_file()
    assert (home / "models" / "model.onnx").is_file()

    saved = config.load_settings()
    assert saved["storage"]["data_dir"] == ""
    assert saved["storage"]["model_dir"] == ""
    # 密钥跟着 settings.json 一起搬过来。
    assert saved["llm"]["api_key"] == "sk-test"


def test_dev_environment_does_not_migrate(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    (repo / "config").mkdir(parents=True)
    monkeypatch.delenv(config.ENV_DATA_DIR, raising=False)
    monkeypatch.setattr(config, "ROOT", repo)

    assert config.migrate_legacy_data() == []
