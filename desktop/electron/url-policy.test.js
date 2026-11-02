"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createUrlPolicy, safeExternalUrl } = require("./url-policy");

const LOADING = "data:text/html;charset=utf-8,loading";
const policy = createUrlPolicy(LOADING);
policy.setAppOrigin("http://127.0.0.1:7860/client/");

test("exact app origin is allowed", () => {
  assert.equal(policy.isAppUrl("http://127.0.0.1:7860/client/"), true);
  assert.equal(policy.isAppUrl("http://127.0.0.1:7860/client/?x=1"), true);
  assert.equal(policy.isAppOrigin("http://127.0.0.1:7860"), true);
});

test("userinfo cannot smuggle another host", () => {
  const url = "http://127.0.0.1:7860@evil.example/";
  assert.equal(policy.isAppUrl(url), false);
  assert.equal(policy.isAppOrigin("http://127.0.0.1:7860@evil.example"), false);
});

test("other ports, hosts and schemes are rejected", () => {
  assert.equal(policy.isAppUrl("http://127.0.0.1:7861/client/"), false);
  assert.equal(policy.isAppUrl("http://localhost:7860/client/"), false);
  assert.equal(policy.isAppUrl("https://127.0.0.1:7860/client/"), false);
  assert.equal(policy.isAppUrl("http://127.0.0.1:7860.evil.example/"), false);
  assert.equal(policy.isAppUrl("http://sub.127.0.0.1:7860/"), false);
});

test("data: is only allowed for the initial loading page", () => {
  assert.equal(policy.isAppUrl(LOADING), true);
  assert.equal(policy.isAppUrl("data:text/html,evil"), false);
});

test("before the backend is ready nothing is trusted", () => {
  const fresh = createUrlPolicy(LOADING);
  assert.equal(fresh.isAppUrl("http://127.0.0.1:7860/client/"), false);
  assert.equal(fresh.isAppOrigin("http://127.0.0.1:7860"), false);
});

test("external links are limited to http/https", () => {
  assert.equal(safeExternalUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeExternalUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(safeExternalUrl("file:///C:/Windows/System32/calc.exe"), null);
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("not a url"), null);
});
