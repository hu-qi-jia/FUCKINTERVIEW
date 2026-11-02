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
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "desktop", "resources", "backend")
VENV_SITE = os.path.join(ROOT, ".venv", "Lib", "site-packages")

# 运行时用不到的重包（含 dist-info）直接从打包结果里剔掉。
# Pillow 保留：fastembed 的 common/types.py 在模块顶层 import 它。
DROP = (
    "kubernetes",
    "chromadb",
    "chromadb_rust_bindings",
    "numba",
    "llvmlite",
    "grpc",
    "pythonwin",
    "pywin32",
    "win32",
    "win32com",
    "win32comext",
    "hf_xet",
    "resampy",
    "cv2",
    "opencv",
    "opencv_python",
    "pip",
    "pygments",
    "pytest",
    "_pytest",
    "pluggy",
    "iniconfig",
    "rich",
    "rich_toolkit",
    "markdown_it_py",
    "markdown-it-py",
    "mdurl",
    "pipecat_context_hub",
    "pipecat_ai_context_hub",
    # 本项目始终自带前端产物；官方预置 UI 只有在 dist 缺失时才用，打包时不需要。
    "pipecat_ai_prebuilt",
)

# site-packages 里各包的测试目录，运行时不用。
PRUNE_DIR_NAMES = {"tests", "test"}
# 只在训练 / 开发工具里用到的子包。
PRUNE_PATHS = (
    "onnxruntime/transformers",
    "onnxruntime/quantization",
    "onnxruntime/tools",
    "onnxruntime/datasets",
    "onnxruntime/backend",
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


def prune_site_packages(target):
    """便携 Python 自带的 site-packages 里也有 pip 等重包，一起剔掉。"""
    if not os.path.isdir(target):
        return
    for name in os.listdir(target):
        if not should_skip(name) or name == "__pycache__":
            continue
        path = os.path.join(target, name)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            try:
                os.unlink(path)
            except OSError:
                pass
    for root, dirnames, _filenames in os.walk(target, topdown=True):
        for name in list(dirnames):
            if name in PRUNE_DIR_NAMES:
                shutil.rmtree(os.path.join(root, name), ignore_errors=True)
                dirnames.remove(name)
    for relative in PRUNE_PATHS:
        shutil.rmtree(os.path.join(target, *relative.split("/")), ignore_errors=True)


def build_frontend() -> None:
    """始终先构建前端，避免旧 dist 被静默打进安装包。"""
    npm = "npm.cmd" if os.name == "nt" else "npm"
    print("0/4 构建前端 …")
    subprocess.run([npm, "--prefix", "web/client", "run", "build"], cwd=ROOT, check=True)
    index = os.path.join(ROOT, "web", "client", "dist", "index.html")
    if not os.path.isfile(index):
        raise SystemExit(f"前端构建完成但找不到 {index}")


def compile_bytecode() -> None:
    """安装包自带 .pyc，首次启动不用现场编译上千个文件。"""
    py = os.path.join(
        OUT, "python", "python.exe" if os.name == "nt" else "python3"
    )
    print("5/5 预编译字节码 …")
    subprocess.run(
        [
            py,
            "-m",
            "compileall",
            "-q",
            "-j",
            "0",
            os.path.join(OUT, "python", "Lib"),
            os.path.join(OUT, "app"),
            os.path.join(OUT, "server.py"),
        ],
        check=True,
    )


def main():
    skip_frontend = "--skip-frontend" in sys.argv[1:]
    python_home = find_python_home()
    if not os.path.isdir(python_home):
        raise SystemExit(f"便携 Python 不存在：{python_home}")

    if not skip_frontend:
        build_frontend()

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)

    print("1/5 复制便携 Python …")
    shutil.copytree(
        python_home,
        os.path.join(OUT, "python"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    print("2/5 复制依赖 …")
    site = os.path.join(OUT, "python", "Lib", "site-packages")
    os.makedirs(site, exist_ok=True)
    copy_site_packages(site)
    prune_site_packages(site)

    print("3/5 装入精简版 pipecat …")
    target = os.path.join(site, "pipecat")
    if os.path.isdir(target):
        shutil.rmtree(target)
    shutil.copytree(
        os.path.join(ROOT, "pipecat", "src", "pipecat"),
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    print("4/5 复制源码与前端 …")
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

    compile_bytecode()

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
