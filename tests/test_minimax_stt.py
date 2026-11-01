"""MiniMax ASR 的 SSE 解析与默认地址。"""

import json

from app.services.minimax_stt import DEFAULT_BASE_URL, parse_sse_line


def test_parse_delta_event():
    line = b'data: {"index":0,"delta":"\\u4f60\\u597d","finish":false}'
    event = parse_sse_line(line)
    assert event is not None
    assert event["delta"] == "你好"
    assert event["finish"] is False


def test_parse_finish_event():
    event = parse_sse_line('data: {"index":2,"delta":"","finish":true,"duration":4.896}')
    assert event is not None
    assert event["finish"] is True


def test_ignores_non_data_lines():
    assert parse_sse_line("") is None
    assert parse_sse_line(": keep-alive") is None
    assert parse_sse_line("event: message") is None
    assert parse_sse_line("data: ") is None


def test_ignores_done_and_broken_json():
    assert parse_sse_line("data: [DONE]") is None
    assert parse_sse_line("data: {oops") is None
    assert parse_sse_line(b"data: [1, 2]") is None


def test_parse_roundtrip_with_json_payload():
    payload = {"index": 1, "delta": "面试", "finish": False}
    line = "data: " + json.dumps(payload)
    assert parse_sse_line(line) == payload


def test_default_base_url_is_china_platform():
    # 国内 Key 打到国际站（api.minimax.io）会 401 invalid api key。
    assert DEFAULT_BASE_URL == "https://api.minimax.cn/v1"
