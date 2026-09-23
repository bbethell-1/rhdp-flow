"""Retry helpers for flaky OpenShift API / oc CLI calls."""

from __future__ import annotations

import logging
import subprocess
import time
from typing import Any

logger = logging.getLogger(__name__)

_TRANSIENT_MARKERS = (
    "timeout",
    "timed out",
    "i/o timeout",
    "connection refused",
    "connection reset",
    "broken pipe",
    "temporary failure",
    "temporarily unavailable",
    "server is currently unable",
    "too many requests",
    "http 429",
    "http 503",
    "http 502",
    "etcdserver: leader changed",
    "raft: aborted",
    "unexpected eof",
    "tls handshake timeout",
    "dial tcp",
    "network is unreachable",
    "no route to host",
    "unable to connect to the server",
    "client.timeout exceeded",
    "context deadline exceeded",
    "http2: client connection lost",
    "transport is closing",
    "the connection to the server",
)


def is_transient_oc_failure(stderr: str = "", exc: BaseException | None = None) -> bool:
    """True when an oc failure is likely temporary (retryable)."""
    if isinstance(exc, subprocess.TimeoutExpired):
        return True
    text = stderr or ""
    if exc is not None:
        text = f"{text}\n{exc}"
    lower = text.lower()
    return any(marker in lower for marker in _TRANSIENT_MARKERS)


def run_oc_with_retries(
    cmd: list[str],
    *,
    config: Any,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run ``oc`` with retries/backoff on transient API errors.

    Uses ``config.retry_attempts`` (default 3) and ``config.retry_delay`` (default 5s),
    with linear backoff: delay, 2×delay, 3×delay, …
    Non-transient failures (AlreadyExists, Forbidden, etc.) return immediately.
    """
    attempts = max(1, int(getattr(config, "retry_attempts", 3) or 1))
    base_delay = float(getattr(config, "retry_delay", 5) or 5)
    to = timeout if timeout is not None else float(getattr(config, "timeout", 60) or 60)

    last: subprocess.CompletedProcess[str] | None = None
    for attempt in range(1, attempts + 1):
        try:
            last = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=to,
                env=env,
            )
            if last.returncode == 0:
                return last
            if not is_transient_oc_failure(last.stderr) or attempt >= attempts:
                return last
            delay = base_delay * attempt
            logger.warning(
                "oc transient failure (attempt %s/%s), retrying in %.0fs: %s",
                attempt,
                attempts,
                delay,
                (last.stderr or "").strip()[:300],
            )
            time.sleep(delay)
        except subprocess.TimeoutExpired:
            if attempt >= attempts:
                raise
            delay = base_delay * attempt
            logger.warning(
                "oc timed out after %.0fs (attempt %s/%s), retrying in %.0fs: %s",
                to,
                attempt,
                attempts,
                delay,
                " ".join(cmd[:4]),
            )
            time.sleep(delay)

    assert last is not None
    return last
