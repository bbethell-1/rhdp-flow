"""FastAPI application factory for RHDP-Flow Web UI."""

from __future__ import annotations

import logging
import os
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# Ensure parent dir is on path for rhdp_flow imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.routes import router

logger = logging.getLogger("rhdp_flow.api")

app = FastAPI(
    title="RHDP-Flow API",
    description="Web API for Red Hat Demo Platform Workshop Automation",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Rate limiting via SlowAPI
# ---------------------------------------------------------------------------
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded

    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
except ImportError:
    limiter = None  # type: ignore[assignment]
    logger.warning("slowapi not installed — rate limiting disabled")

# ---------------------------------------------------------------------------
# CORS — configurable via CORS_ORIGINS env var
# ---------------------------------------------------------------------------
_cors_origins_env = os.environ.get("CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] if _cors_origins_env else [
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# CSP headers middleware
# ---------------------------------------------------------------------------
class CSPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response: Response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "font-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response


app.add_middleware(CSPMiddleware)

# ---------------------------------------------------------------------------
# API routes — available at /api (primary) and /api/v1 (versioned alias)
# ---------------------------------------------------------------------------
app.include_router(router, prefix="/api")
app.include_router(router, prefix="/api/v1", tags=["v1"])


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
_shutting_down = False


@app.on_event("shutdown")
async def _on_shutdown():
    global _shutting_down
    _shutting_down = True
    logger.info("RHDP-Flow API shutting down gracefully")


def is_shutting_down() -> bool:
    return _shutting_down


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------

@app.exception_handler(FileNotFoundError)
async def file_not_found_handler(request: Request, exc: FileNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Static files — serve frontend/dist/ (React build) or web/ (legacy) at root
# ---------------------------------------------------------------------------

_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
_web_dir = os.path.join(os.path.dirname(__file__), "..", "web")
_static_dir = _frontend_dist if os.path.isdir(_frontend_dist) else _web_dir
logger.info(f"Static files: {os.path.abspath(_static_dir)}")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
