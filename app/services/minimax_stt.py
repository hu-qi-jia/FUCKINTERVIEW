"""MiniMax 语音识别服务（asr-1.0）。

接口：POST {base_url}/speech_to_text
- multipart/form-data，字段 model=asr-1.0，file=音频文件
- 可选请求头 language（BCP-47，如 zh / en）
- 一次性返回 {"text": ..., "duration": ..., "trace_id": ...}
"""

from collections.abc import AsyncGenerator

import aiohttp
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame, TranscriptionFrame
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.utils.time import time_now_iso8601

DEFAULT_BASE_URL = "https://api.minimax.io/v1"


class MiniMaxSTTSettings(STTSettings):
    """MiniMax 语音识别设置（model / language）。"""

    pass


class MiniMaxSTTService(SegmentedSTTService):
    """基于 MiniMax asr-1.0 的语音识别，处理 VAD 分段后的 WAV 片段。"""

    Settings = MiniMaxSTTSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = "asr-1.0",
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

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        try:
            await self.start_processing_metrics()

            if not self._session:
                self._session = aiohttp.ClientSession()

            headers = {"Authorization": f"Bearer {self._api_key}"}
            if self._settings.language:
                headers["language"] = str(self._settings.language)

            form = aiohttp.FormData()
            form.add_field("model", self._settings.model or "asr-1.0")
            form.add_field("file", audio, filename="audio.wav", content_type="audio/wav")

            async with self._session.post(
                f"{self._base_url}/speech_to_text", data=form, headers=headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    yield ErrorFrame(error=f"MiniMax ASR error ({response.status}): {error_text}")
                    return
                result = await response.json()

            text = str(result.get("text", "")).strip()
            if text:
                await self.stop_processing_metrics()
                logger.debug(f"MiniMax transcription: [{text}]")
                yield TranscriptionFrame(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    str(self._settings.language) if self._settings.language else None,
                    result=result,
                )
        except Exception as e:
            yield ErrorFrame(error=f"MiniMax ASR error: {e}")
