"""FastAPI application factory for RHDP-Flow Web UI."""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# Ensure parent dir is on path for rhdp_flow imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def configure_logging() -> None:
    """Set up structured JSON logging when LOG_FORMAT=json, otherwise human-readable."""
    log_format = os.environ.get("LOG_FORMAT", "").lower()
    if log_format == "json":
        try:
            from pythonjsonlogger.jsonlogger import JsonFormatter  # type: ignore

            handler = logging.StreamHandler()
            handler.setFormatter(JsonFormatter(
                "%(asctime)s %(name)s %(levelname)s %(message)s",
                rename_fields={"asctime": "timestamp", "levelname": "level"},
            ))
            logging.root.handlers = [handler]
            logging.root.setLevel(logging.INFO)
        except ImportError:
            logging.basicConfig(level=logging.INFO)
            logging.getLogger("rhdp_flow.api").warning(
                "python-json-logger not installed; falling back to text logging"
            )
    else:
        logging.basicConfig(level=logging.INFO)


configure_logging()

from api.routes import router

logger = logging.getLogger("rhdp_flow.api")

# Graceful shutdown state
_shutting_down = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    global _shutting_down
    _shutting_down = True
    logger.info("RHDP-Flow API shutting down gracefully")


app = FastAPI(
    title="RHDP-Flow API",
    description="Web API for Red Hat Demo Platform Workshop Automation. Authors: Josh Disraeli, Billy Bethell.",
    version="1.3.8",
    lifespan=lifespan,
)

# Auth startup check
if not os.environ.get("RHDP_API_KEY"):
    logger.warning("RHDP_API_KEY not set -- all mutation endpoints are unprotected")

# ---------------------------------------------------------------------------
# Rate limiting via SlowAPI (shared limiter from api.limiter)
# ---------------------------------------------------------------------------
from api.limiter import limiter as _limiter

if _limiter:
    app.state.limiter = _limiter
    try:
        from slowapi import _rate_limit_exceeded_handler
        from slowapi.errors import RateLimitExceeded

        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    except ImportError:
        pass
else:
    logger.warning("Rate limiting disabled (slowapi not available)")

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
            "connect-src 'self';"
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
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ---------------------------------------------------------------------------
# Static files — serve frontend/dist/ (React build) or web/ (legacy) at root
# ---------------------------------------------------------------------------

_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
_web_dir = os.path.join(os.path.dirname(__file__), "..", "web")
_static_dir = _frontend_dist if os.path.isdir(_frontend_dist) else _web_dir
logger.info(f"Static files: {os.path.abspath(_static_dir)}")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
