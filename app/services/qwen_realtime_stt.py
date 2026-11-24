"""Qwen 实时语音识别（qwen3-asr-flash-realtime，WebSocket）。

和文件识别不同，这里音频是**边说边发**的：每 100ms 一包 PCM16 塞进
WebSocket，服务端用 VAD 断句，partial 和 final 都从同一条连接回来。
所以前端在候选人还没说完时就能看到文字。

协议（阿里云百炼）：
- 连接：wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<model>
- 客户端事件：session.update / input_audio_buffer.append / session.finish
- 服务端事件：
  - conversation.item.input_audio_transcription.text（partial，text + stash）
  - conversation.item.input_audio_transcription.completed（final，transcript）
  - session.finished
- 音频：PCM16 little-endian、单声道、16kHz

Pipecat 这边只负责把音频帧转发进连接、把事件翻译成
InterimTranscriptionFrame / TranscriptionFrame；轮次判定仍由本地
VAD + SmartTurn 做，服务端的 VAD 只用来断句。
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import AsyncGenerator
from urllib.parse import quote, urlsplit, urlunsplit

import aiohttp
from loguru import logger

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    StartFrame,
    TranscriptionFrame,
)
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import STTService
from pipecat.utils.time import time_now_iso8601

DEFAULT_BASE_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"


class QwenRealtimeSTTSettings(STTSettings):
    """Qwen 实时识别设置（model / language）。"""

    pass


class QwenRealtimeSTTService(STTService):
    """WebSocket 流式识别：音频边发，文字边回。"""

    Settings = QwenRealtimeSTTSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = "qwen3-asr-flash-realtime",
        language: str | None = "zh",
        sample_rate: int = 16000,
        silence_ms: int = 400,
        aiohttp_session: aiohttp.ClientSession | None = None,
        **kwargs,
    ):
        super().__init__(
            sample_rate=sample_rate,
            settings=self.Settings(model=model, language=language),
            **kwargs,
        )
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).strip()
        self._silence_ms = max(100, int(silence_ms or 400))
        self._session = aiohttp_session
        self._owns_session = aiohttp_session is None

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._receiver_task: asyncio.Task | None = None
        self._connect_task: asyncio.Task | None = None
        self._connect_lock = asyncio.Lock()
        self._flush_lock = asyncio.Lock()
        self._buffer = bytearray()
        self._sample_rate = int(sample_rate or 16000)
        self._finished = asyncio.Event()
        self._last_partial = ""
        self._last_connect_attempt = 0.0

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    async def start(self, frame: StartFrame):
        await super().start(frame)
        # 传输层可能是 16k，也可能按设置换过；以 StartFrame 为准。
        self._sample_rate = int(getattr(frame, "audio_in_sample_rate", 0) or self._sample_rate)
        # 不 await：DashScope 的 WebSocket 握手实测 1–4 秒，等它会把整条
        # pipeline 的 ready 一起拖住，用户看到的就是「开始面试要等很久」。
        # 先在后台连，音频先缓冲，连上后按顺序补发。
        self._connect_task = self.create_task(self._connect())

    async def stop(self, frame: EndFrame):
        await self._finish()
        await super().stop(frame)

    async def cancel(self, frame: CancelFrame):
        await self._finish()
        await super().cancel(frame)

    async def cleanup(self):
        await self._finish()
        await super().cleanup()
        if self._owns_session and self._session:
            await self._session.close()
            self._session = None

    # ------------------------------------------------------------------
    # 连接
    # ------------------------------------------------------------------
    def _language(self) -> str:
        value = self._settings.language
        return str(getattr(value, "value", value) or "zh")

    def _endpoint(self) -> str:
        url = self._base_url or DEFAULT_BASE_URL
        parts = urlsplit(url)
        query = parts.query
        if "model=" not in query:
            query = f"{query}&model={quote(str(self._settings.model or 'qwen3-asr-flash-realtime'))}".lstrip("&")
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))

    async def _connect(self):
        async with self._connect_lock:
            if self._ws is not None and not self._ws.closed:
                return
            self._last_connect_attempt = time.monotonic()
            if not self._session:
                self._session = aiohttp.ClientSession()
            self._finished = asyncio.Event()
            started = time.monotonic()
            try:
                self._ws = await self._session.ws_connect(
                    self._endpoint(),
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    heartbeat=20,
                )
            except Exception as error:
                logger.error(
                    f"Qwen realtime ASR connect failed: {type(error).__name__}: {error!r}"
                )
                return

            language = self._language()
            await self._send(
                {
                    "type": "session.update",
                    "session": {
                        "modalities": ["text"],
                        "input_audio_format": "pcm",
                        "sample_rate": self._sample_rate,
                        "input_audio_transcription": {"language": language},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.2,
                            "silence_duration_ms": self._silence_ms,
                        },
                    },
                }
            )
            self._receiver_task = self.create_task(self._receive())
            logger.info(
                f"Qwen realtime ASR connected: model={self._settings.model} "
                f"rate={self._sample_rate} took={time.monotonic() - started:.2f}s"
            )
            # 握手期间攒下的音频按顺序补发，别让用户开口的前几句丢掉。
            await self._flush_buffer()

    async def _send(self, payload: dict):
        ws = self._ws
        if ws is None or ws.closed:
            raise RuntimeError("Qwen realtime ASR is not connected")
        await ws.send_json(payload)

    async def _finish(self):
        """先 session.finish，再等服务端把最后一句吐完，最后关连接。"""
        if self._connect_task is not None:
            if not self._connect_task.done():
                await self.cancel_task(self._connect_task)
            self._connect_task = None
        ws = self._ws
        if ws is None or ws.closed:
            self._ws = None
            self._buffer.clear()
            return
        try:
            async with self._flush_lock:
                await self._send({"type": "session.finish"})
            try:
                await asyncio.wait_for(self._finished.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.debug("Qwen realtime ASR finish timed out; closing anyway")
        except Exception as error:
            logger.debug(f"Qwen realtime ASR finish skipped: {error!r}")
        finally:
            self._ws = None
            self._buffer.clear()
            if self._receiver_task is not None:
                await self.cancel_task(self._receiver_task)
                self._receiver_task = None
            try:
                await ws.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # 音频与事件
    # ------------------------------------------------------------------
    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        if not audio:
            return
        self._buffer.extend(audio)
        self._trim_buffer()
        if self._ws is None or self._ws.closed:
            # 握手还没完成：先攒着，别在这里 await，否则又把 pipeline 卡住。
            self._ensure_connect()
        else:
            await self._flush_buffer()
        yield None

    def _ensure_connect(self):
        if self._connect_task is not None and not self._connect_task.done():
            return
        # 失败后别每 20ms 重连一次，给服务端和网络留 2 秒。
        if time.monotonic() - self._last_connect_attempt < 2.0:
            return
        self._connect_task = self.create_task(self._connect())

    def _trim_buffer(self):
        """最多留 10 秒音频；再长说明连接一直没起来，丢最旧的。"""
        max_bytes = max(3200, int(self._sample_rate * 2 * 10))
        if len(self._buffer) > max_bytes:
            del self._buffer[: len(self._buffer) - max_bytes]

    async def _flush_buffer(self):
        async with self._flush_lock:
            ws = self._ws
            if ws is None or ws.closed:
                return
            # 100ms 一包：太小请求头开销大，太大首字延迟高。
            chunk_bytes = max(1600, int(self._sample_rate * 0.1) * 2)
            while len(self._buffer) >= chunk_bytes and self._ws is ws:
                chunk = bytes(self._buffer[:chunk_bytes])
                del self._buffer[:chunk_bytes]
                try:
                    await self._send(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(chunk).decode("ascii"),
                        }
                    )
                except Exception as error:
                    # 没发出去的包放回去，下次连上再补。
                    self._buffer[:0] = chunk
                    logger.warning(
                        f"Qwen realtime ASR send failed: {type(error).__name__}: {error!r}"
                    )
                    break

    async def _receive(self):
        ws = self._ws
        if ws is None:
            return
        try:
            async for message in ws:
                if message.type == aiohttp.WSMsgType.TEXT:
                    try:
                        event = json.loads(message.data)
                    except json.JSONDecodeError:
                        continue
                    await self._handle_event(event)
                elif message.type in (
                    aiohttp.WSMsgType.ERROR,
                    aiohttp.WSMsgType.CLOSED,
                    aiohttp.WSMsgType.CLOSE,
                ):
                    break
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning(f"Qwen realtime ASR receive ended: {type(error).__name__}: {error!r}")
        finally:
            if self._ws is ws:
                self._ws = None

    async def _handle_event(self, event: dict):
        kind = str(event.get("type") or "")
        if kind == "conversation.item.input_audio_transcription.text":
            # text 是已经确认的部分，stash 是还在变的尾巴；两个拼起来才是
            # 屏幕上应该显示的当前句子。
            text = str(event.get("text") or "")
            stash = str(event.get("stash") or "")
            partial = f"{text}{stash}".strip()
            if partial and partial != self._last_partial:
                self._last_partial = partial
                await self.push_frame(
                    InterimTranscriptionFrame(
                        partial,
                        self._user_id,
                        time_now_iso8601(),
                        self._settings.language,
                    )
                )
        elif kind == "conversation.item.input_audio_transcription.completed":
            transcript = str(event.get("transcript") or "").strip()
            if transcript:
                self._last_partial = ""
                logger.debug(f"Qwen realtime transcription: [{transcript}]")
                frame = TranscriptionFrame(
                    transcript,
                    self._user_id,
                    time_now_iso8601(),
                    self._settings.language,
                )
                frame.finalized = True
                await self.push_frame(frame)
        elif kind == "session.finished":
            self._finished.set()
        elif kind == "error":
            message = str(event.get("error") or event.get("message") or event)
            logger.error(f"Qwen realtime ASR error event: {message}")
            await self.push_error(error_msg=message)
        # speech_started / speech_stopped / committed / item.created 交给
        # 本地 VAD 和 SmartTurn，这里不重复造轮次。
