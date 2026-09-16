"""Tests for the API-key gate (api/server.py ApiKeyGateMiddleware).

The gate requires X-API-Key on ALL /api endpoints except the health probe.
It fails closed: with no RHDP_API_KEY and no RHDP_ALLOW_UNAUTHENTICATED opt-out,
the API returns 503. The middleware reads env per-request, so tests toggle it
with monkeypatch without reloading the module.
"""
from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def test_get_requires_key_when_key_set(monkeypatch):
    monkeypatch.setenv("RHDP_API_KEY", "secret123")
    # A read endpoint is gated when a key is configured.
    assert client.get("/api/schedules").status_code == 403
    assert client.get("/api/schedules", headers={"X-API-Key": "nope"}).status_code == 403
    assert client.get("/api/schedules", headers={"X-API-Key": "secret123"}).status_code == 200


def test_health_is_exempt_when_key_set(monkeypatch):
    monkeypatch.setenv("RHDP_API_KEY", "secret123")
    # Health probe must stay reachable unauthenticated for k8s liveness/readiness.
    assert client.get("/api/health").status_code != 403
    assert client.get("/api/v1/health").status_code != 403


def test_fail_closed_when_no_key_and_no_optout(monkeypatch):
    monkeypatch.delenv("RHDP_API_KEY", raising=False)
    monkeypatch.delenv("RHDP_ALLOW_UNAUTHENTICATED", raising=False)
    # No key + no opt-out => refuse to serve the API (503), but health stays up.
    assert client.get("/api/schedules").status_code == 503
    assert client.get("/api/health").status_code != 503


def test_optout_allows_keyless_local_dev(monkeypatch):
    monkeypatch.delenv("RHDP_API_KEY", raising=False)
    monkeypatch.setenv("RHDP_ALLOW_UNAUTHENTICATED", "true")
    # Explicit local-dev opt-out => keyless reads allowed.
    assert client.get("/api/schedules").status_code == 200


def test_empty_key_fails_closed_without_optout(monkeypatch):
    monkeypatch.setenv("RHDP_API_KEY", "")
    monkeypatch.delenv("RHDP_ALLOW_UNAUTHENTICATED", raising=False)
    # Empty string is treated as "unset" => fail closed (503) without opt-out.
    assert client.get("/api/schedules").status_code == 503
