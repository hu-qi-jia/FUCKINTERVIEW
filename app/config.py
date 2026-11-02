"""本地配置读写：ASR / LLM / TTS 的供应商、模型与密钥。"""

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from loguru import logger

ROOT = Path(__file__).resolve().parent.parent

# 数据根目录（settings.json、档案、问答库、术语库、历史、资料与模型缓存）。
#
# 开发环境：默认仓库里的 config/，和安装版完全分开。
# 安装版：Electron 通过 INTERVIEW_DATA_DIR 指到 %APPDATA%/面试语音助手/data，
# 安装目录只读、升级会被覆盖，不能往里写用户数据。
ENV_DATA_DIR = "INTERVIEW_DATA_DIR"
DEFAULT_DATA_DIRNAME = "config"


def data_root() -> Path:
    """数据根目录：环境变量优先，否则回落到仓库里的 config/。"""
    raw = os.environ.get(ENV_DATA_DIR, "").strip()
    if raw:
        return Path(raw).expanduser()
    return ROOT / DEFAULT_DATA_DIRNAME


def config_dir() -> Path:
    """settings.json 所在目录，和档案 / 数据库同一个根。"""
    return data_root()


def config_path() -> Path:
    return config_dir() / "settings.json"

DEFAULT_SYSTEM_PROMPT = (
    "你是一名资深的中文技术面试官，正在进行一场模拟面试。"
    "根据候选人的简历和岗位要求提问，语气自然、简洁，每次只问一个问题。"
    "候选人的回答来自语音转写，可能有错别字或标点缺失，请合理理解。"
    "你的回答会被朗读出来，请使用口语化表达，不要使用 Markdown、列表、代码块或表情符号。"
)
# 提示词按场景内置（模拟面试 / 实时面试 / 面试材料各用各的），不再写进配置文件，
# 设置页也就不再暴露 system_prompt 这一项。

DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    # 模型相关的输入框一律不预填：base_url / model / voice 默认留空，
    # 由用户在设置页自己填。真正构建服务时，providers.py 里还有一层兜底默认值，
    # 所以留空也能跑，只是界面上不再替用户做主。
    "asr": {
        "provider": "qwen",
        "api_key": "",
        "base_url": "",
        "model": "",
        "language": "zh",
    },
    "llm": {
        "provider": "openai_compatible",
        "api_key": "",
        "base_url": "",
        "model": "",
        # 关掉推理模型的思考：面试回答不需要链式推理。DeepSeek 实测能削掉
        # 0.7s 以上的首字延迟。换到不认这个参数的供应商时，这里改成 false。
        "disable_thinking": True,
    },
    "tts": {
        "provider": "minimax",
        "api_key": "",
        "base_url": "",
        "model": "",
        "voice": "",
        "group_id": "",
        "language": "zh",
    },
    # 问答库的向量化配置。模型在本地跑，不依赖任何 API。
    "embedding": {
        "model": "BAAI/bge-small-zh-v1.5",
        "relevance_threshold": 0.75,
    },
    # 面试档案（以及以后的问答库、热词库）存放的目录。
    # 空串 = 使用数据根目录（开发版是 config/，安装版是 userData/data）；
    # 相对路径按项目根目录解析，兼容旧版配置里的 "config"。
    # model_dir 单独放：模型是二进制资产，默认落在数据根目录下的 models/，
    # 不跟着用户选择的档案目录迁移。
    "storage": {
        "data_dir": "",
        "model_dir": "",
    },
}

SECTIONS = ("asr", "llm", "tts", "embedding")


def _merge(defaults: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(defaults)
    for key, value in incoming.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_settings() -> dict[str, Any]:
    """读取配置；文件不存在时返回默认值。"""
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    path = config_path()
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                stored = json.load(f)
            settings = _merge(settings, stored)
        except (OSError, json.JSONDecodeError):
            pass

    # 老配置文件里可能还留着 system_prompt；提示词改成内置后一律忽略。
    llm = settings.get("llm")
    if isinstance(llm, dict):
        llm.pop("system_prompt", None)
    return settings


def _write_settings(settings: dict[str, Any]) -> None:
    target = config_dir()
    target.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=target, suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, config_path())
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def save_settings(incoming: dict[str, Any]) -> dict[str, Any]:
    """校验后原子写入配置文件，返回合并后的完整配置。"""
    if not isinstance(incoming, dict):
        raise ValueError("配置必须是 JSON 对象")

    clean: dict[str, Any] = {}
    for section in SECTIONS:
        value = incoming.get(section, {})
        if not isinstance(value, dict):
            raise ValueError(f"{section} 必须是对象")
        clean[section] = {str(k): v for k, v in value.items() if isinstance(k, str)}

    # 提示词由各场景内置，前端即使还带着这个键也不落盘。
    clean.get("llm", {}).pop("system_prompt", None)

    merged = _merge(load_settings(), clean)
    _write_settings(merged)
    return merged


def save_storage(data_dir: str) -> dict[str, Any]:
    """只更新数据目录，其余配置保持不动。"""
    settings = load_settings()
    settings["storage"] = {**settings.get("storage", {}), "data_dir": data_dir}
    _write_settings(settings)
    return settings


