"""MiniMax 语音识别服务（asr-1.0，SSE 流式返回）。

接口：POST {base_url}/speech_to_text
- multipart/form-data，字段 model=asr-1.0、stream=true、file=音频片段（WAV）
- 可选请求头 language（BCP-47，如 zh / en）
- 响应是 text/event-stream，逐行 ``data: {"index":0,"delta":"…","finish":false}``，
  最后一条带 ``"finish": true``；按 delta 累积成整句

文档：https://platform.minimax.cn/docs/guides/speech-to-text
注意：流式只支持默认的 response_format=json，且接口只收带容器的音频，
所谓流式是「结果边出边推」；音频侧仍由 VAD 切段后整段上传。
"""

import json
from collections.abc import AsyncGenerator

import aiohttp
from loguru import logger

from pipecat.frames.frames import (
    ErrorFrame,
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
)
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.utils.time import time_now_iso8601

DEFAULT_BASE_URL = "https://api.minimax.cn/v1"


def parse_sse_line(line: bytes | str) -> dict | None:
    """把一行 SSE 文本解析成事件对象；不是 data 行或解析失败时返回 None。"""
    if isinstance(line, bytes):
        line = line.decode("utf-8", "ignore")
    line = line.strip()
    if not line.startswith("data:"):
        return None
    payload = line[len("data:") :].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return event if isinstance(event, dict) else None


class MiniMaxSTTSettings(STTSettings):
    """MiniMax 语音识别设置（model / language）。"""

    pass


class MiniMaxSTTService(SegmentedSTTService):
    """基于 MiniMax asr-1.0 的语音识别，处理 VAD 分段后的 WAV 片段。

    默认走流式（``stream=true``）：一边收 SSE 一边把累积文本作为
    ``InterimTranscriptionFrame`` 推下去，``finish`` 到了再推最终转写。
    供应商不返回事件流时自动退回一次性 JSON 解析。
    """

    Settings = MiniMaxSTTSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = "asr-1.0",
        language: str | None = "zh",
        stream: bool = True,
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
        self._stream = stream
        self._session = aiohttp_session
        self._owns_session = aiohttp_session is None

    def can_generate_metrics(self) -> bool:
        return True

    async def cleanup(self):
        await super().cleanup()
        if self._owns_session and self._session:
            await self._session.close()
            self._session = None

    def _language(self) -> str | None:
        language = self._settings.language
        return str(language) if language else None

    async def _read_events(
        self, response: aiohttp.ClientResponse
    ) -> AsyncGenerator[dict, None]:
        while True:
            line = await response.content.readline()
            if not line:
                return
            event = parse_sse_line(line)
            if event is not None:
                yield event

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        try:
            await self.start_processing_metrics()

            if not self._session:
                self._session = aiohttp.ClientSession()

            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "text/event-stream, application/json",
            }
            language = self._language()
            if language:
                headers["language"] = language

            form = aiohttp.FormData()
            form.add_field("model", self._settings.model or "asr-1.0")
            if self._stream:
                form.add_field("stream", "true")
            form.add_field(
                "file", audio, filename="audio.wav", content_type="audio/wav"
            )

            text = ""
            async with self._session.post(
                f"{self._base_url}/speech_to_text", data=form, headers=headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    await self.stop_processing_metrics()
                    yield ErrorFrame(
                        error=f"MiniMax ASR error ({response.status}): {error_text}"
                    )
                    return

                is_event_stream = "text/event-stream" in response.headers.get(
                    "Content-Type", ""
                )
                if is_event_stream:
                    async for event in self._read_events(response):
                        delta = str(event.get("delta") or "")
                        if delta:
                            text += delta
                            yield InterimTranscriptionFrame(
                                text,
                                self._user_id,
                                time_now_iso8601(),
                                language,
                            )
                        if event.get("finish"):
                            break
                else:
                    result = await response.json()
                    text = str(result.get("text") or "")

            # 空片段也要收掉计时，否则这条 processing 指标会一直挂着。
            await self.stop_processing_metrics()

            text = text.strip()
            if text:
                logger.debug(f"MiniMax transcription: [{text}]")
                yield TranscriptionFrame(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    language,
                )
        except Exception as e:
            yield ErrorFrame(error=f"MiniMax ASR error: {e}")
