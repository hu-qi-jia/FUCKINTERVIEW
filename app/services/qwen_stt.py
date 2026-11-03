"""Qwen (DashScope) 语音识别服务。

DashScope 的 qwen3-asr-flash 通过 OpenAI 兼容的 /chat/completions 接口调用，
音频可以以 base64 Data URL 传入，因此适合做 VAD 分段后的整段识别。
"""

import base64
from collections.abc import AsyncGenerator

import aiohttp
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame, TranscriptionFrame
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.utils.time import time_now_iso8601

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class QwenSTTSettings(STTSettings):
    """Qwen 语音识别设置（model / language）。"""

    pass


class QwenSTTService(SegmentedSTTService):
    """基于 DashScope OpenAI 兼容接口的 Qwen 语音识别。"""

    Settings = QwenSTTSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = "qwen3-asr-flash",
        language: str | None = "zh",
        sample_rate: int | None = None,
        aiohttp_session: aiohttp.ClientSession | None = None,
        **kwargs,
    ):
        super().__init__(
            sample_rate=sample_rate,
            settings=self.Settings(model=model, language=language),
            **kwargs,
        )
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._session = aiohttp_session
        self._owns_session = aiohttp_session is None

    def can_generate_metrics(self) -> bool:
        return True

    async def cleanup(self):
        await super().cleanup()
        if self._owns_session and self._session:
            await self._session.close()
            self._session = None

    async def warm_up(self) -> None:
        """提前建立到 DashScope 的连接，别让第一段语音等 DNS/TLS。"""
        try:
            if not self._session:
                self._session = aiohttp.ClientSession()
            async with self._session.get(
                self._base_url, timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                await response.read()
        except Exception as error:
            logger.debug(f"Qwen ASR warm-up skipped: {error}")

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        """audio 是 SegmentedSTTService 生成的 WAV 片段。"""
        try:
            await self.start_processing_metrics()

            if not self._session:
                self._session = aiohttp.ClientSession()

            data_uri = f"data:audio/wav;base64,{base64.b64encode(audio).decode()}"
            asr_options: dict = {"enable_itn": True}
            if self._settings.language:
                asr_options["language"] = str(self._settings.language)

            payload = {
                "model": self._settings.model or "qwen3-asr-flash",
                "messages": [
                    {
                        "role": "user",
                        "content": [{"type": "input_audio", "input_audio": {"data": data_uri}}],
                    }
                ],
                "stream": False,
                "asr_options": asr_options,
            }
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            }

            async with self._session.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    yield ErrorFrame(error=f"Qwen ASR error ({response.status}): {error_text}")
                    return
                result = await response.json()

            message = result["choices"][0]["message"]
            content = message.get("content", "")
            if isinstance(content, list):
                text = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            else:
                text = str(content)
            text = text.strip()

            if text:
                await self.stop_processing_metrics()
                logger.debug(f"Qwen transcription: [{text}]")
                yield TranscriptionFrame(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    str(self._settings.language) if self._settings.language else None,
                    result=result,
                )
        except Exception as e:
            yield ErrorFrame(error=f"Qwen ASR error: {e}")
