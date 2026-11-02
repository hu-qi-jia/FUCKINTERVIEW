"""把一条 Pipecat 连接上的转写、指标写进会话历史。

实时面试有两条连接，各自挂一个采集器：

- 面试官那路：系统音频的 STT 结果记成 ``interviewer``；AI 输出记成 ``ai``；
- 候选人那路：麦克风的 STT 结果记成 ``candidate``，没有 LLM。

模拟面试只有一条连接：用户说话是 ``candidate``，AI 面试官是 ``ai``。

采集器只读帧、不消费帧，所以挂成 PipelineWorker 的 observer，而不是往
pipeline 里再加一个处理器。
"""

from __future__ import annotations

from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    MetricsFrame,
    TranscriptionFrame,
)
from pipecat.metrics.metrics import (
    LLMUsageMetricsData,
    STTUsageMetricsData,
    TTFATMetricsData,
    TTFBMetricsData,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed

from app import sessions as sessions_store


class SessionRecorder(BaseObserver):
    """收集一场连接里的对话与指标；断开时由 run_bot 写库。

    Parameters:
        session_id: ``sessions.open_session()`` 返回的行 id。
        role: 这条连接上的用户语音属于谁（``interviewer`` / ``candidate``）。
        record_assistant: 是否记录 AI 输出；候选人那路没有 LLM，传 False。
        qa_source: 问答库直出的处理器类名。命中的那一轮标成 ``qa``，方便
            统计命中率，也方便历史详情区分「AI 生成」和「库里的原文」。
    """

    def __init__(
        self,
        *,
        session_id: int | None,
        role: str,
        record_assistant: bool,
        qa_source: str | None = None,
    ):
        # 每个帧只在第一次 push 时处理；后续每跳一次都会再看到一遍。
        super().__init__(observe_every_push=False)
        self._session_id = session_id
        self._role = role
        self._record_assistant = record_assistant
        self._qa_source = qa_source

        self._reply: list[str] = []
        self._reply_is_qa = False

        self.ttfb_sum_ms = 0.0
        self.ttfb_count = 0
        self.ttft_sum_ms = 0.0
        self.ttft_count = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.cache_read_tokens = 0
        self.stt_seconds = 0.0

    async def on_push_frame(self, data: FramePushed):
        # 记录失败不能影响面试本身：写库出问题只记日志，帧继续往下走。
        try:
            self._handle(data)
        except Exception as error:
            logger.warning(f"记录面试内容失败：{error}")

    def _handle(self, data: FramePushed) -> None:
        # 会话行建失败时只采集指标、不落库；面试照常进行。
        if self._session_id is None:
            return
        frame = data.frame

        if isinstance(frame, TranscriptionFrame):
            sessions_store.add_turn(
                self._session_id,
                self._role,
                f"{self._role}_stt",
                frame.text,
            )
            return

        # 指标和「是否记录 AI 文本」无关：候选人那路 record_assistant=False，
        # 但它的 STT 用量同样要计入历史。
        if isinstance(frame, MetricsFrame):
            self._collect_metrics(frame)
            return

        if not self._record_assistant:
            return

        if isinstance(frame, LLMFullResponseStartFrame):
            self._flush_reply()
            return
        if isinstance(frame, LLMTextFrame):
            text = str(getattr(frame, "text", "") or "")
            if not text:
                return
            self._reply.append(text)
            if self._qa_source and type(data.source).__name__ == self._qa_source:
                self._reply_is_qa = True
            return
        if isinstance(frame, LLMFullResponseEndFrame):
            self._flush_reply()

    def _flush_reply(self) -> None:
        text = "".join(self._reply).strip()
        self._reply = []
        is_qa = self._reply_is_qa
        self._reply_is_qa = False
        if not text or self._session_id is None:
            return
        sessions_store.add_turn(
            self._session_id,
            "ai",
            "qa" if is_qa else "llm",
            text,
        )

    def _collect_metrics(self, frame: MetricsFrame) -> None:
        for item in frame.data:
            if isinstance(item, TTFBMetricsData):
                self.ttfb_sum_ms += float(item.value) * 1000
                self.ttfb_count += 1
            elif isinstance(item, TTFATMetricsData):
                self.ttft_sum_ms += float(item.ttfat) * 1000
                self.ttft_count += 1
            elif isinstance(item, LLMUsageMetricsData):
                usage = item.value
                self.prompt_tokens += int(usage.prompt_tokens or 0)
                self.completion_tokens += int(usage.completion_tokens or 0)
                self.total_tokens += int(usage.total_tokens or 0)
                self.cache_read_tokens += int(usage.cache_read_input_tokens or 0)
            elif isinstance(item, STTUsageMetricsData):
                self.stt_seconds += float(item.value.audio_seconds or 0)

    def metrics(self) -> dict[str, Any]:
        """断开时写给 ``sessions.add_metrics`` / ``finalize_session`` 的聚合值。"""
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "ttfb_sum_ms": round(self.ttfb_sum_ms, 1),
            "ttfb_count": self.ttfb_count,
            "ttft_sum_ms": round(self.ttft_sum_ms, 1),
            "ttft_count": self.ttft_count,
            "stt_seconds": round(self.stt_seconds, 2),
        }

    def finish(self) -> dict[str, Any]:
        """把还没收尾的 AI 回复落库，并返回指标。"""
        self._flush_reply()
        return self.metrics()
