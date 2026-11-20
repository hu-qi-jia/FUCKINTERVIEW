"""直接调用设置页里配置的 LLM（不经过语音 pipeline）。

只用 aiohttp：OpenAI 兼容（含 Qwen 的 compatible-mode）走 /chat/completions，
Anthropic 走 /v1/messages。这里只负责拿到文本；结构化输出由调用方解析。

两条加速约定，改这里的时候别丢：
1. 整个进程共用一个 aiohttp 连接池。一次生成十张经历卡会并发打十个请求，
   每次新建 TCP + TLS 会话光握手就要几百毫秒。
2. 「关思考」和语音管线（app/providers.py 的 build_llm）读同一个
   disable_thinking 设置，默认关。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, AsyncIterator

import aiohttp
from loguru import logger

DEFAULT_TIMEOUT_SECONDS = 120

# Anthropic 的 max_tokens 是必填项，只能给一个够大的值；
# OpenAI 兼容接口则不传这个字段，让服务商自己按模型上限决定。
ANTHROPIC_MAX_OUTPUT = 8192

# 并发上限：默认 10 张卡会同时开跑，连接池要放得下。
_CONNECTOR_LIMIT = 32

_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(
                limit=_CONNECTOR_LIMIT,
                ttl_dns_cache=300,
                enable_cleanup_closed=True,
            ),
        )
    return _session


async def close() -> None:
    """进程退出前收掉连接池（server.py 的 shutdown 钩子里调用）。"""
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


class LLMError(RuntimeError):
    """调用失败：未配置、HTTP 错误或返回内容不可用。"""


class EmptyResponse(LLMError):
    """HTTP 200 但正文为空。兼容接口偶发，重试一次通常就好。"""


def _require_key(section: dict[str, Any], label: str, env: str) -> str:
    key = str(section.get("api_key") or "").strip() or os.getenv(env, "").strip()
    if not key:
        raise LLMError(f"{label} 的 API Key 未配置，请先在设置页填写")
    return key


# DeepSeek 的 reasoning_effort 取值：none 关思考；low / high / max 开思考，档位递增。
# 文档里的兼容别名（minimal→low、medium→high、xhigh→high）这里不收，
# 免得界面上写的和实际生效的对不上。
THINKING_EFFORTS = ("none", "low", "high", "max")
DEFAULT_THINKING_EFFORT = "low"


def _thinking_extras(section: dict[str, Any]) -> dict[str, Any]:
    """这一路调用的思考档位（思考开多深）。

    和语音管线（app/providers.py 的 build_llm）**不是一回事**：那边是实时回答，
    必须一直关思考；这边是批量生成，可以拿一点时间换推理质量。两边各有各的
    配置项，改一个不会牵动另一个。

    实际只有**生成经历卡**开思考：调用方（app/materials_ai.py）会给规划、
    简历整合、教练问答显式传 thinking="none" 压回去——那几路在用户等待路径上，
    思考实测慢好几倍却没换来更好的输出。

    不传 thinking_effort 时 DeepSeek 默认是 high——思考开得比预期深会白等，
    所以这里显式回落到 low。

    注意：Anthropic 走的是另一套（thinking.budget_tokens），这条路不生效；
    那边默认就是关思考。
    """
    effort = str(
        section.get("thinking_effort") or DEFAULT_THINKING_EFFORT
    ).strip().lower()
    if effort not in THINKING_EFFORTS:
        effort = DEFAULT_THINKING_EFFORT
    return {"reasoning_effort": effort}


def _rejects_reasoning_effort(body: str) -> bool:
    """400 的原因是不是「不认识 / 不接受 reasoning_effort」。"""
    lowered = body.lower()
    return (
        "reasoning_effort" in lowered
        or "unknown parameter" in lowered
        or "unrecognized" in lowered
        or "unexpected keyword" in lowered
    )


async def complete(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_tokens: int | None = None,
    attempts: int = 2,
) -> str:
    """调一次模型拿文本。

    默认不限制输出长度（不传 max_tokens），由服务商按模型上限决定；
    兼容接口的偶发空回复会自动重试一次，真被截断则直接报原因。
    """
    last: LLMError | None = None
    for attempt in range(max(1, attempts)):
        try:
            return await _complete_once(
                section, messages, timeout=timeout, max_tokens=max_tokens
            )
        except EmptyResponse as error:
            last = error
            if attempt + 1 < attempts:
                logger.warning(f"{error}；重试")
                await asyncio.sleep(0.6)
    if last is None:  # 兜底：循环至少执行一次，正常到不了这里
        raise LLMError("LLM 调用失败")
    raise last


async def _complete_once(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int | None,
) -> str:
    provider = str(section.get("provider") or "openai_compatible")
    if provider == "anthropic":
        return await _anthropic(section, messages, timeout=timeout, max_tokens=max_tokens)
    return await _openai_compatible(section, messages, timeout=timeout, max_tokens=max_tokens)


# --------------------------------------------------------------------------
# 供应商参数：非流式和流式共用同一份 payload 构造，别各写一份。
# --------------------------------------------------------------------------


def _openai_target(section: dict[str, Any]) -> tuple[str, str, str]:
    """返回 (api_key, chat/completions 地址, model)。"""
    provider = str(section.get("provider") or "openai_compatible")
    if provider == "qwen":
        key = _require_key(section, "LLM (Qwen)", "DASHSCOPE_API_KEY")
        base_url = str(section.get("base_url") or "").strip() or (
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        model = str(section.get("model") or "").strip() or "qwen-plus"
    else:
        key = _require_key(section, "LLM (OpenAI 兼容)", "OPENAI_API_KEY")
        base_url = str(section.get("base_url") or "").strip() or "https://api.openai.com/v1"
        model = str(section.get("model") or "").strip() or "gpt-4o-mini"

    url = base_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url = f"{url}/chat/completions"
    return key, url, model


def _anthropic_target(section: dict[str, Any]) -> tuple[str, str, str]:
    key = _require_key(section, "LLM (Anthropic)", "ANTHROPIC_API_KEY")
    base_url = str(section.get("base_url") or "").strip() or "https://api.anthropic.com"
    model = str(section.get("model") or "").strip() or "claude-sonnet-5-5"

    url = base_url.rstrip("/")
    if not url.endswith("/v1/messages"):
        url = f"{url}/v1/messages"
    return key, url, model


def _anthropic_payload(
    messages: list[dict[str, str]], max_tokens: int | None
) -> dict[str, Any]:
    system = "\n\n".join(
        str(message.get("content") or "")
        for message in messages
        if message.get("role") == "system"
    )
    conversation = [
        {"role": message["role"], "content": message["content"]}
        for message in messages
        if message.get("role") in ("user", "assistant")
    ]
    payload: dict[str, Any] = {
        # 这个字段在 Anthropic 上是必填的，不限制时给一个足够大的值。
        "max_tokens": max_tokens or ANTHROPIC_MAX_OUTPUT,
        "messages": conversation,
    }
    if system:
        payload["system"] = system
    return payload


async def _openai_compatible(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int | None,
) -> str:
    key, url, model = _openai_target(section)
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "stream": False,
    }
    payload.update(_thinking_extras(section))
    if max_tokens:
        payload["max_tokens"] = max_tokens
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    data = await _post_json(url, payload, headers, timeout, "LLM", section=section)
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        # 兼容接口偶尔回 200 但 choices 为空，和空正文一样按抖动处理。
        raise EmptyResponse(f"LLM 返回了空内容（choices 为空）：{_short(data)}")
    try:
        choice = choices[0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise LLMError(f"LLM 返回格式异常：{_short(data)}") from error
    if isinstance(content, list):
        # 少数兼容实现按 content parts 返回。
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    if not isinstance(content, str) or not content.strip():
        finish = str(choice.get("finish_reason") or "") if isinstance(choice, dict) else ""
        if finish == "length":
            raise LLMError(
                "LLM 输出被 max_tokens 截断，没有产生正文；请调大模型输出上限后重试"
            )
        raise EmptyResponse(f"LLM 返回了空内容（finish_reason={finish or '未提供'}）")
    return content.strip()


async def _anthropic(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int | None,
) -> str:
    key, url, model = _anthropic_target(section)
    payload = _anthropic_payload(messages, max_tokens)
    payload["model"] = model
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    data = await _post_json(url, payload, headers, timeout, "LLM (Anthropic)")
    try:
        blocks = data["content"]
        text = "".join(
            block.get("text", "")
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
    except (KeyError, TypeError) as error:
        raise LLMError(f"Anthropic 返回格式异常：{_short(data)}") from error
    if not text.strip():
        stop = str(data.get("stop_reason") or "")
        if stop == "max_tokens":
            raise LLMError(
                "LLM 输出被 max_tokens 截断，没有产生正文；请调大模型输出上限后重试"
            )
        raise EmptyResponse(f"LLM 返回了空内容（stop_reason={stop or '未提供'}）")
    return text.strip()


async def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: float,
    label: str,
    *,
    section: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        session = await _get_session()
        async with session.post(
            url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)
        ) as response:
            text = await response.text()
            if response.status >= 400:
                # 少数供应商不认识 reasoning_effort 会整个拒绝请求。只有真的是
                # 这个字段被拒时才去掉它重试，免得别的 400 也白跑一趟。
                if (
                    response.status == 400
                    and section is not None
                    and _rejects_reasoning_effort(text)
                ):
                    stripped = {
                        key: value
                        for key, value in payload.items()
                        if key not in _thinking_extras(section)
                    }
                    logger.warning(f"{label} 拒绝了 reasoning_effort，去掉后重试")
                    return await _post_json(url, stripped, headers, timeout, label)
                raise LLMError(f"{label} 请求失败（HTTP {response.status}）：{text[:300]}")
            try:
                return json.loads(text)
            except json.JSONDecodeError as error:
                raise LLMError(f"{label} 返回的不是 JSON：{text[:300]}") from error
    except aiohttp.ClientError as error:
        raise LLMError(f"{label} 连接失败：{error}") from error
    except TimeoutError as error:
        raise LLMError(f"{label} 请求超时（{int(timeout)} 秒）") from error


# --------------------------------------------------------------------------
# 流式：逐段把模型输出的文本增量 yield 出去。
#
# 调用方（app/materials_ai.py）按行解析，一行一个完整 JSON 对象，
# 所以哪怕被 max_tokens 截断，已经到手的字段也都能用——这一点是 JSON 做不到的。
# --------------------------------------------------------------------------


async def complete_stream(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """流式调用模型，逐段 yield 文本增量。

    不在这里做重试：流已经吐了一半再重来会把输出拼成两份，重试交给调用方。
    """
    provider = str(section.get("provider") or "openai_compatible")
    if provider == "anthropic":
        async for chunk in _anthropic_stream(
            section, messages, timeout=timeout, max_tokens=max_tokens
        ):
            yield chunk
    else:
        async for chunk in _openai_stream(
            section, messages, timeout=timeout, max_tokens=max_tokens
        ):
            yield chunk


async def _openai_stream(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int | None,
) -> AsyncIterator[str]:
    key, url, model = _openai_target(section)
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "stream": True,
    }
    payload.update(_thinking_extras(section))
    if max_tokens:
        payload["max_tokens"] = max_tokens
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with _stream_response(url, payload, headers, timeout, "LLM") as response:
        async for line in _sse_lines(response):
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") if isinstance(chunk, dict) else None
            if not isinstance(choices, list) or not choices:
                continue
            delta = (choices[0] or {}).get("delta") or {}
            text = delta.get("content")
            if isinstance(text, str) and text:
                yield text


async def _anthropic_stream(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int | None,
) -> AsyncIterator[str]:
    key, url, model = _anthropic_target(section)
    payload = _anthropic_payload(messages, max_tokens)
    payload["model"] = model
    payload["stream"] = True
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    async with _stream_response(
        url, payload, headers, timeout, "LLM (Anthropic)"
    ) as response:
        async for line in _sse_lines(response):
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict) or event.get("type") != "content_block_delta":
                continue
            delta = event.get("delta") or {}
            if delta.get("type") == "text_delta":
                text = delta.get("text")
                if isinstance(text, str) and text:
                    yield text


class _stream_response:
    """流式请求的上下文：统一错误处理，并在调用方提前退出时关掉连接。"""

    def __init__(
        self,
        url: str,
        payload: dict[str, Any],
        headers: dict[str, str],
        timeout: float,
        label: str,
    ) -> None:
        self._url = url
        self._payload = payload
        self._headers = headers
        self._timeout = timeout
        self._label = label
        self._response: aiohttp.ClientResponse | None = None

    async def __aenter__(self) -> aiohttp.ClientResponse:
        session = await _get_session()
        try:
            self._response = await session.post(
                self._url,
                json=self._payload,
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            )
        except aiohttp.ClientError as error:
            raise LLMError(f"{self._label} 连接失败：{error}") from error
        except TimeoutError as error:
            raise LLMError(f"{self._label} 请求超时（{int(self._timeout)} 秒）") from error

        if self._response.status >= 400:
            text = await self._response.text()
            self._response.release()
            raise LLMError(
                f"{self._label} 请求失败（HTTP {self._response.status}）：{text[:300]}"
            )
        return self._response

    async def __aexit__(self, *_: Any) -> None:
        if self._response is not None and not self._response.closed:
            self._response.close()


async def _sse_lines(response: aiohttp.ClientResponse) -> AsyncIterator[str]:
    """把 SSE 的字节流按行切开。

    response.content 迭代出来的是任意大小的块，不是行，所以自己攒缓冲。
    """
    buffer = b""
    async for chunk in response.content.iter_any():
        buffer += chunk
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            line = raw.decode("utf-8", "replace").strip("\r")
            if line:
                yield line
    tail = buffer.decode("utf-8", "replace").strip()
    if tail:
        yield tail


def _short(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    return text[:300]


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def extract_json(text: str) -> dict[str, Any]:
    """从模型回复里取出第一个 JSON 对象（容忍代码块和前后废话）。"""
    cleaned = _FENCE.sub("", text.strip()).strip()
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(cleaned)):
            char = cleaned[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        value = json.loads(cleaned[start : index + 1])
                        if isinstance(value, dict):
                            return value
                    except json.JSONDecodeError:
                        break
        start = cleaned.find("{", start + 1)
    raise LLMError(f"模型没有返回合法 JSON：{text[:300]}")


async def complete_json(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """要结构化输出；解析失败时用纠正提示重试一次。"""
    raw = await complete(section, messages, timeout=timeout, max_tokens=max_tokens)
    try:
        return extract_json(raw)
    except LLMError:
        retry_messages = [
            *messages,
            {"role": "assistant", "content": raw},
            {
                "role": "user",
                "content": "上一条回复不是合法 JSON。只输出一个 JSON 对象，"
                "不要代码块、不要解释、不要前后文字。",
            },
        ]
        second = await complete(section, retry_messages, timeout=timeout, max_tokens=max_tokens)
        return extract_json(second)
