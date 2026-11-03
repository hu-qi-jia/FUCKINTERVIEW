"""发布前自检：这个安装包能不能给别的用户直接用。

检查三件事：

1. 包里的 build-info.json 对应当前 HEAD，且工作区干净；
2. 包里没有开发者的配置、档案、数据库或 `.env`；
3. 用一个全新的空数据目录启动后端，确认页面、接口和默认配置都正常。

用法：npm --prefix desktop run dist && npm --prefix desktop run release-check
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "desktop" / "resources" / "backend"
PYTHON = OUT / "python" / ("python.exe" if os.name == "nt" else "python3")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"ok: {message}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def git(*args: str) -> str | None:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=ROOT, text=True, encoding="utf-8"
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def request(url: str, *, token: str | None = None, method: str = "GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if token:
        headers["X-App-Token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8")


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> None:
    print(f"release check: {OUT}")
    check(OUT.is_dir(), "desktop/resources/backend 存在，先跑 npm run dist")
    check(PYTHON.is_file(), "便携 Python 存在")
    check((OUT / "server.py").is_file(), "server.py 存在")
    check((OUT / "web" / "client" / "dist" / "index.html").is_file(), "前端产物存在")
    check((OUT / "app" / "security.py").is_file(), "后端业务代码存在")

    info_path = OUT / "build-info.json"
    check(info_path.is_file(), "build-info.json 存在（用 npm run dist 重新打包）")
    info = json.loads(info_path.read_text(encoding="utf-8"))
    head = git("rev-parse", "HEAD")
    if head:
        check(
            info.get("commit") == head,
            f"构建 commit 与当前 HEAD 一致（{str(head)[:12]}）",
        )
    check(not info.get("dirty"), "构建时工作区干净（dirty=false）")

    # 安装包必须只带代码，不能带开发者的数据。
    check(not (OUT / "config").exists(), "没有携带 config/ 开发数据")
    for name in ("settings.json", "profiles.json", "documents.json"):
        check(not (OUT / name).exists(), f"没有携带 {name}")
    for name in ("qa.db", "terms.db", "sessions.db"):
        check(not (OUT / name).exists(), f"没有携带 {name}")
    check(not list(OUT.glob("*.db*")), "没有携带根目录数据库")
    check(not list(OUT.rglob(".env")), "没有携带 .env")

    port = free_port()
    with tempfile.TemporaryDirectory(prefix="interview-release-check-") as temp:
        env = {
            **os.environ,
            "INTERVIEW_DATA_DIR": temp,
            "INTERVIEW_CHANNEL": "production",
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        popen_kwargs = {"creationflags": creationflags} if os.name == "nt" else {}
        process = subprocess.Popen(
            [
                str(PYTHON),
                "-u",
                str(OUT / "server.py"),
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--transport",
                "webrtc",
            ],
            cwd=str(OUT),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **popen_kwargs,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.time() + 90
            ready = False
            while time.time() < deadline:
                if process.poll() is not None:
                    fail("后端进程提前退出")
                try:
                    status, _ = request(f"{base}/status")
                    if status == 200:
                        ready = True
                        break
                except Exception:
                    pass
                time.sleep(0.3)
            check(ready, "空数据目录下后端能启动并返回 /status")

            status, html = request(f"{base}/client/")
            check(status == 200 and "<div id=\"root\">" in html, "/client/ 能正常返回")
            match = re.search(r'name="app-token" content="([^"]+)"', html)
            check(bool(match), "页面注入了本地访问令牌")
            token = match.group(1) if match else ""

            status, _ = request(f"{base}/api/settings")
            check(status == 403, "无令牌读取 /api/settings 被拒绝")

            status, body = request(f"{base}/api/settings", token=token)
            check(status == 200, "带令牌读取 /api/settings 正常")
            settings = json.loads(body)
            for section in ("asr", "llm", "tts"):
                check(
                    not str(settings.get(section, {}).get("api_key") or "").strip(),
                    f"新用户默认 {section} Key 为空（需要自己配置）",
                )

            status, body = request(f"{base}/api/profiles", token=token)
            check(status == 200 and json.loads(body).get("profiles") == [], "新用户档案为空")

            status, _ = request(
                f"{base}/api/settings",
                token=token,
                method="POST",
                body={"llm": {"api_key": "release-check-test"}},
            )
            check(status == 200, "新用户能保存设置")
            check(Path(temp, "settings.json").is_file(), "设置写进临时数据目录，不写安装目录")
        finally:
            stop_process(process)

    print("PASS: 安装包可以给新用户直接使用")


if __name__ == "__main__":
    main()
