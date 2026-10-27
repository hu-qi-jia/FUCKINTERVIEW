"""本地配置读写：ASR / LLM / TTS 的供应商、模型与密钥。"""

import json
import os
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
CONFIG_PATH = CONFIG_DIR / "settings.json"

DEFAULT_SYSTEM_PROMPT = (
    "你是一名资深的中文技术面试官，正在进行一场模拟面试。"
    "根据候选人的简历和岗位要求提问，语气自然、简洁，每次只问一个问题。"
    "候选人的回答来自语音转写，可能有错别字或标点缺失，请合理理解。"
    "你的回答会被朗读出来，请使用口语化表达，不要使用 Markdown、列表、代码块或表情符号。"
)

DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    "asr": {
        "provider": "qwen",
        "api_key": "",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3-asr-flash",
        "language": "zh",
    },
    "llm": {
        "provider": "openai_compatible",
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
    },
    "tts": {
        "provider": "minimax",
        "api_key": "",
        "base_url": "",
        "model": "speech-2.8-turbo",
        "voice": "Calm_Woman",
        "group_id": "",
        "language": "zh",
    },
}

SECTIONS = ("asr", "llm", "tts")


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
    if not CONFIG_PATH.exists():
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            stored = json.load(f)
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    return _merge(json.loads(json.dumps(DEFAULT_SETTINGS)), stored)


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

    merged = _merge(load_settings(), clean)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=CONFIG_DIR, suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, CONFIG_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    return merged