def save_model_dir(model_dir: str) -> dict[str, Any]:
    """只更新模型缓存目录，数据目录不动。"""
    settings = load_settings()
    settings["storage"] = {**settings.get("storage", {}), "model_dir": model_dir}
    _write_settings(settings)
    return settings


def save_storage_paths(data_dir: str | None = None, model_dir: str | None = None) -> dict[str, Any]:
    """一次写盘更新数据目录和 / 或模型目录，避免两次写盘留下半套配置。"""
    settings = load_settings()
    storage = dict(settings.get("storage") or {})
    if data_dir is not None:
        storage["data_dir"] = data_dir
    if model_dir is not None:
        storage["model_dir"] = model_dir
    settings["storage"] = storage
    _write_settings(settings)
    return settings


# --------------------------------------------------------------------------
# 旧版安装目录数据迁移
#
# 安装版早期版本把配置和数据写进了 <安装目录>/resources/backend/config。
# 安装目录只读、升级会被覆盖，现在统一放 INTERVIEW_DATA_DIR。这里在启动时
# 把旧目录里的文件补到新目录，并把配置里的相对路径归一化；开发环境
# （没有设置 INTERVIEW_DATA_DIR）新旧目录相同，直接跳过。
# --------------------------------------------------------------------------
_LEGACY_FILES = ("profiles.json", "documents.json")
_LEGACY_DBS = ("qa.db", "terms.db", "sessions.db")
_LEGACY_DB_SIDECARS = ("-wal", "-shm")


def _resolve_legacy_path(raw: str, default_name: str) -> Path:
    value = str(raw or "").strip() or default_name
    path = Path(value).expanduser()
    return path if path.is_absolute() else (ROOT / path)


def migrate_legacy_data() -> list[str]:
    """把安装目录里的旧数据搬到当前数据根目录；返回搬过来的文件名。

    只在当前根目录还没有同名文件时复制。settings.json 也只在目标不存在时
    写入一份归一化后的副本，避免覆盖用户已经在新目录里改过的配置。
    """
    target = data_root()
    legacy = ROOT / DEFAULT_DATA_DIRNAME
    if target.resolve() == legacy.resolve() or not legacy.is_dir():
        return []

    target.mkdir(parents=True, exist_ok=True)
    legacy_settings: dict[str, Any] = {}
    settings_file = legacy / "settings.json"
    if settings_file.is_file():
        try:
            raw = json.loads(settings_file.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                legacy_settings = raw
        except (OSError, json.JSONDecodeError):
            legacy_settings = {}

    storage = legacy_settings.get("storage")
    storage = storage if isinstance(storage, dict) else {}
    old_data = _resolve_legacy_path(str(storage.get("data_dir") or ""), DEFAULT_DATA_DIRNAME)
    old_model = _resolve_legacy_path(
        str(storage.get("model_dir") or ""), f"{DEFAULT_DATA_DIRNAME}/models"
    )

    copied: list[str] = []

    def copy_file(source: Path, dest: Path) -> None:
        if not source.is_file() or dest.exists():
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
        copied.append(dest.name)

    # 数据仍然在安装目录里：档案 / 资料 / 三个数据库整体搬过来。
    # 如果用户以前就把数据目录指到了别处，那些文件已经在别处，不用重复复制。
    if old_data.resolve() == legacy.resolve():
        for name in _LEGACY_FILES:
            copy_file(old_data / name, target / name)
        for name in _LEGACY_DBS:
            copy_file(old_data / name, target / name)
            for suffix in _LEGACY_DB_SIDECARS:
                copy_file(old_data / f"{name}{suffix}", target / f"{name}{suffix}")
        source_docs = old_data / "documents"
        dest_docs = target / "documents"
        if source_docs.is_dir() and not dest_docs.exists():
            shutil.copytree(source_docs, dest_docs)
            copied.append("documents/")

    # 模型缓存是二进制资产，跟着旧的默认位置搬，不跟着用户数据目录迁移。
    default_model = legacy / "models"
    if old_model.resolve() == default_model.resolve() and old_model.is_dir():
        dest_model = target / "models"
        if not dest_model.exists():
            shutil.copytree(old_model, dest_model)
            copied.append("models/")

    # 配置里的相对路径按安装目录解析，搬到新根目录后会指错，统一改成
    # 「空串 = 新根目录默认值」；用户自己设的绝对路径原样保留。
    normalized = dict(legacy_settings)
    if storage:
        new_storage = dict(storage)
        if old_data.resolve() == legacy.resolve():
            new_storage["data_dir"] = ""
        elif not Path(str(storage.get("data_dir") or "")).expanduser().is_absolute():
            new_storage["data_dir"] = str(old_data)
        if old_model.resolve() == default_model.resolve():
            new_storage["model_dir"] = ""
        elif not Path(str(storage.get("model_dir") or "")).expanduser().is_absolute():
            new_storage["model_dir"] = str(old_model)
        normalized["storage"] = new_storage

    target_settings = target / "settings.json"
    if legacy_settings and not target_settings.exists():
        _write_settings_at(target, normalized)
        copied.append("settings.json")

    if copied:
        logger.info(f"已把安装目录里的旧数据迁移到 {target}：{', '.join(copied)}")
    return copied


def _write_settings_at(directory: Path, settings: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, directory / "settings.json")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
