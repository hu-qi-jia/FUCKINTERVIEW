"""向量模型不可用时的降级与失败缓存。"""

from __future__ import annotations

import sys
import types

import pytest

import app.qa_index as qa_index


@pytest.fixture()
def model_state(tmp_path, monkeypatch):
    monkeypatch.setattr(qa_index, "model_name", lambda: "fake/model")
    monkeypatch.setattr(qa_index, "model_dir", lambda: tmp_path)
    monkeypatch.setattr(qa_index, "_model", None)
    monkeypatch.setattr(qa_index, "_model_name", None)
    monkeypatch.setattr(qa_index, "_model_error", None)
    monkeypatch.setattr(qa_index, "_model_failed_at", 0.0)
    yield
    monkeypatch.setattr(qa_index, "_model", None)
    monkeypatch.setattr(qa_index, "_model_name", None)
    qa_index.reset_model_failure()


def test_model_failure_is_remembered(model_state, monkeypatch):
    calls = {"count": 0}

    class BrokenTextEmbedding:
        def __init__(self, *args, **kwargs):
            calls["count"] += 1
            raise OSError("download failed")

    fake = types.ModuleType("fastembed")
    fake.TextEmbedding = BrokenTextEmbedding
    monkeypatch.setitem(sys.modules, "fastembed", fake)

    with pytest.raises(RuntimeError):
        qa_index.get_model()
    with pytest.raises(RuntimeError):
        qa_index.get_model()

    # 第二次直接命中错误缓存，不再走 fastembed 的 39 秒退避。
    assert calls["count"] == 1


def test_search_degrades_to_keywords_when_vector_fails(monkeypatch):
    def broken_vector(*args, **kwargs):
        raise RuntimeError("模型不可用")

    monkeypatch.setattr(qa_index, "_vector_hits", broken_vector)
    monkeypatch.setattr(
        qa_index, "_keyword_hits", lambda text, top: [{"qa_id": 1, "score": 0.0}]
    )
    monkeypatch.setattr(
        qa_index.store,
        "load_qa_many",
        lambda ids: {
            1: {
                "id": 1,
                "question": "问题",
                "answer": "答案",
                "type": "general",
                "profile_id": None,
                "enabled": True,
            }
        },
    )

    result = qa_index.search("问题")
    assert result["vectorAvailable"] is False
    assert result["mode"] == "keyword"
    assert result["vectorError"]
    assert [item["id"] for item in result["results"]] == [1]
