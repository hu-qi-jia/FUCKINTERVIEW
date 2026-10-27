"""Qwen (DashScope) 语音合成服务。

调用 DashScope 多模态生成接口（qwen3-tts-flash），拿回整段 WAV 音频后
解码为 16-bit PCM，再按帧推入 pipeline。
"""

import base64
import io
from collections.abc import AsyncGenerator

import aiohttp
import numpy as np
import soxr
import soundfile as sf
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
ENDPOINT = "/services/aigc/multimodal-generation/generation"


class QwenTTSSettings(TTSSettings):
    """Qwen 语音合成设置（model / voice / language）。"""

    pass


class QwenTTSService(TTSService):
    """基于 DashScope 的 Qwen 语音合成。"""

    Settings = QwenTTSSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = "qwen3-tts-flash",
        voice: str = "Cherry",
        language: str = "Chinese",
        sample_rate: int = 24000,
        aiohttp_session: aiohttp.ClientSession | None = None,
        **kwargs,
    ):
        super().__init__(
            sample_rate=sample_rate,
            settings=self.Settings(model=model, voice=voice, language=language),
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

    def _decode_pcm(self, raw: bytes) -> bytes:
        data, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
        if sample_rate != self.sample_rate:
            mono = soxr.resample(mono, sample_rate, self.sample_rate)
        return (np.clip(mono, -1.0, 1.0) * 32767).astype(np.int16).tobytes()

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        try:
            if not self._session:
                self._session = aiohttp.ClientSession()

            await self.start_tts_usage_metrics(text)

            payload = {
                "model": self._settings.model or "qwen3-tts-flash",
                "input": {
                    "text": text,
                    "voice": self._settings.voice or "Cherry",
                    "language_type": self._settings.language or "Chinese",
                },
            }
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            }

            async with self._session.post(
                f"{self._base_url}{ENDPOINT}", json=payload, headers=headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    yield ErrorFrame(error=f"Qwen TTS error ({response.status}): {error_text}")
                    return
                result = await response.json()

            audio_block = (result.get("output") or {}).get("audio") or {}
            raw: bytes | None = None
            if audio_block.get("data"):
                raw = base64.b64decode(audio_block["data"])
            elif audio_block.get("url"):
                async with self._session.get(audio_block["url"]) as audio_response:
                    if audio_response.status != 200:
                        yield ErrorFrame(
                            error=f"Qwen TTS audio download failed ({audio_response.status})"
                        )
                        return
                    raw = await audio_response.read()

            if not raw:
                yield ErrorFrame(error=f"Qwen TTS returned no audio: {result}")
                return

            pcm = self._decode_pcm(raw)
            frame_bytes = max(2, int(self.sample_rate * 0.02) * 2)  # 20ms of s16le mono
            for offset in range(0, len(pcm), frame_bytes):
                yield TTSAudioRawFrame(
                    audio=pcm[offset : offset + frame_bytes],
                    sample_rate=self.sample_rate,
                    num_channels=1,
                    context_id=context_id,
                )
        except Exception as e:
            logger.error(f"Qwen TTS error: {e}")
            yield ErrorFrame(error=f"Qwen TTS error: {e}", exception=e)
