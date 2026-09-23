"""Inter-workshop pause for large Flow deploys (ease API / admission pressure)."""

from __future__ import annotations


def deploy_pace_seconds(batch_size: int, override: float | None = None) -> float:
    """Seconds to wait between workshops after each create.

    Explicit ``override`` wins (clamped to >= 0). Otherwise scale with batch size:
    - < 10 workshops → 1s (legacy default)
    - 10–24 → 3s
    - 25+ → 5s
    """
    if override is not None:
        return max(0.0, float(override))
    n = max(0, int(batch_size))
    if n >= 25:
        return 5.0
    if n >= 10:
        return 3.0
    return 1.0
