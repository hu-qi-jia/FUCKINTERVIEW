"""直接调用设置页里配置的 LLM（不经过语音 pipeline）。

只用 aiohttp：OpenAI 兼容（含 Qwen 的 compatible-mode）走 /chat/completions，
Anthropic 走 /v1/messages。这里只负责拿到文本；结构化输出由调用方解析。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import aiohttp
from loguru import logger

DEFAULT_TIMEOUT_SECONDS = 120


class LLMError(RuntimeError):
    """调用失败：未配置、HTTP 错误或返回内容不可用。"""


class EmptyResponse(LLMError):
    """HTTP 200 但正文为空。兼容接口偶发，重试一次通常就好。"""


def _require_key(section: dict[str, Any], label: str, env: str) -> str:
    key = str(section.get("api_key") or "").strip() or os.getenv(env, "").strip()
    if not key:
        raise LLMError(f"{label} 的 API Key 未配置，请先在设置页填写")
    return key


async def complete(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_tokens: int = 4096,
    attempts: int = 2,
) -> str:
    """调一次模型拿文本。

    空回复是兼容接口的偶发抖动（200，但 content 为空），重试一次基本都能拿到；
    被 max_tokens 截断属于确定性问题，不重试，直接把原因报出来。
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
    max_tokens: int,
) -> str:
    provider = str(section.get("provider") or "openai_compatible")
    if provider == "anthropic":
        return await _anthropic(section, messages, timeout=timeout, max_tokens=max_tokens)
    return await _openai_compatible(section, messages, timeout=timeout, max_tokens=max_tokens)


async def _openai_compatible(
    section: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    timeout: float,
    max_tokens: int,
) -> str:
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

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    data = await _post_json(url, payload, headers, timeout, "LLM")
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
    max_tokens: int,
) -> str:
    key = _require_key(section, "LLM (Anthropic)", "ANTHROPIC_API_KEY")
    base_url = str(section.get("base_url") or "").strip() or "https://api.anthropic.com"
    model = str(section.get("model") or "").strip() or "claude-sonnet-5-5"

    url = base_url.rstrip("/")
    if not url.endswith("/v1/messages"):
        url = f"{url}/v1/messages"

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
        "model": model,
        "max_tokens": max_tokens,
        "messages": conversation,
    }
    if system:
        payload["system"] = system
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
) -> dict[str, Any]:
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as session:
            async with session.post(url, json=payload, headers=headers) as response:
                text = await response.text()
                if response.status >= 400:
                    raise LLMError(f"{label} 请求失败（HTTP {response.status}）：{text[:300]}")
                try:
                    return json.loads(text)
                except json.JSONDecodeError as error:
                    raise LLMError(f"{label} 返回的不是 JSON：{text[:300]}") from error
    except aiohttp.ClientError as error:
        raise LLMError(f"{label} 连接失败：{error}") from error
    except TimeoutError as error:
        raise LLMError(f"{label} 请求超时（{int(timeout)} 秒）") from error


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
    max_tokens: int = 4096,
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
