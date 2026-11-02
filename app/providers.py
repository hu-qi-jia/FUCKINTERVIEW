"""根据配置构建 STT / LLM / TTS 服务实例。

供应商 SDK 只在真正用到时才导入：Anthropic SDK 单独就要 7 秒多（2395 个
.py），而默认链路用的是 OpenAI 兼容接口。把 import 放进各分支后，
``import server`` 不再顺带加载七家供应商的包，启动快很多。
"""

import os
from typing import Any

from pipecat.transcriptions.language import Language

from app.config import DEFAULT_SYSTEM_PROMPT

QWEN_LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MINIMAX_ASR_BASE_URL = "https://api.minimax.cn/v1"

_compatible_openai_class: type | None = None


def _compatible_openai_llm_service() -> type:
    """OpenAI 兼容服务：不使用 developer 角色。

    DeepSeek 等兼容服务只接受 system/user/assistant/tool，发送 developer
    会直接 422。设为 False 后由适配层把 developer 消息转成 user。
    """
    global _compatible_openai_class
    if _compatible_openai_class is None:
        from pipecat.services.openai.llm import OpenAILLMService

        class CompatibleOpenAILLMService(OpenAILLMService):
            supports_developer_role = False

        _compatible_openai_class = CompatibleOpenAILLMService
    return _compatible_openai_class


def _language(value: str | None) -> Language | None:
    if not value:
        return None
    try:
        return Language(value)
    except ValueError:
        return None


def _require_key(section: dict[str, Any], label: str, env: str = "") -> str:
    api_key = str(section.get("api_key") or "").strip()
    if not api_key and env:
        api_key = os.getenv(env, "").strip()
    if not api_key:
        raise ValueError(f"{label} 的 API Key 未配置，请先在设置页填写")
    return api_key


def build_stt(section: dict[str, Any]):
    provider = section.get("provider", "qwen")
    language = section.get("language") or None
    model = (section.get("model") or "").strip()
    base_url = (section.get("base_url") or "").strip()

    if provider == "qwen":
        from app.services.qwen_stt import QwenSTTService

        return QwenSTTService(
            api_key=_require_key(section, "ASR (Qwen)", "DASHSCOPE_API_KEY"),
            base_url=base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model=model or "qwen3-asr-flash",
            language=language,
        )

    if provider == "minimax":
        from app.services.minimax_stt import MiniMaxSTTService

        return MiniMaxSTTService(
            api_key=_require_key(section, "ASR (MiniMax)", "MINIMAX_API_KEY"),
            # 国内平台是 api.minimax.cn；api.minimax.io 是国际站，国内 Key 在那边会 401。
            base_url=base_url or MINIMAX_ASR_BASE_URL,
            model=model or "asr-1.0",
            language=language,
        )

    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(
            api_key=_require_key(section, "ASR (Deepgram)", "DEEPGRAM_API_KEY"),
            settings=DeepgramSTTService.Settings(
                model=model or "nova-3",
                language=_language(language),
            ),
        )

    if provider == "openai":
        from pipecat.services.openai.stt import OpenAISTTService

        return OpenAISTTService(
            api_key=_require_key(section, "ASR (OpenAI)", "OPENAI_API_KEY"),
            base_url=base_url or None,
            settings=OpenAISTTService.Settings(
                model=model or "whisper-1",
                language=_language(language),
            ),
        )

    raise ValueError(f"不支持的 ASR 供应商: {provider}")


