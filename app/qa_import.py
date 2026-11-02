"""问答库的导入与预览。

支持三种文件：``.xlsx`` / ``.csv``（固定列名，顺序无关）和 ``.md``（固定层级语法）。
导入分两步：先解析出**预览**（新增 / 更新 / 跳过 / 疑似重复），确认后才写库。
预览阶段就把「疑似重复」算出来，因为用户要看着这个结果决定导不导。
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import time
import unicodedata
import uuid
from typing import Any

from app import qa as store
from app import qa_index

PREVIEW_TTL = 1800
MAX_ROWS = 5000
NEAR_DUPLICATE = 0.95

_TYPE_ALIASES = {
    "通用": "general",
    "general": "general",
    "行为": "behavioral",
    "行为面": "behavioral",
    "行为面试": "behavioral",
    "behavioral": "behavioral",
    "知识": "knowledge",
    "原理": "knowledge",
    "知识原理": "knowledge",
    "knowledge": "knowledge",
    "项目": "project",
    "项目技术": "project",
    "project": "project",
}

_HEADER_ALIASES = {
    "问题": "question",
    "题目": "question",
    "question": "question",
    "答案": "answer",
    "回答": "answer",
    "answer": "answer",
    "别名": "aliases",
    "同义问法": "aliases",
    "aliases": "aliases",
    "类型": "type",
    "type": "type",
    "熟练度": "proficiency",
    "proficiency": "proficiency",
}

_previews: dict[str, dict[str, Any]] = {}


class ImportError_(ValueError):
    pass


# --------------------------------------------------------------------------
# 解析
# --------------------------------------------------------------------------
def _norm_header(value: Any) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().lower()


def _split(value: Any) -> list[str]:
    if value is None:
        return []
    return [item.strip() for item in re.split(r"[|;,、\n]", str(value)) if item.strip()]


def _clean_type(raw: Any) -> str:
    text = unicodedata.normalize("NFKC", str(raw or "")).strip().lower()
    return _TYPE_ALIASES.get(text, "general")


def _proficiency(raw: Any) -> int:
    try:
        return max(1, min(5, int(float(str(raw).strip()))))
    except (TypeError, ValueError):
        return 3


def _row(question: Any, answer: Any, aliases: Any, type_: Any, proficiency: Any) -> dict[str, Any]:
    return {
        "question": str(question or "").strip(),
        "answer": str(answer or "").strip(),
        "aliases": _split(aliases),
        "type": _clean_type(type_),
        "proficiency": _proficiency(proficiency),
    }


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_csv(raw: bytes) -> list[dict[str, Any]]:
    text = _decode(raw)
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = list(reader)
    if not rows:
        return []

    header = [_norm_header(cell) for cell in rows[0]]
    mapping: dict[str, int] = {}
    for index, name in enumerate(header):
        field = _HEADER_ALIASES.get(name)
        if field and field not in mapping:
            mapping[field] = index
    if "question" not in mapping:
        raise ImportError_("表头里找不到「问题」列。请先下载模板，按模板的列名填写。")

    result = []
    for line_number, cells in enumerate(rows[1:], start=2):
        def cell(field: str) -> Any:
            index = mapping.get(field)
            return cells[index] if index is not None and index < len(cells) else None

        question = cell("question")
        answer = cell("answer")
        if not str(question or "").strip() and not str(answer or "").strip():
            continue  # 空行
        result.append(
            {
                **_row(
                    question,
                    answer,
                    cell("aliases"),
                    cell("type"),
                    cell("proficiency"),
                ),
                "line": line_number,
            }
        )
        if len(result) >= MAX_ROWS:
            break
    return result


def parse_xlsx(raw: bytes) -> list[dict[str, Any]]:
    try:
        from openpyxl import load_workbook
    except ImportError as error:  # pragma: no cover - 依赖缺失时给出可执行的提示
        raise ImportError_("缺少 openpyxl，无法读取 Excel。请换用 CSV 或 MD。") from error

    try:
        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as error:
        raise ImportError_(f"无法读取这个 Excel 文件：{error}") from error

    try:
        sheet = workbook.active
        iterator = sheet.iter_rows(values_only=True)
        header_row = next(iterator, None)
        if header_row is None:
            return []

        header = [_norm_header(cell) for cell in header_row]
        mapping: dict[str, int] = {}
        for index, name in enumerate(header):
            field = _HEADER_ALIASES.get(name)
            if field and field not in mapping:
                mapping[field] = index
        if "question" not in mapping:
            raise ImportError_("表头里找不到「问题」列。请先下载模板，按模板的列名填写。")

        result = []
        for line_number, cells in enumerate(iterator, start=2):
            def cell(field: str) -> Any:
                index = mapping.get(field)
                return cells[index] if index is not None and index < len(cells) else None

            question = cell("question")
            answer = cell("answer")
            if not str(question or "").strip() and not str(answer or "").strip():
                continue
            result.append(
                {
                    **_row(
                        question,
                        answer,
                        cell("aliases"),
                        cell("type"),
                        cell("proficiency"),
                    ),
                    "line": line_number,
                }
            )
            if len(result) >= MAX_ROWS:
                break
        return result
    finally:
        workbook.close()


_META_KEYS = {
    "别名": "aliases",
    "同义问法": "aliases",
    "aliases": "aliases",
    "熟练度": "proficiency",
    "proficiency": "proficiency",
    "类型": "type",
    "type": "type",
}


def parse_markdown(raw: bytes) -> list[dict[str, Any]]:
    """``##`` 主问题、紧跟标题的 ``> 键: 值`` 是元数据，其余是答案。

    ``#`` 一级标题如果写的是类型名（通用 / 行为面 / 知识 / 项目技术），
    它下面的问题都归到这一类型；写别的一律忽略。
    """
    text = _decode(raw).replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    group_type = ""
    current: dict[str, Any] | None = None
    body: list[str] = []
    meta_done = True
    questions: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current, body
        if current is None:
            return
        answer_text = "\n".join(body).strip()
        questions.append(
            {
                **_row(
                    current["question"],
                    answer_text,
                    current.get("aliases"),
                    current.get("type") or group_type,
                    current.get("proficiency"),
                ),
                "line": current["line"],
            }
        )
        current = None
        body = []

    for index, raw_line in enumerate(lines, start=1):
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("## "):
            flush()
            current = {"question": stripped[3:].strip(), "line": index}
            meta_done = False
            continue
        if stripped.startswith("# "):
            flush()
            group_type = _TYPE_ALIASES.get(_norm_header(stripped[2:]), "")
            continue

        if current is None:
            continue  # 标题之前的内容忽略

        if not meta_done:
            if not stripped:
                continue
            if stripped.startswith(">"):
                match = re.match(r"^>\s*([^:：]+)[:：]\s*(.*)$", stripped)
                if match:
                    key = _META_KEYS.get(_norm_header(match.group(1)))
                    if key:
                        current[key] = match.group(2).strip()
                        continue
            meta_done = True

        body.append(line)

    flush()
    return [item for item in questions if item["question"] or item["answer"]]


def parse_file(raw: bytes, filename: str) -> tuple[list[dict[str, Any]], str]:
    name = (filename or "").lower()
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        return parse_xlsx(raw), "xlsx"
    if name.endswith(".csv"):
        return parse_csv(raw), "csv"
    if name.endswith(".md") or name.endswith(".markdown"):
        return parse_markdown(raw), "md"
    raise ImportError_("只支持 .xlsx、.csv 和 .md 文件。")


# --------------------------------------------------------------------------
# 预览
# --------------------------------------------------------------------------
def preview(raw: bytes, filename: str) -> dict[str, Any]:
    if len(raw) > 20 * 1024 * 1024:
        raise ImportError_("文件超过 20MB，请拆分后再导入。")

    rows, format_ = parse_file(raw, filename)
    if not rows:
        raise ImportError_("文件里没有读到任何问答，请检查表头或标题格式。")

    file_hash = hashlib.sha256(raw).hexdigest()
    previous = store.find_import_by_hash(file_hash)

    errors: list[dict[str, Any]] = []
    valid: list[dict[str, Any]] = []
    for row in rows:
        if not row["question"]:
            errors.append({"line": row.get("line"), "message": "问题为空", "question": row["answer"][:40]})
            continue
        if not row["answer"]:
            errors.append({"line": row.get("line"), "message": "答案为空", "question": row["question"][:40]})
            continue
        row["questionKey"] = store.normalize_question(row["question"])
        valid.append(row)

    # 与库里已有条目比对；同一文件里先出现的行也参与判重，
    # 否则两行归一化后相同的问题都会被当成「新增」。
    seen_in_file: dict[str, dict[str, Any]] = {}
    for row in valid:
        key = row["questionKey"]
        first = seen_in_file.get(key)
        if first is not None:
            row["duplicateOfLine"] = first.get("line")
            same = _same_content(first, row)
            row["decision"] = "skip" if same else "update"
            row["existingQuestion"] = first["question"]
            if not same and first.get("existingId"):
                # 先出现的行更新了库里的记录，这一行也更新同一条。
                row["existingId"] = first.get("existingId")
            continue

        existing = store.find_by_key(key)
        if not existing:
            row["decision"] = "insert"
        else:
            target = existing[0]
            same = _same_content(target, row)
            row["decision"] = "skip" if same else "update"
            row["existingId"] = target["id"]
            row["existingQuestion"] = target["question"]
        seen_in_file[key] = row

    # 疑似重复：问法不同但语义很近。模型不可用时跳过这一项，不阻断导入。
    near_duplicates = 0
    near_duplicate_error: str | None = None
    candidates = [row for row in valid if row["decision"] == "insert"]
    if candidates:
        try:
            _flag_near_duplicates(candidates)
            near_duplicates = sum(1 for row in candidates if row.get("nearDuplicateOf"))
        except Exception as error:
            near_duplicate_error = str(error)

    token = uuid.uuid4().hex
    _prune_previews()
    _previews[token] = {
        "source": filename,
        "format": format_,
        "fileHash": file_hash,
        "createdAt": time.time(),
        "rows": valid,
        "errors": errors,
        "previousImport": previous,
    }

    counts = {"insert": 0, "update": 0, "skip": 0}
    for row in valid:
        counts[row["decision"]] += 1

    return {
        "token": token,
        "source": filename,
        "format": format_,
        "counts": {**counts, "error": len(errors), "nearDuplicate": near_duplicates},
        "previousImportAt": previous["created_at"] if previous else None,
        "nearDuplicateError": near_duplicate_error,
        "items": [_public_row(row) for row in valid[:500]],
        "errors": errors[:200],
        "truncated": len(valid) > 500,
    }


def _same_content(left: dict[str, Any], right: dict[str, Any]) -> bool:
    # 问题按归一化后比较：只差标点 / 大小写 / 空白视为同一条。
    return (
        store.normalize_question(left["question"]) == store.normalize_question(right["question"])
        and left["answer"] == right["answer"]
        and left["aliases"] == right["aliases"]
        and left["type"] == right["type"]
        and left["proficiency"] == right["proficiency"]
    )


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "line": row.get("line"),
        "question": row["question"],
        "answerPreview": row["answer"][:120],
        "aliases": row["aliases"],
        "type": row["type"],
        "proficiency": row["proficiency"],
        "decision": row["decision"],
        "existingId": row.get("existingId"),
        "duplicateOfLine": row.get("duplicateOfLine"),
        "nearDuplicateOf": row.get("nearDuplicateOf"),
        "nearDuplicateScore": row.get("nearDuplicateScore"),
    }


def _flag_near_duplicates(rows: list[dict[str, Any]]) -> None:
    snapshot = qa_index._get_snapshot()
    matrix = snapshot["mat"]
    if matrix.size == 0:
        return
    vectors = qa_index.embed([row["question"] for row in rows])
    if vectors.shape[1] != matrix.shape[1]:
        return
    scores = vectors @ matrix.T
    best = scores.argmax(axis=1)
    for index, row in enumerate(rows):
        score = float(scores[index][best[index]])
        if score >= NEAR_DUPLICATE:
            meta = snapshot["rows"][int(best[index])]
            row["nearDuplicateOf"] = int(meta["qa_id"])
            row["nearDuplicateScore"] = round(score, 4)


def _prune_previews() -> None:
    now = time.time()
    for token in [t for t, p in _previews.items() if now - p["createdAt"] > PREVIEW_TTL]:
        _previews.pop(token, None)


# --------------------------------------------------------------------------
# 确认导入
# --------------------------------------------------------------------------
def commit(token: str, mode: str = "merge") -> dict[str, Any]:
    entry = _previews.get(token)
    if entry is None:
        raise ImportError_("预览已过期，请重新选择文件。")

    rows = entry["rows"]
    inserted: list[int] = []
    updated: list[int] = []
    skipped = 0
    # 本批里「源行号 -> 已写入的 qa id」：文件内部重复的行要落在同一条记录上。
    line_ids: dict[int, int] = {}

    import_id = store.record_import(
        entry["source"], entry["format"], entry["fileHash"], 0, 0, 0
    )

    for row in rows:
        fields = {
            "question": row["question"],
            "answer": row["answer"],
            "aliases": row["aliases"],
            "type": row["type"],
            "proficiency": row["proficiency"],
            "source": "import",
            "import_id": import_id,
            "source_ref": f"{entry['source']}#{row.get('line')}",
        }

        # 「追加」保持既有语义：文件里有多少行就建多少条。
        if mode == "append":
            created = store.create_qa(fields)
            inserted.append(created["id"])
            if row.get("line") is not None:
                line_ids[int(row["line"])] = created["id"]
            continue

        key = row.get("questionKey") or store.normalize_question(row["question"])
        target_id: int | None = None
        duplicate_line = row.get("duplicateOfLine")
        if duplicate_line is not None:
            target_id = line_ids.get(int(duplicate_line))

        # 提交时重新判重：预览之后数据库可能已被其他窗口或另一批导入改动。
        if target_id is None:
            existing = store.find_by_key(key)
            if existing:
                current = existing[0]
                if _same_content(current, row):
                    skipped += 1
                    if row.get("line") is not None:
                        line_ids[int(row["line"])] = current["id"]
                    continue
                target_id = current["id"]

        if target_id is not None:
            current = store.get_qa(int(target_id))
            if current is not None and _same_content(current, row):
                skipped += 1
                if row.get("line") is not None:
                    line_ids[int(row["line"])] = int(target_id)
                continue
            try:
                store.update_qa(int(target_id), fields)
                updated.append(int(target_id))
                if row.get("line") is not None:
                    line_ids[int(row["line"])] = int(target_id)
                continue
            except (KeyError, ValueError):
                # 记录在预览和提交之间被删了：退回新增。
                pass

        created = store.create_qa(fields)
        inserted.append(created["id"])
        if row.get("line") is not None:
            line_ids[int(row["line"])] = created["id"]

    _update_import_counts(import_id, len(inserted), len(updated), skipped)
    _previews.pop(token, None)
    qa_index.enqueue_many([*inserted, *updated])

    return {
        "importId": import_id,
        "inserted": len(inserted),
        "updated": len(updated),
        "skipped": skipped,
    }


def _update_import_counts(import_id: int, inserted: int, updated: int, skipped: int) -> None:
    with store._lock:
        conn = store.connect()
        try:
            conn.execute(
                "UPDATE imports SET inserted = ?, updated = ?, skipped = ? WHERE id = ?",
                (inserted, updated, skipped, import_id),
            )
        finally:
            conn.close()
