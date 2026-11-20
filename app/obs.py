"""可观测：慢操作的耗时与追溯日志。

这套东西只有一个约定，三条：

1. **一个事情一个 trace_id**。客户端生成，跟着请求的 ``X-Trace-Id`` 头走，
   后端全程带着它。所以一张经历卡、一场面试，都能从产物反查回它是在哪次
   调用里、用哪个模型、花了多久生成的（``meta.traceId`` / 会话记录里的 trace）。
2. **一个慢步骤一个 span**。自动记 start / done / fail 和耗时，异常照常往上抛，
   不吞错误。
3. **日志是稳定的 ``key=value``**，能 grep 能按列切。值里有空格或引号就整体加引号。

用法::

    async with span("card.generate", trace=trace, slug=slug) as trace:
        ...

    event("card.stream.first_token", trace=trace, ms=812)

改这里的时候记住：这是给排障用的，宁可少记也别记乱——字段名一旦被别的脚本
解析过，就别再改。
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from typing import Any, AsyncIterator

from loguru import logger

TRACE_HEADER = "x-trace-id"


def new_trace_id() -> str:
    return uuid.uuid4().hex[:16]


def normalize_trace(value: Any) -> str:
    """把客户端传来的 trace_id 收成安全的短串；没有就现生成一个。"""
    text = str(value or "").strip()
    if text and text.replace("-", "").isalnum() and len(text) <= 32:
        return text
    return new_trace_id()


def _value(value: Any) -> str:
    text = str(value)
    if not text or any(char.isspace() for char in text) or "=" in text:
        return '"' + text.replace('"', "'") + '"'
    return text


def _pairs(fields: dict[str, Any]) -> str:
    kept = {key: value for key, value in fields.items() if value is not None}
    if not kept:
        return ""
    return " " + " ".join(f"{key}={_value(value)}" for key, value in kept.items())


def event(name: str, *, trace: str | None = None, **fields: Any) -> None:
    """记一个瞬时事件（不计时），例如「首字到达」。"""
    logger.info(f"[obs] {name} trace={trace or '-'}{_pairs(fields)}")


@contextlib.asynccontextmanager
async def span(
    name: str, *, trace: str | None = None, **fields: Any
) -> AsyncIterator[str]:
    """包住一个慢操作，自动记耗时与成败；yield 出 trace_id 供内层复用。"""
    trace_id = trace or new_trace_id()
    started = time.perf_counter()
    logger.info(f"[obs] start {name} trace={trace_id}{_pairs(fields)}")
    try:
        yield trace_id
    except (asyncio.CancelledError, GeneratorExit) as error:
        # 调用方主动掐断（用户点了停止、请求被取消）不算失败，但要留痕，
        # 否则半途而废的调用在日志里会变成「没有下文」。
        ms = int((time.perf_counter() - started) * 1000)
        logger.warning(
            f"[obs] cancel {name} trace={trace_id} ms={ms}"
            f"{_pairs({**fields, 'reason': type(error).__name__})}"
        )
        raise
    except BaseException as error:
        ms = int((time.perf_counter() - started) * 1000)
        logger.error(
            f"[obs] fail {name} trace={trace_id} ms={ms}"
            f"{_pairs({**fields, 'error': str(error)[:200]})}"
        )
        raise
    else:
        ms = int((time.perf_counter() - started) * 1000)
        logger.info(f"[obs] done {name} trace={trace_id} ms={ms}{_pairs(fields)}")