def build_llm(section: dict[str, Any]):
    provider = section.get("provider", "openai_compatible")
    model = (section.get("model") or "").strip()
    base_url = (section.get("base_url") or "").strip()
    system_prompt = (section.get("system_prompt") or "").strip() or DEFAULT_SYSTEM_PROMPT

    if provider == "anthropic":
        from pipecat.services.anthropic.llm import AnthropicLLMService

        return AnthropicLLMService(
            api_key=_require_key(section, "LLM (Anthropic)", "ANTHROPIC_API_KEY"),
            settings=AnthropicLLMService.Settings(
                model=model or "claude-sonnet-5-5",
                system_instruction=system_prompt,
            ),
        )

    if provider == "qwen":
        from pipecat.services.qwen.llm import QwenLLMService

        return QwenLLMService(
            api_key=_require_key(section, "LLM (Qwen)", "DASHSCOPE_API_KEY"),
            base_url=base_url or QWEN_LLM_BASE_URL,
            settings=QwenLLMService.Settings(
                model=model or "qwen-plus",
                system_instruction=system_prompt,
            ),
        )

    # 关掉推理模型的思考（Reasoning / Thinking）。面试回答是「把确认过的事实
    # 说出来」，不需要链式推理；实测 DeepSeek 上思考占了首字延迟的 84%。
    # 走 OpenAI 兼容的 reasoning_effort=none，DeepSeek / Qwen / OpenAI 的新模型
    # 都认；换到不认这个字段的供应商时，在设置里关掉这一项即可。
    extra = (
        {"reasoning_effort": "none"} if section.get("disable_thinking", True) else {}
    )

    from pipecat.services.openai.llm import OpenAILLMService

    # 任意 OpenAI 兼容服务：OpenAI、DeepSeek、SiliconFlow、Ollama、vLLM 等
    return _compatible_openai_llm_service()(
        api_key=_require_key(section, "LLM (OpenAI 兼容)", "OPENAI_API_KEY"),
        base_url=base_url or None,
        settings=OpenAILLMService.Settings(
            model=model or "gpt-4o-mini",
            system_instruction=system_prompt,
            extra=extra,
        ),
    )


def _minimax_tts_url(base_url: str) -> str | None:
    """把 API 根地址统一成 T2A 端点（兼容 .../v1、完整端点或裸域名）。"""
    if not base_url:
        return None
    url = base_url.rstrip("/")
    if url.endswith("/t2a_v2"):
        return url
    if url.endswith("/v1"):
        return f"{url}/t2a_v2"
    return f"{url}/v1/t2a_v2"


def build_tts(section: dict[str, Any], session):
    provider = section.get("provider", "minimax")
    model = (section.get("model") or "").strip()
    voice = (section.get("voice") or "").strip()
    base_url = (section.get("base_url") or "").strip()
    language = section.get("language") or None

    if provider == "minimax":
        from pipecat.services.minimax.tts import MiniMaxHttpTTSService

        kwargs: dict[str, Any] = {}
        tts_url = _minimax_tts_url(base_url)
        if tts_url:
            kwargs["base_url"] = tts_url
        return MiniMaxHttpTTSService(
            api_key=_require_key(section, "TTS (MiniMax)", "MINIMAX_API_KEY"),
            group_id=str(section.get("group_id") or os.getenv("MINIMAX_GROUP_ID", "")).strip(),
            aiohttp_session=session,
            settings=MiniMaxHttpTTSService.Settings(
                model=model or "speech-2.8-turbo",
                voice=voice or "Calm_Woman",
                language=_language(language),
            ),
            **kwargs,
        )

    if provider == "qwen":
        from app.services.qwen_tts import QwenTTSService

        return QwenTTSService(
            api_key=_require_key(section, "TTS (Qwen)", "DASHSCOPE_API_KEY"),
            base_url=base_url or "https://dashscope.aliyuncs.com/api/v1",
            model=model or "qwen3-tts-flash",
            voice=voice or "Cherry",
            language="Chinese" if (language or "zh").startswith("zh") else "English",
        )

    if provider == "openai":
        from pipecat.services.openai.tts import OpenAITTSService

        return OpenAITTSService(
            api_key=_require_key(section, "TTS (OpenAI)", "OPENAI_API_KEY"),
            base_url=base_url or None,
            settings=OpenAITTSService.Settings(
                model=model or "gpt-4o-mini-tts",
                voice=voice or "alloy",
            ),
        )

    if provider == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        return ElevenLabsTTSService(
            api_key=_require_key(section, "TTS (ElevenLabs)", "ELEVENLABS_API_KEY"),
            settings=ElevenLabsTTSService.Settings(
                model=model or "eleven_flash_v2_5",
                voice=voice or "21m00Tcm4TlvDq8ikWAM",
            ),
        )

    if provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        return CartesiaTTSService(
            api_key=_require_key(section, "TTS (Cartesia)", "CARTESIA_API_KEY"),
            settings=CartesiaTTSService.Settings(
                model=model or "sonic-2",
                voice=voice or "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
            ),
        )

    raise ValueError(f"不支持的 TTS 供应商: {provider}")
