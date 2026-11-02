"""本地服务的访问边界。

FastAPI 只绑定 127.0.0.1 并不等于「只有本应用能访问」：浏览器里任何网页
都可以向本机端口发请求。这里加两道门：

1. 只接受回环主机，且带 ``Origin`` 时它的 host:port 必须和 ``Host`` 完全一致
   （挡住恶意网页、DNS rebinding 和其他本地端口上的页面）；
2. 所有 ``/api/*`` 读写接口都要求本次启动随机生成的令牌。令牌通过服务端
   渲染 ``/client/`` 时注入的 meta 标签交给前端，随后每个 fetch 自动带上。
   跨源页面拿不到这份 HTML，也就拿不到令牌。

``/start``、``/sessions/.../api/offer`` 是 Pipecat SDK 自己发的请求，SDK
不会加自定义头，所以它们靠第一道门和 CORS 白名单保护。
"""

from __future__ import annotations

import hmac
import os
import secrets
import sys
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

APP_TOKEN = secrets.token_urlsafe(32)
TOKEN_HEADER = "x-app-token"
TOKEN_META_NAME = "app-token"

LOOPBACK_HOSTNAMES = {"127.0.0.1", "localhost", "::1"}
# 这些路径由 Pipecat SDK 直接请求，没有自定义头，改用 Origin/Host 校验。
TOKEN_EXEMPT_PATHS = {"/api/offer"}

_installed_for: set[int] = set()


def _hostname(value: str) -> str:
    host = (value or "").strip().lower()
    if host.startswith("[") and "]" in host:
        host = host[1 : host.index("]")]
    return host


def _port(value: str) -> int | None:
    try:
        return value.port or (443 if value.scheme == "https" else 80)
    except ValueError:
        return None


def origin_allowed(origin: str, host_header: str) -> bool:
    """``Origin`` 必须是「和本次请求同一个回环 host:port」。"""
    try:
        source = urlsplit(origin)
        host = urlsplit(f"//{host_header}")
    except ValueError:
        return False
    if source.scheme not in ("http", "https"):
        return False
    source_host = _hostname(source.hostname or "")
    request_host = _hostname(host.hostname or "")
    if source_host not in LOOPBACK_HOSTNAMES or request_host not in LOOPBACK_HOSTNAMES:
        return False
    return source_host == request_host and _port(source) == _port(host)


def request_host_allowed(host_header: str) -> bool:
    try:
        host = urlsplit(f"//{host_header}")
    except ValueError:
        return False
    return _hostname(host.hostname or "") in LOOPBACK_HOSTNAMES


def _token_of(request: Request) -> str:
    token = request.headers.get(TOKEN_HEADER, "").strip()
    if token:
        return token
    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def install(app) -> None:
    """给 FastAPI app 装上访问边界；重复 import 只装一次。"""
    marker = id(app)
    if marker in _installed_for:
        return
    _installed_for.add(marker)

    @app.middleware("http")
    async def local_access_guard(request: Request, call_next):
        # CORS 预检不带自定义头，交给 CORSMiddleware 处理。
        if request.method == "OPTIONS":
            return await call_next(request)

        host = request.headers.get("host", "")
        if not request_host_allowed(host):
            return JSONResponse(
                status_code=403, content={"detail": "只允许通过本机回环地址访问"}
            )

        origin = request.headers.get("origin", "")
        if origin and not origin_allowed(origin, host):
            return JSONResponse(
                status_code=403, content={"detail": "不接受这个来源的跨域请求"}
            )

        path = request.url.path
        if path.startswith("/api/") and path not in TOKEN_EXEMPT_PATHS:
            supplied = _token_of(request)
            # compare_digest 只收 ASCII；非 ASCII 头直接当成不匹配。
            valid = False
            if supplied:
                try:
                    valid = hmac.compare_digest(
                        supplied.encode("ascii"), APP_TOKEN.encode("ascii")
                    )
                except UnicodeEncodeError:
                    valid = False
            if not valid:
                return JSONResponse(
                    status_code=403, content={"detail": "缺少或错误的本地访问令牌"}
                )

        return await call_next(request)


def inject_token(html: str) -> str:
    """把本次启动的令牌写进页面，前端从这里读。"""
    tag = f'<meta name="{TOKEN_META_NAME}" content="{APP_TOKEN}" />'
    lower = html.lower()
    head_end = lower.find("</head>")
    if head_end == -1:
        return tag + html
    return html[:head_end] + tag + html[head_end:]


def argv_with_allowed_origins(argv: list[str], port: int | None = None) -> list[str]:
    """给 Pipecat runner 的 CORS 一份精确白名单，替代默认的 ``*``。

    端口从命令行里读（Electron 会传动态端口），没传时用 7860。
    """
    if "--allowed-origins" in argv or os.environ.get("PIPECAT_ALLOWED_ORIGINS", "").strip():
        return argv
    resolved = port
    if resolved is None:
        for index, item in enumerate(argv):
            if item in ("--port", "-p") and index + 1 < len(argv):
                try:
                    resolved = int(argv[index + 1])
                except ValueError:
                    resolved = None
            elif item.startswith("--port="):
                try:
                    resolved = int(item.split("=", 1)[1])
                except ValueError:
                    resolved = None
    resolved = resolved or 7860
    return [
        *argv,
        "--allowed-origins",
        f"http://127.0.0.1:{resolved}",
        f"http://localhost:{resolved}",
    ]


def prepare_runner_argv() -> None:
    """在 runner 解析参数之前把白名单塞进 sys.argv。"""
    # 浏览器开发端要避开安装版的 7860 时，用 INTERVIEW_PORT 指定端口。
    if "--port" not in sys.argv and "-p" not in sys.argv:
        port = os.environ.get("INTERVIEW_PORT", "").strip()
        if port:
            sys.argv += ["--port", port]
    sys.argv[:] = argv_with_allowed_origins(sys.argv)
