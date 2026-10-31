"""术语库的纯逻辑测试：不启动服务、不碰模型。

每个用例换一个临时目录，避免读写真实的 ``config/terms.db``。
"""

from __future__ import annotations

import pytest

import app.terms as terms


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(terms, "data_dir", lambda: tmp_path)
    terms.reset_cache()
    yield terms
    terms.reset_cache()


def add(store, term, definition="", aliases=None, enabled=True):
    return store.create_term(
        {"term": term, "definition": definition, "aliases": aliases or [], "enabled": enabled}
    )


# --------------------------------------------------------------------------
# 纠错
# --------------------------------------------------------------------------
def test_corrects_alias_and_keeps_canonical(store):
    text, hits = store.correct("我们这季度JGV涨了20%，GMV也不错")
    assert text == "我们这季度GMV涨了20%，GMV也不错"
    assert hits == [{"from": "JGV", "to": "GMV"}]


def test_correct_is_case_insensitive(store):
    text, hits = store.correct("gmv 掉了")
    assert text == "GMV 掉了"
    assert hits == [{"from": "gmv", "to": "GMV"}]


def test_correct_respects_word_boundaries(store):
    for text in ("superGMV", "GMVs", "GMV2"):
        assert store.correct(text) == (text, [])


def test_correct_leaves_unknown_tokens_alone(store):
    text = "这次的 ABC 和 GMV 不一样"
    assert store.correct(text) == (text, [])


def test_correct_ignores_disabled_term(store):
    item = add(store, "内部黑话", aliases=["内部黑化"])
    store.update_term(item["id"], {"enabled": False})
    text, hits = store.correct("内部黑化")
    assert (text, hits) == ("内部黑化", [])


def test_correct_ignores_disabled_template(store):
    store.set_template_enabled("ops", False)
    text, hits = store.correct("JGV 涨了")
    assert (text, hits) == ("JGV 涨了", [])


def test_custom_term_wins_over_template(store):
    add(store, "GMV", definition="我们内部统计的是已支付口径", aliases=["GMW"])
    assert store.correct("GMW")[0] == "GMV"
    text, _ = store.correct("GMV")
    assert text == "GMV"


# --------------------------------------------------------------------------
# 提示词
# --------------------------------------------------------------------------
def test_glossary_only_injects_mentioned_terms_with_definition(store):
    add(store, "内部黑话", definition="团队里对某个核心指标的私下叫法")
    add(store, "内部黑语", definition="另一个只在团队内部使用的说法")
    block = store.render_glossary("我们聊聊内部黑话")
    assert "内部黑话：" in block
    assert "内部黑语" not in block


def test_glossary_skips_terms_without_definition(store):
    add(store, "内部黑话", definition="")
    assert store.render_glossary("内部黑话") == ""


def test_glossary_mentions_match_aliases(store):
    add(store, "内部黑话", definition="团队里对某个核心指标的私下叫法", aliases=["内部黑化"])
    assert "内部黑话：" in store.render_glossary("内部黑化是什么意思")


def test_glossary_truncates_definition(store):
    add(store, "内部黑话", definition="甲" * 120)
    block = store.render_glossary("内部黑话")
    assert "甲" * terms.INJECT_DEFINITION in block
    assert "甲" * (terms.INJECT_DEFINITION + 1) not in block


# --------------------------------------------------------------------------
# 模板
# --------------------------------------------------------------------------
def test_templates_are_seeded_once(store):
    total = store.stats()["total"]
    assert total == sum(item["count"] for item in store.list_templates())
    store.connect().close()
    assert store.stats()["total"] == total


def test_stats_ignores_disabled_templates(store):
    before = store.stats()["total"]
    product = next(item for item in store.list_templates() if item["id"] == "product")
    store.set_template_enabled("product", False)
    assert store.stats()["total"] == before - product["count"]


def test_custom_template_holds_its_terms(store):
    template = store.create_template("我的黑话")
    item = add(store, "内部黑话")
    moved = store.create_term({"term": "内部术语", "template": template["id"]})

    assert moved["template"] == template["id"]
    listed = store.list_templates()
    assert any(entry["id"] == template["id"] and entry["count"] == 1 for entry in listed)
    assert [row["term"] for row in store.list_terms(template=template["id"])["items"]] == [
        "内部术语"
    ]
    assert item["template"] == store.CUSTOM_TEMPLATE


