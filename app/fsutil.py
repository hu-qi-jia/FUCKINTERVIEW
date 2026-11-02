"""文件系统小工具。

Windows 上有些目录（例如被重定向或由云盘接管的 ``%APPDATA%``）不支持
rename：``os.replace`` 会在同一个目录里报 ``WinError 17``（不是同一个磁盘）。
临时文件 + 原子替换仍然优先，失败时退化为「复制后删除」，保证设置、档案
和迁移结果能真正落盘。
"""

from __future__ import annotations

import errno
import os
import shutil
from pathlib import Path

_EXDEV = {errno.EXDEV, 17}  # 17 = WinError 17 / ERROR_NOT_SAME_DEVICE


def atomic_replace(source: str | Path, target: str | Path) -> None:
    """把 source 放到 target；优先原子替换，文件系统不支持时退化为复制。"""
    source = str(source)
    target = str(target)
    try:
        os.replace(source, target)
        return
    except OSError as error:
        winerror = getattr(error, "winerror", None)
        if winerror not in _EXDEV and error.errno not in _EXDEV:
            raise
    if os.path.exists(target):
        os.unlink(target)
    shutil.move(source, target)
