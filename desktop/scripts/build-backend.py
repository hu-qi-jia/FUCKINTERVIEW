"""把后端打成可随桌面端分发的目录：便携 Python + 运行所需依赖 + 源码 + 前端产物。

产出：desktop/resources/backend/
    python/              便携 CPython（含 Lib/site-packages）
    server.py            后端入口
    app/                 业务代码
    web/client/dist/     前端构建产物

用法：python desktop/scripts/build-backend.py
"""

import os
import shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "desktop", "resources", "backend")
VENV_SITE = os.path.join(ROOT, ".venv", "Lib", "site-packages")

# 运行时用不到的重包（含 dist-info）直接从打包结果里剔掉
DROP = (
    "kubernetes",
    "chromadb",
    "chromadb_rust_bindings",
    "numba",
    "llvmlite",
    "grpc",
    "pythonwin",
    "hf_xet",
    "resampy",
)


def find_python_home() -> str:
    cfg = os.path.join(ROOT, ".venv", "pyvenv.cfg")
    with open(cfg, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("home ="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("找不到 .venv/pyvenv.cfg 里的 home")


def should_skip(name: str) -> bool:
    low = name.lower()
    if low == "__pycache__":
        return True
    if low.startswith("__editable__") and "pipecat" in low:
        return True
    return any(
        low == drop or low.startswith(drop + "-") or low.startswith(drop + ".")
        for drop in DROP
    )


def copy_site_packages(target):
    os.makedirs(target, exist_ok=True)
    for name in os.listdir(VENV_SITE):
        if should_skip(name):
            continue
        src = os.path.join(VENV_SITE, name)
        dst = os.path.join(target, name)
        if os.path.isdir(src):
            shutil.copytree(
                src,
                dst,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
                dirs_exist_ok=True,
            )
        else:
            shutil.copy2(src, dst)


def main():
    python_home = find_python_home()
    if not os.path.isdir(python_home):
        raise SystemExit(f"便携 Python 不存在：{python_home}")

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)

    print("1/4 复制便携 Python …")
    shutil.copytree(
        python_home,
        os.path.join(OUT, "python"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    print("2/4 复制依赖 …")
    site = os.path.join(OUT, "python", "Lib", "site-packages")
    os.makedirs(site, exist_ok=True)
    copy_site_packages(site)

    print("3/4 装入精简版 pipecat …")
    target = os.path.join(site, "pipecat")
    if os.path.isdir(target):
        shutil.rmtree(target)
    shutil.copytree(
        os.path.join(ROOT, "pipecat", "src", "pipecat"),
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    print("4/4 复制源码与前端 …")
    shutil.copy2(os.path.join(ROOT, "server.py"), os.path.join(OUT, "server.py"))
    shutil.copytree(
        os.path.join(ROOT, "app"),
        os.path.join(OUT, "app"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    shutil.copytree(
        os.path.join(ROOT, "web", "client", "dist"),
        os.path.join(OUT, "web", "client", "dist"),
    )

    total = 0
    for dirpath, _dirnames, filenames in os.walk(OUT):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass
    print(f"完成：{OUT}（{total / 1024 / 1024:.0f} MB）")


if __name__ == "__main__":
    main()