def test_delete_custom_template_keeps_terms(store):
    template = store.create_template("临时模板")
    item = store.create_term({"term": "内部术语", "template": template["id"]})

    store.delete_template(template["id"])

    fresh = store.get_term(item["id"])
    assert fresh["template"] == store.CUSTOM_TEMPLATE
    assert all(entry["id"] != template["id"] for entry in store.list_templates())


def test_builtin_template_cannot_be_renamed_or_deleted(store):
    with pytest.raises(ValueError):
        store.rename_template("product", "新名字")
    with pytest.raises(ValueError):
        store.delete_template("product")


def test_reset_template_keeps_user_added_terms(store):
    store.create_term({"term": "内部术语", "template": "product"})
    store.reset_template("product")
    items = store.list_terms(template="product")["items"]
    assert any(item["term"] == "内部术语" for item in items)


def test_new_template_terms_are_added_but_existing_kept(store):
    item = store.list_terms(q="GMV")["items"][0]
    store.update_term(item["id"], {"definition": "改过的释义"})

    conn = store.connect()
    try:
        store.sync_templates(conn)
    finally:
        conn.close()

    fresh = store.list_terms(q="GMV")["items"][0]
    assert fresh["definition"] == "改过的释义"
    assert fresh["id"] == item["id"]


def test_template_upgrade_rewrites_stale_rows(store):
    conn = store.connect()
    try:
        conn.execute(
            "INSERT INTO terms(template, term, term_key, definition, aliases, enabled, "
            "hidden, sort_order, created_at, updated_at) "
            "VALUES ('product','旧术语','旧术语','','[]',1,0,99,?,?)",
            ("2020-01-01T00:00:00+00:00", "2020-01-01T00:00:00+00:00"),
        )
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'template_version'")
        store.upgrade_templates(conn)
        names = {
            row[0]
            for row in conn.execute("SELECT term FROM terms WHERE template = 'product'")
        }
    finally:
        conn.close()
    assert "旧术语" not in names
    assert "PRD" in names


def test_deleted_template_term_stays_deleted(store):
    item = store.list_terms(q="GMV")["items"][0]
    store.delete_term(item["id"])

    assert store.list_terms(q="GMV")["items"] == []
    conn = store.connect()
    try:
        store.sync_templates(conn)
    finally:
        conn.close()
    assert store.list_terms(q="GMV")["items"] == []


def test_deleted_custom_term_is_removed(store):
    item = add(store, "内部黑话")
    store.delete_term(item["id"])
    assert store.list_terms(q="内部黑话")["items"] == []


# --------------------------------------------------------------------------
# 批量粘贴
# --------------------------------------------------------------------------
def test_parse_bulk_supports_three_shapes(store):
    parsed = store.parse_bulk(
        "\n".join(
            [
                "# 注释行",
                "北极星指标",
                "北极星指标,团队用来衡量核心目标的那一个指标",
                "GMV,成交额,成交总额,商品交易总额",
                ",缺少术语",
            ]
        )
    )
    assert parsed["items"] == [
        {"term": "北极星指标", "aliases": [], "definition": ""},
        {"term": "GMV", "aliases": ["成交额", "成交总额"], "definition": "商品交易总额"},
    ]
    assert [item["line"] for item in parsed["errors"]] == [3, 5]


def test_bulk_create_updates_existing_custom_term(store):
    add(store, "GMV")
    result = store.bulk_create("GMV,成交额,成交总额,商品交易总额")
    assert result["created"] == 0
    assert result["updated"] == 1
    item = store.list_terms(q="GMV")["items"][0]
    assert item["definition"] == "商品交易总额"
    assert item["aliases"] == ["成交额", "成交总额"]


# --------------------------------------------------------------------------
# 离线候选
# --------------------------------------------------------------------------
def test_referenced_confusions_finds_near_miss(store):
    add(store, "QWEK")
    suggestions = store.referenced_confusions("我们看 QWEJ 这个指标")
    assert suggestions == [{"from": "QWEJ", "to": "QWEK", "reason": "near-miss"}]


def test_referenced_confusions_skips_known_tokens(store):
    assert store.referenced_confusions("我们看 JGV 这个指标") == []
