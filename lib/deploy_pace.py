"""Inter-workshop pause for large Flow deploys (ease API / admission pressure)."""

from __future__ import annotations


def deploy_pace_seconds(batch_size: int, override: float | None = None) -> float:
    """Seconds to wait between workshops after each create.

    Explicit ``override`` wins (clamped to >= 0). Otherwise scale with batch size.

    Defaults are intentionally light — Flow only schedules Workshop /
    WorkshopProvision creates via the API; it does not wait for VMs to provision.
    Heavy pauses (3–5s) made Summit-sized batches feel like real deploys.

    Auto (when override is None):
    - < 10 workshops → 0s
    - 10–24 → 0.5s
    - 25+ → 1s
    """
    if override is not None:
        return max(0.0, float(override))
    n = max(0, int(batch_size))
    if n >= 25:
        return 1.0
    if n >= 10:
        return 0.5
    return 0.0
