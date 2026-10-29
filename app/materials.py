"""面试档案的本地存储。

档案是一个 JSON 文件（默认 config/profiles.json），里面是若干份面试档案：
名称、面试语言、简历（原文 + 整合稿）、岗位描述、经历卡。

写入走临时文件 + os.replace，读取失败时返回空存储而不是抛错——单机应用里
一个坏文件不应该让整个页面打不开。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import ROOT, load_settings, save_storage

SCHEMA_VERSION = 1
PROFILES_FILENAME = "profiles.json"
CARDS_MAX = 10
LANGUAGES = ("zh", "en")
CARD_BODY_KEYS = (
    "facts",
    "defense",
    "pushback",
    "boundaries",
    "depth",
    "nextQuestion",
)

_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# 文件读写
# --------------------------------------------------------------------------
def data_dir() -> Path:
    raw = str(load_settings().get("storage", {}).get("data_dir") or "config").strip()
    path = Path(raw or "config").expanduser()
    return path if path.is_absolute() else (ROOT / path)


def profiles_path() -> Path:
    return data_dir() / PROFILES_FILENAME


def _empty_store() -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "profiles": []}


def _read_store() -> dict[str, Any]:
    path = profiles_path()
    if not path.exists():
        return _empty_store()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_store()
    if not isinstance(data, dict) or not isinstance(data.get("profiles"), list):
        return _empty_store()
    data.setdefault("schemaVersion", SCHEMA_VERSION)
    return data


def _write_store(store: dict[str, Any]) -> None:
    path = profiles_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# --------------------------------------------------------------------------
# 形状
# --------------------------------------------------------------------------
def _new_material() -> dict[str, Any]:
    return {"original": "", "content": "", "updatedAt": None}


def _sanitize_coach_slots(raw: Any) -> dict[str, dict[str, dict[str, Any]]]:
    """教练补全清单：{卡 slug: {维度: {q: 问题, a: 回答, applied: 是否已写入卡片}}}。

    这份数据就是教练的全部状态：问题和回答都落在这里，不依赖任何对话历史。
    """
    if not isinstance(raw, dict):
        return {}
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for slug, dims in raw.items():
        card_slug = str(slug or "").strip()[:64]
        if not card_slug or not isinstance(dims, dict):
            continue
        slots: dict[str, dict[str, Any]] = {}
        for key, slot in dims.items():
            dimension = str(key or "").strip()[:20]
            if not dimension or not isinstance(slot, dict):
                continue
            slots[dimension] = {
                "q": str(slot.get("q") or "").strip()[:400],
                "a": str(slot.get("a") or "").strip()[:4000],
                "applied": bool(slot.get("applied")),
            }
            if len(slots) >= 8:
                break
        if slots:
            result[card_slug] = slots
    return result


def _new_profile(name: str) -> dict[str, Any]:
    now = _now()
    return {
        "id": uuid.uuid4().hex,
        "name": name.strip(),
        "language": "zh",
        "resume": _new_material(),
        "jobDescription": _new_material(),
        "cards": [],
        "coachSlots": {},
        "materialsRevision": 0,
        "createdAt": now,
        "updatedAt": now,
    }


def _sanitize_card(raw: Any, position: int) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    body = raw.get("body") if isinstance(raw.get("body"), dict) else {}
    status = raw.get("status")
    if status not in ("pending", "generating", "ready", "failed"):
        status = "ready"
    try:
        source_revision = int(raw.get("sourceRevision") or 0)
    except (TypeError, ValueError):
        source_revision = 0
    return {
        "slug": str(raw.get("slug") or f"card-{uuid.uuid4().hex[:8]}"),
        "name": str(raw.get("name") or ""),
        "description": str(raw.get("description") or ""),
        "body": {key: str(body.get(key) or "") for key in CARD_BODY_KEYS},
        "source": "manual" if raw.get("source") == "manual" else "ai",
        "status": status,
        "error": str(raw["error"]) if raw.get("error") else None,
        "sourceRevision": source_revision,
        "position": position,
        "createdAt": str(raw.get("createdAt") or _now()),
        "updatedAt": _now(),
    }


def _sanitize_cards(raw_cards: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_cards, list):
        return []
    cards = [_sanitize_card(raw, index) for index, raw in enumerate(raw_cards)]
    cards = cards[:CARDS_MAX]
    for index, card in enumerate(cards):
        card["position"] = index
    return cards


def _summary(profile: dict[str, Any]) -> dict[str, Any]:
    cards = profile.get("cards") or []
    return {
        "id": profile.get("id"),
        "name": profile.get("name") or "",
        "language": profile.get("language") or "zh",
        "updatedAt": profile.get("updatedAt"),
        "cardCount": len(cards),
        "readyCardCount": sum(1 for card in cards if card.get("status") == "ready"),
        "hasResume": bool(str(profile.get("resume", {}).get("content") or "").strip()),
        "hasJobDescription": bool(
            str(profile.get("jobDescription", {}).get("content") or "").strip()
        ),
        "materialsRevision": int(profile.get("materialsRevision") or 0),
    }


def _find(store: dict[str, Any], profile_id: str) -> dict[str, Any]:
    for profile in store["profiles"]:
        if profile.get("id") == profile_id:
            return profile
    raise KeyError(profile_id)


# --------------------------------------------------------------------------
# 接口
# --------------------------------------------------------------------------
def list_profiles() -> list[dict[str, Any]]:
    with _lock:
        profiles = [_summary(p) for p in _read_store()["profiles"]]
    profiles.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return profiles


def create_profile(name: str = "") -> dict[str, Any]:
    with _lock:
        store = _read_store()
        profile = _new_profile(name)
        store["profiles"].append(profile)
        _write_store(store)
        return profile


def get_profile(profile_id: str) -> dict[str, Any]:
    with _lock:
        return _find(_read_store(), profile_id)


def latest_profile() -> dict[str, Any] | None:
    """最近编辑过的一份档案；没有档案时返回 None。"""
    with _lock:
        profiles = _read_store()["profiles"]
    if not profiles:
        return None
    return max(profiles, key=lambda profile: str(profile.get("updatedAt") or ""))


def _apply_material(current: dict[str, Any], incoming: Any) -> tuple[dict[str, Any], bool]:
    incoming = incoming if isinstance(incoming, dict) else {}
    original = str(current.get("original") or "")
    content = str(current.get("content") or "")
    changed = False

    if isinstance(incoming.get("original"), str):
        original = incoming["original"]
    if isinstance(incoming.get("content"), str) and incoming["content"] != content:
        content = incoming["content"]
        changed = True

    result = {
        "original": original,
        "content": content,
        "updatedAt": current.get("updatedAt"),
    }
    if changed:
        result["updatedAt"] = _now()
    return result, changed


def update_profile(profile_id: str, patch: Any) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise ValueError("请求体必须是 JSON 对象")

    with _lock:
        store = _read_store()
        profile = _find(store, profile_id)

        if isinstance(patch.get("name"), str):
            profile["name"] = patch["name"].strip()

        if "language" in patch:
            language = str(patch.get("language") or "")
            if language not in LANGUAGES:
                raise ValueError(f"不支持的面试语言：{language}")
            profile["language"] = language

        bumped = False
        if "resume" in patch:
            profile["resume"], changed = _apply_material(profile["resume"], patch["resume"])
            bumped = bumped or changed
        if "jobDescription" in patch:
            profile["jobDescription"], changed = _apply_material(
                profile["jobDescription"], patch["jobDescription"]
            )
            bumped = bumped or changed
        if "cards" in patch:
            profile["cards"] = _sanitize_cards(patch["cards"])
            # 卡被删掉后，它的补全清单也一起清掉，别在文件里留孤儿数据。
            live = {str(card.get("slug")) for card in profile["cards"]}
            profile["coachSlots"] = {
                slug: slots
                for slug, slots in (profile.get("coachSlots") or {}).items()
                if slug in live
            }
        if "coachSlots" in patch:
            profile["coachSlots"] = _sanitize_coach_slots(patch["coachSlots"])

        if bumped:
            profile["materialsRevision"] = int(profile.get("materialsRevision") or 0) + 1

        profile["updatedAt"] = _now()
        _write_store(store)
        return profile


def delete_profile(profile_id: str) -> None:
    with _lock:
        store = _read_store()
        _find(store, profile_id)
        store["profiles"] = [
            profile for profile in store["profiles"] if profile.get("id") != profile_id
        ]
        _write_store(store)


def apply_plan(profile_id: str, units: list[dict[str, Any]]) -> dict[str, Any]:
    """用新的经历单元替换 AI 卡，手动新增的卡原样保留。"""
    with _lock:
        store = _read_store()
        profile = _find(store, profile_id)
        manual = [card for card in profile["cards"] if card.get("source") == "manual"]
        capacity = max(0, CARDS_MAX - len(manual))
        revision = int(profile.get("materialsRevision") or 0)

        cards = list(manual)
        for unit in units[:capacity]:
            cards.append(
                _sanitize_card(
                    {
                        "name": unit.get("name") or "",
                        "description": unit.get("description") or "",
                        "source": "ai",
                        "status": "pending",
                        "sourceRevision": revision,
                    },
                    len(cards),
                )
            )

        profile["cards"] = cards
        profile["updatedAt"] = _now()
        _write_store(store)
        return profile


def update_card(profile_id: str, slug: str, fields: dict[str, Any]) -> dict[str, Any]:
    """更新单张卡（生成结果写回）。"""
    with _lock:
        store = _read_store()
        profile = _find(store, profile_id)
        for index, card in enumerate(profile["cards"]):
            if card.get("slug") == slug:
                merged = dict(card)
                merged.update(fields)
                profile["cards"][index] = _sanitize_card(merged, index)
                profile["updatedAt"] = _now()
                _write_store(store)
                return profile["cards"][index]
    raise KeyError(slug)


def find_card(profile_id: str, slug: str) -> dict[str, Any]:
    profile = get_profile(profile_id)
    for card in profile["cards"]:
        if card.get("slug") == slug:
            return card
    raise KeyError(slug)


# --------------------------------------------------------------------------
# 存储位置
# --------------------------------------------------------------------------
def storage_info() -> dict[str, Any]:
    path = data_dir()
    return {
        "dataDir": str(path),
        "file": str(profiles_path()),
        "exists": path.is_dir(),
        "fileExists": profiles_path().is_file(),
    }


def resolve_dir(raw: str) -> Path:
    value = (raw or "").strip()
    if not value:
        raise ValueError("数据目录不能为空")
    path = Path(value).expanduser()
    return path if path.is_absolute() else (ROOT / path)


def set_data_dir(raw: str, *, migrate: bool = True) -> dict[str, Any]:
    """切换数据目录；默认把现有档案文件复制过去，旧文件保留备份。"""
    target = resolve_dir(raw)
    if target.exists() and not target.is_dir():
        raise ValueError(f"{target} 不是目录")

    with _lock:
        source = profiles_path()
        target_file = target / PROFILES_FILENAME
        if migrate and source.is_file() and target_file != source:
            if target_file.exists():
                raise ValueError(f"目标目录已存在 {PROFILES_FILENAME}，请先备份或换一个目录")
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target_file)
        else:
            target.mkdir(parents=True, exist_ok=True)

        save_storage(str(target))
        return storage_info()


def open_folder() -> None:
    target = data_dir()
    target.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(target))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])
