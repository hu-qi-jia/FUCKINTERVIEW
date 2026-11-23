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


def test_legacy_flat_asr_fields_migrate_into_provider_configs(tmp_path, monkeypatch):
    """旧版把 ASR 五个字段平铺；升级后要搬进当前供应商那一份，Key 不能丢。"""
    monkeypatch.setenv(config.ENV_DATA_DIR, str(tmp_path))
    (tmp_path / "settings.json").write_text(
        json.dumps(
            {
                "asr": {
                    "provider": "minimax",
                    "api_key": "mm-test-key",
                    "base_url": "https://api.minimax.cn/v1",
                    "model": "asr-1.0",
                    "language": "zh",
                }
            }
        ),
        encoding="utf-8",
    )

    saved = config.load_settings()

    assert saved["asr"]["provider"] == "minimax"
    assert saved["asr"]["configs"]["minimax"]["api_key"] == "mm-test-key"
    assert saved["asr"]["configs"]["minimax"]["model"] == "asr-1.0"
    # 其他供应商补内置地址，设置页切过去就有值可显示。
    assert saved["asr"]["configs"]["qwen"]["base_url"].startswith("https://dashscope")


def test_save_asr_keeps_each_provider_config(tmp_path, monkeypatch):
    """切供应商只改 provider，不能把另一家的 Key / 地址冲掉。"""
    monkeypatch.setenv(config.ENV_DATA_DIR, str(tmp_path))

    config.save_settings(
        {
            "asr": {
                "provider": "qwen",
                "configs": {
                    "qwen": {
                        "api_key": "qwen-key",
                        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "model": "qwen3-asr-flash",
                        "language": "zh",
                    },
                    "minimax": {
                        "api_key": "mm-key",
                        "base_url": "https://api.minimax.cn/v1",
                        "model": "asr-1.0",
                        "language": "zh",
                    },
                },
            }
        }
    )

    saved = config.save_settings(
        {
            "asr": {
                "provider": "minimax",
                "configs": {"minimax": {"model": "asr-1.0"}},
            }
        }
    )

    assert saved["asr"]["provider"] == "minimax"
    assert saved["asr"]["configs"]["qwen"]["api_key"] == "qwen-key"
    assert saved["asr"]["configs"]["minimax"]["api_key"] == "mm-key"
    assert saved["asr"]["configs"]["minimax"]["base_url"] == "https://api.minimax.cn/v1"


def test_active_asr_config_resolves_current_provider(tmp_path, monkeypatch):
    monkeypatch.setenv(config.ENV_DATA_DIR, str(tmp_path))
    provider, values = config.active_asr_config(
        {
            "provider": "minimax",
            "configs": {"minimax": {"api_key": "k", "base_url": "u", "model": "m", "language": "zh"}},
        }
    )
    assert provider == "minimax"
    assert values["api_key"] == "k"
    assert values["model"] == "m"


def test_userdata_config_is_copied_and_detached_from_dev(tmp_path, monkeypatch):
    """旧版把配置写在 userData/data/config，还把数据目录指到开发仓库。"""
    repo = tmp_path / "repo"
    dev_data = repo / "config"
    dev_data.mkdir(parents=True)
    (dev_data / "profiles.json").write_text(
        json.dumps({"schemaVersion": 1, "profiles": []}), encoding="utf-8"
    )
    (dev_data / "qa.db").write_bytes(b"db")
    (dev_data / "models").mkdir()
    (dev_data / "models" / "model.onnx").write_bytes(b"onnx")

    home = tmp_path / "userdata"
    old_config = home / "config"
    old_config.mkdir(parents=True)
    (old_config / "settings.json").write_text(
        json.dumps(
            {
                "storage": {
                    "data_dir": str(dev_data),
                    "model_dir": "config/models",
                },
                "llm": {"api_key": "sk-test"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv(config.ENV_DATA_DIR, str(home))
    monkeypatch.setattr(config, "ROOT", repo)

    copied = config.migrate_legacy_data()

    assert "settings.json" in copied
    assert (home / "profiles.json").is_file()
    assert (home / "qa.db").is_file()
    assert (home / "models" / "model.onnx").is_file()
    saved = json.loads((home / "settings.json").read_text(encoding="utf-8"))
    assert saved["storage"]["data_dir"] == ""
    assert saved["storage"]["model_dir"] == ""
    assert saved["llm"]["api_key"] == "sk-test"
    # 开发数据原样保留，安装版从此读写自己的副本。
    assert (dev_data / "profiles.json").is_file()
