"""本地访问边界：回环 Host、同源 Origin、/api 令牌。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.security as security


def build_client():
    app = FastAPI()

    @app.get("/api/ping")
    async def ping():
        return {"ok": True}

    @app.post("/api/offer")
    async def offer():
        return {"ok": True}

    @app.get("/hello")
    async def hello():
        return {"ok": True}

    security.install(app)
    return TestClient(app)


LOOPBACK = {"host": "127.0.0.1:7860"}
TOKEN = {security.TOKEN_HEADER: security.APP_TOKEN}


def test_api_requires_token_from_loopback():
    client = build_client()
    assert client.get("/api/ping", headers=LOOPBACK).status_code == 403
    assert client.get("/api/ping", headers={**LOOPBACK, **TOKEN}).json() == {"ok": True}
    assert client.post("/api/offer", headers=LOOPBACK).status_code == 200


def test_non_loopback_host_is_rejected():
    client = build_client()
    response = client.get(
        "/api/ping",
        headers={"host": "evil.example:7860", **TOKEN},
    )
    assert response.status_code == 403


def test_cross_origin_request_is_rejected_even_with_token():
    client = build_client()
    response = client.get(
        "/api/ping",
        headers={**LOOPBACK, **TOKEN, "origin": "http://evil.example:7860"},
    )
    assert response.status_code == 403


def test_same_origin_request_is_allowed():
    client = build_client()
    response = client.get(
        "/api/ping",
        headers={**LOOPBACK, **TOKEN, "origin": "http://127.0.0.1:7860"},
    )
    assert response.status_code == 200


def test_userinfo_url_cannot_pass_origin_check():
    assert not security.origin_allowed(
        "http://127.0.0.1:7860@evil.example/", "127.0.0.1:7860"
    )
    assert security.origin_allowed("http://127.0.0.1:7860", "127.0.0.1:7860")


def test_runner_argv_gets_exact_origins():
    argv = security.argv_with_allowed_origins(
        ["server.py", "--host", "127.0.0.1", "--port", "8123"]
    )
    assert "--allowed-origins" in argv
    assert "http://127.0.0.1:8123" in argv
    assert "http://localhost:8123" in argv


def test_runner_argv_keeps_existing_whitelist():
    argv = ["server.py", "--allowed-origins", "http://example.com"]
    assert security.argv_with_allowed_origins(argv) == argv


def test_token_is_injected_into_html():
    html = "<html><head><title>x</title></head><body></body></html>"
    injected = security.inject_token(html)
    assert f'name="{security.TOKEN_META_NAME}"' in injected
    assert security.APP_TOKEN in injected
