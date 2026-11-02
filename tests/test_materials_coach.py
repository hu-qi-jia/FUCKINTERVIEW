"""经历卡写回：回答版本与卡片版本都要做 compare-and-set。"""

from __future__ import annotations

import pytest

import app.materials as materials


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(materials, "data_dir", lambda: tmp_path)
    yield materials


def make_profile(store):
    profile = store.create_profile("测试档案")
    profile = store.update_profile(
        profile["id"],
        {
            "cards": [
                {
                    "slug": "card-1",
                    "name": "项目",
                    "description": "描述",
                    "body": {"facts": "旧事实"},
                    "status": "ready",
                }
            ],
            "coachSlots": {
                "card-1": {
                    "facts": {"q": "事实？", "a": "回答 A", "applied": False},
                    "defense": {"q": "防守？", "a": "回答 D", "applied": False},
                }
            },
        },
    )
    return profile, store.find_card(profile["id"], "card-1")


def test_changed_answer_stays_pending(store):
    profile, card = make_profile(store)
    version = store.card_version(card)

    # 模型调用期间，用户把 facts 改成了 B。
    slots = dict(profile["coachSlots"]["card-1"])
    slots["facts"] = {**slots["facts"], "a": "回答 B", "applied": False}
    store.update_coach_slots(profile["id"], "card-1", slots)

    updated = store.apply_coach_result(
        profile["id"],
        "card-1",
        {"body": {"facts": "模型合并后的事实", "defense": "合并"}, "status": "ready"},
        ["facts", "defense"],
        expected_answers={"facts": "回答 A", "defense": "回答 D"},
        expected_card_version=version,
    )

    slots_after = updated["coachSlots"]["card-1"]
    # facts 的回答变了：不能标成已写入，下次还要带上 B。
    assert slots_after["facts"]["applied"] is False
    assert slots_after["facts"]["a"] == "回答 B"
    # defense 没变：正常写入。
    assert slots_after["defense"]["applied"] is True
    assert updated["cards"][0]["body"]["facts"] == "模型合并后的事实"


def test_card_edited_during_merge_is_not_overwritten(store):
    profile, card = make_profile(store)
    version = store.card_version(card)

    # 模型调用期间，用户手动改了卡片正文。
    store.update_card(
        profile["id"], "card-1", {"body": {"facts": "用户手动改的事实"}}
    )

    with pytest.raises(store.CardChanged):
        store.apply_coach_result(
            profile["id"],
            "card-1",
            {"body": {"facts": "旧快照合并结果"}, "status": "ready"},
            ["facts"],
            expected_answers={"facts": "回答 A"},
            expected_card_version=version,
        )

    latest = store.find_card(profile["id"], "card-1")
    assert latest["body"]["facts"] == "用户手动改的事实"
    latest_profile = store.get_profile(profile["id"])
    assert latest_profile["coachSlots"]["card-1"]["facts"]["applied"] is False


def test_second_write_back_only_merges_new_answer(store):
    profile, card = make_profile(store)
    version = store.card_version(card)

    slots = dict(profile["coachSlots"]["card-1"])
    slots["facts"] = {**slots["facts"], "a": "回答 B", "applied": False}
    store.update_coach_slots(profile["id"], "card-1", slots)

    store.apply_coach_result(
        profile["id"],
        "card-1",
        {"body": {"facts": "第一次结果", "defense": "合并"}, "status": "ready"},
        ["facts", "defense"],
        expected_answers={"facts": "回答 A", "defense": "回答 D"},
        expected_card_version=version,
    )

    current = store.get_profile(profile["id"])
    card_now = store.find_card(profile["id"], "card-1")
    store.apply_coach_result(
        profile["id"],
        "card-1",
        {"body": {"facts": "第二次结果，包含 B", "defense": "合并"}, "status": "ready"},
        ["facts"],
        expected_answers={"facts": "回答 B"},
        expected_card_version=store.card_version(card_now),
    )

    final = store.get_profile(profile["id"])
    assert final["coachSlots"]["card-1"]["facts"]["applied"] is True
    assert final["coachSlots"]["card-1"]["facts"]["a"] == "回答 B"
    assert store.find_card(profile["id"], "card-1")["body"]["facts"] == "第二次结果，包含 B"
    assert current["coachSlots"]["card-1"]["facts"]["applied"] is False
