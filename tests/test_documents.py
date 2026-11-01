"""「其他资料」存储的纯逻辑测试：不启动服务、不碰模型。

每个用例换一个临时目录，避免读写真实的 ``config/documents.json``。
"""

from __future__ import annotations

import json

import pytest

import app.documents as documents


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(documents, "data_dir", lambda: tmp_path)
    yield documents


def test_add_document_writes_file_and_metadata(store):
    entry = store.add_document("逐字稿.md", b"# hello")

    assert entry["title"] == "逐字稿"
    assert entry["ext"] == "md"
    assert entry["size"] == 7
    assert (store.documents_dir() / f"{entry['id']}.md").read_bytes() == b"# hello"

    listed = store.list_documents()
    assert [item["id"] for item in listed] == [entry["id"]]


def test_list_is_newest_first(store):
    first = store.add_document("a.md", b"a")
    second = store.add_document("b.pdf", b"%PDF-1.4")

    assert [item["id"] for item in store.list_documents()] == [
        second["id"],
        first["id"],
    ]


def test_duplicate_titles_get_a_suffix(store):
    first = store.add_document("作品集.pdf", b"1")
    second = store.add_document("作品集.pdf", b"2")

    assert first["title"] == "作品集"
    assert second["title"] == "作品集 (1)"


def test_duplicate_titles_still_resolve_at_the_length_limit(store):
    name = "长" * store.MAX_TITLE + ".md"
    first = store.add_document(name, b"1")
    second = store.add_document(name, b"2")

    assert first["title"] == "长" * store.MAX_TITLE
    assert second["title"].endswith(" (1)")
    assert len(second["title"]) <= store.MAX_TITLE


def test_rejects_unsupported_and_empty_files(store):
    with pytest.raises(ValueError):
        store.add_document("notes.txt", b"x")
    with pytest.raises(ValueError):
        store.add_document("empty.md", b"")


def test_rejects_files_over_the_limit(store, monkeypatch):
    monkeypatch.setattr(store, "MAX_BYTES", 4)
    with pytest.raises(ValueError):
        store.add_document("big.pdf", b"%PDF-1.4")


def test_rename_only_changes_the_title(store):
    entry = store.add_document("旧名字.md", b"x")

    renamed = store.rename_document(entry["id"], "新名字")
    assert renamed["title"] == "新名字"
    assert renamed["filename"] == "旧名字.md"
    assert (store.documents_dir() / f"{entry['id']}.md").is_file()

    with pytest.raises(ValueError):
        store.rename_document(entry["id"], "   ")


def test_delete_removes_entry_and_file(store):
    entry = store.add_document("x.md", b"x")
    path = store.documents_dir() / f"{entry['id']}.md"

    store.delete_document(entry["id"])

    assert store.list_documents() == []
    assert not path.exists()
    with pytest.raises(KeyError):
        store.get_document(entry["id"])


def test_migrate_copies_index_and_files(store, tmp_path):
    entry = store.add_document("x.md", b"x")
    target = tmp_path / "new"

    assert store.migrate_to(tmp_path, target) is True

    index = json.loads((target / store.DOCUMENTS_FILENAME).read_text("utf-8"))
    assert [item["id"] for item in index["documents"]] == [entry["id"]]
    assert (target / store.FILES_DIRNAME / f"{entry['id']}.md").is_file()
    # 旧目录保留，不清空。
    assert (tmp_path / store.DOCUMENTS_FILENAME).is_file()


def test_migrate_refuses_when_target_already_has_an_index(store, tmp_path):
    store.add_document("x.md", b"x")
    target = tmp_path / "new"
    target.mkdir()
    (target / store.DOCUMENTS_FILENAME).write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError):
        store.migrate_to(tmp_path, target)


def test_migrate_is_a_noop_without_an_index(store, tmp_path):
    assert store.migrate_to(tmp_path, tmp_path / "new") is False


def test_malformed_entries_are_dropped(store, tmp_path):
    store.index_path().write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "documents": [
                    {"id": "../../etc/passwd", "ext": "pdf"},
                    {"id": "0123456789abcdef0123456789abcdef", "ext": "exe"},
                ],
            }
        ),
        encoding="utf-8",
    )

    assert store.list_documents() == []
