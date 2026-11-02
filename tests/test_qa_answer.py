"""实时面试的问答库直出：按相似度选最高分，遇到低分不能提前退出。"""

from __future__ import annotations

import asyncio

import server


def make_answer(threshold: float = 0.75) -> server.QaAnswer:
    return server.QaAnswer({"embedding": {"relevance_threshold": threshold}})


def test_lookup_skips_keyword_hit_and_picks_vector_hit(monkeypatch):
    result = {
        "results": [
            {"score": 0.0, "answer": "关键词命中的答案", "question": "关键词问题"},
            {"score": 0.96, "answer": "应直出的高相似度答案", "question": "向量问题"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) == "应直出的高相似度答案"


def test_lookup_falls_back_when_only_low_scores(monkeypatch):
    result = {
        "results": [
            {"score": 0.1, "answer": "低分答案", "question": "q1"},
            {"score": 0.2, "answer": "还是低分", "question": "q2"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) is None


def test_lookup_ignores_candidates_without_answer(monkeypatch):
    result = {
        "results": [
            {"score": 0.91, "answer": "  ", "question": "空答案"},
            {"score": 0.80, "answer": "可用答案", "question": "有答案"},
        ]
    }
    monkeypatch.setattr(server.qa_index, "search", lambda *args, **kwargs: result)

    assert asyncio.run(make_answer()._lookup("问题")) == "可用答案"
