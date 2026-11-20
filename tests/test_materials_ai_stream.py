"""经历卡 JSONL 流式解析的回归测试。

这段解析是「边生成边显示」和「被截断也不丢已到手字段」的地基，
一旦它悄悄退化，症状是卡片缺字段或者整张生成不出来——很难从界面上定位。
"""

from app.materials_ai import _drain_json_objects, _find_object_end


def _collect(src: str, sizes: tuple[int, ...]) -> list[dict]:
    """按给定的块大小切开，模拟网络分片。"""
    found: list[dict] = []
    buffer = ""
    position = 0
    for size in sizes:
        buffer += src[position : position + size]
        position += size
        records, buffer = _drain_json_objects(buffer)
        found.extend(records)
    records, buffer = _drain_json_objects(buffer)
    found.extend(records)
    return found


ONE_LINE = '{"key":"name","value":"订单重构"}\n'
ESCAPED_NEWLINE = '{"key":"facts","value":"- 2023 年 3 月\\n- 峰值 40 万"}\n'
RAW_NEWLINE = '{"key":"pitfalls","value":"- 库存服务超时\n  导致重复扣减"}\n'
TRUNCATED = '{"key":"defense","value":"问：为什么？答：因为'


def test_single_object():
    records, rest = _drain_json_objects(ONE_LINE)
    assert records == [{"key": "name", "value": "订单重构"}]
    assert rest == ""


def test_multiple_objects_across_chunks():
    src = ONE_LINE + ESCAPED_NEWLINE + RAW_NEWLINE
    records = _collect(src, (5, 7, 11, 13, 29, 1024))
    assert [item["key"] for item in records] == ["name", "facts", "pitfalls"]
    assert records[1]["value"] == "- 2023 年 3 月\n- 峰值 40 万"


def test_raw_newline_in_string_is_tolerated():
    # 模型偶尔直接吐换行符而不是转义；严格模式会把整条字段丢掉。
    records, _ = _drain_json_objects(RAW_NEWLINE)
    assert len(records) == 1
    assert "重复扣减" in records[0]["value"]


def test_truncated_tail_is_kept_not_dropped():
    src = ONE_LINE + TRUNCATED
    records, rest = _drain_json_objects(src)
    assert [item["key"] for item in records] == ["name"]
    # 尾巴要留着等更多 token，不能当成垃圾丢掉。
    assert rest.startswith('{"key":"defense"')


def test_truncated_stream_loses_only_the_incomplete_field():
    records = _collect(ONE_LINE + ESCAPED_NEWLINE + TRUNCATED, (3, 17, 40, 1024))
    assert [item["key"] for item in records] == ["name", "facts"]


def test_junk_between_objects_is_ignored():
    src = "这里是解释。\n```json\n" + ONE_LINE + "```\n" + ESCAPED_NEWLINE
    records, _ = _drain_json_objects(src)
    assert [item["key"] for item in records] == ["name", "facts"]


def test_braces_and_quotes_inside_value():
    src = '{"key":"defense","value":"问：为什么 {x} 这样？答：因为 \\"好\\"。"}'
    records, _ = _drain_json_objects(src)
    assert records[0]["value"] == '问：为什么 {x} 这样？答：因为 "好"。'


def test_find_object_end_returns_minus_one_when_incomplete():
    assert _find_object_end('{"a": "b', 0) == -1
    assert _find_object_end('{"a": "b"}', 0) == 10
