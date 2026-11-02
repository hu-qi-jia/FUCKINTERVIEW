"""问答导入：文件内部重复、与库内已有重复、追加模式。"""

from __future__ import annotations

import pytest

import app.qa as qa
import app.qa_import as qa_import
import app.qa_index as qa_index


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(qa, "data_dir", lambda: tmp_path)
    # 导入会触发后台向量索引；测试只验证入库/判重，不要启动模型线程。
    monkeypatch.setattr(qa_index, "enqueue", lambda qa_id: None)
    monkeypatch.setattr(qa_index, "enqueue_many", lambda ids: None)
    qa.reset_cache()
    qa_index.invalidate()
    yield qa
    qa.reset_cache()
    qa_index.invalidate()


def csv(*rows: tuple[str, str]) -> bytes:
    lines = ["问题,答案", *[f"{q},{a}" for q, a in rows]]
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_merge_dedupes_duplicate_questions_inside_file(store):
    raw = csv(
        ("怎么做自我介绍？", "答案 A"),
        ("怎么做自我介绍", "答案 B"),
    )
    preview = qa_import.preview(raw, "questions.csv")

    decisions = [(row["decision"], row.get("duplicateOfLine")) for row in preview["items"]]
    assert decisions == [("insert", None), ("update", 2)]

    result = qa_import.commit(preview["token"], "merge")
    assert result["inserted"] == 1
    assert result["updated"] == 1
    assert result["skipped"] == 0

    items = store.list_qa()["items"]
    assert len(items) == 1
    # 后出现的行更新同一条记录，内容以它为准。
    assert items[0]["answer"] == "答案 B"


def test_merge_skips_exact_duplicate_rows(store):
    raw = csv(
        ("什么是 QPS？", "每秒查询数"),
        ("什么是 QPS?", "每秒查询数"),
    )
    preview = qa_import.preview(raw, "questions.csv")
    decisions = [row["decision"] for row in preview["items"]]
    assert decisions == ["insert", "skip"]

    result = qa_import.commit(preview["token"], "merge")
    assert result["inserted"] == 1
    assert result["updated"] == 0
    assert result["skipped"] == 1
    assert len(store.list_qa()["items"]) == 1


def test_merge_combines_file_duplicate_with_existing_row(store):
    store.create_qa({"question": "自我介绍怎么做", "answer": "旧答案"})

    raw = csv(
        ("自我介绍怎么做？", "第一版"),
        ("自我介绍怎么做", "第二版"),
    )
    preview = qa_import.preview(raw, "questions.csv")
    assert [row["decision"] for row in preview["items"]] == ["update", "update"]

    result = qa_import.commit(preview["token"], "merge")
    assert result["inserted"] == 0
    assert result["updated"] == 2
    assert result["skipped"] == 0

    items = store.list_qa()["items"]
    assert len(items) == 1
    assert items[0]["answer"] == "第二版"


def test_append_mode_keeps_file_duplicates(store):
    raw = csv(
        ("怎么做自我介绍？", "答案 A"),
        ("怎么做自我介绍", "答案 B"),
    )
    preview = qa_import.preview(raw, "questions.csv")
    result = qa_import.commit(preview["token"], "append")
    assert result["inserted"] == 2
    assert len(store.list_qa()["items"]) == 2


def test_commit_rechecks_database_after_preview(store):
    raw = csv(("项目难点是什么？", "预览时的答案"))
    preview = qa_import.preview(raw, "questions.csv")

    # 预览之后，另一批导入先写入了同一条问题。
    store.create_qa({"question": "项目难点是什么", "answer": "别处写入的答案"})

    result = qa_import.commit(preview["token"], "merge")
    assert result["inserted"] == 0
    assert result["updated"] == 1
    assert len(store.list_qa()["items"]) == 1
