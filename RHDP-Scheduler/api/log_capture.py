"""Per-run log file capture for deploy and QA runs."""

import logging
import os
from datetime import datetime, timezone

_PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")
DEFAULT_LOG_DIR = os.path.join(_PROJECT_ROOT, "logs")


def get_log_dir():
    d = os.environ.get("RHDP_LOG_DIR", DEFAULT_LOG_DIR)
    os.makedirs(d, exist_ok=True)
    return d


def start_log_capture(prefix, suffix=""):
    """Attach a FileHandler to the rhdp_flow logger and return (handler, filepath)."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    parts = [prefix, ts] + ([suffix] if suffix else [])
    filepath = os.path.join(get_log_dir(), "_".join(parts) + ".log")
    handler = logging.FileHandler(filepath, encoding="utf-8")
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logging.getLogger("rhdp_flow").addHandler(handler)
    return handler, filepath


def stop_log_capture(handler):
    """Remove the handler from the rhdp_flow logger and close it."""
    logging.getLogger("rhdp_flow").removeHandler(handler)
    handler.close()
