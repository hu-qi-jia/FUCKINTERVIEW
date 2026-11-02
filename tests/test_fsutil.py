"""文件写入在 AppData 这类不支持 rename 的目录上也要成功。"""

from __future__ import annotations

import os

import pytest

from app.fsutil import atomic_replace


def test_atomic_replace_falls_back_when_rename_is_unsupported(tmp_path, monkeypatch):
    source = tmp_path / "source.tmp"
    target = tmp_path / "target.json"
    source.write_text("hello", encoding="utf-8")

    def broken_replace(*_args, **_kwargs):
        raise OSError(17, "not same device")

    monkeypatch.setattr(os, "replace", broken_replace)
    atomic_replace(source, target)

    assert target.read_text(encoding="utf-8") == "hello"
    assert not source.exists()


def test_atomic_replace_reraises_other_errors(tmp_path, monkeypatch):
    source = tmp_path / "source.tmp"
    target = tmp_path / "target.json"
    source.write_text("hello", encoding="utf-8")

    def denied(*_args, **_kwargs):
        raise OSError(5, "access denied")

    monkeypatch.setattr(os, "replace", denied)
    with pytest.raises(OSError):
        atomic_replace(source, target)
    assert source.exists()
