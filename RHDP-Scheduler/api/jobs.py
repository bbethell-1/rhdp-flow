"""In-memory background job manager for long-running operations."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from sse_starlette import ServerSentEvent


def _make_set_event() -> asyncio.Event:
    e = asyncio.Event()
    e.set()
    return e


class Status(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    paused = "paused"


@dataclass
class Job:
    job_id: str
    status: Status = Status.pending
    progress: int = 0
    message: str = ""
    results: Optional[List[Any]] = None
    error: Optional[str] = None
    log_path: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    _events: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)
    _cancel_requested: bool = field(default=False, repr=False)
    _pause_event: asyncio.Event = field(default_factory=lambda: _make_set_event(), repr=False)


MAX_JOBS = int(os.environ.get("RHDP_MAX_JOBS", "100"))
_jobs: Dict[str, Job] = {}
_jobs_truncated: int = 0


def _cleanup_old_jobs() -> None:
    """Remove oldest terminal jobs when store exceeds MAX_JOBS."""
    global _jobs_truncated
    if len(_jobs) <= MAX_JOBS:
        return
    terminal = [(jid, j) for jid, j in _jobs.items()
                 if j.status in (Status.completed, Status.failed, Status.cancelled)]
    terminal.sort(key=lambda x: x[1].created_at)
    to_remove = len(_jobs) - MAX_JOBS
    for jid, _ in terminal[:to_remove]:
        del _jobs[jid]
        _jobs_truncated += 1


def create_job() -> Job:
    """Create a new pending job and return it."""
    _cleanup_old_jobs()
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id)
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    """Return job by id, or None."""
    return _jobs.get(job_id)


def get_stats() -> dict:
    """Return job store statistics including truncation info."""
    return {
        "total": len(_jobs),
        "max": MAX_JOBS,
        "truncated": _jobs_truncated,
    }


def request_cancel(job_id: str) -> bool:
    """Request cancellation of a running job. Returns True if the job was found and running."""
    job = _jobs.get(job_id)
    if job is None or job.status not in (Status.pending, Status.running, Status.paused):
        return False
    job._cancel_requested = True
    job._pause_event.set()  # unpause if paused so loop can exit
    return True


def request_pause(job_id: str) -> bool:
    """Request pause of a running job."""
    job = _jobs.get(job_id)
    if job is None or job.status != Status.running:
        return False
    job._pause_event.clear()
    job.status = Status.paused
    try:
        job._events.put_nowait(_job_to_dict(job))
    except asyncio.QueueFull:
        pass
    return True


def request_resume(job_id: str) -> bool:
    """Resume a paused job."""
    job = _jobs.get(job_id)
    if job is None or job.status != Status.paused:
        return False
    job._pause_event.set()
    job.status = Status.running
    try:
        job._events.put_nowait(_job_to_dict(job))
    except asyncio.QueueFull:
        pass
    return True


def is_cancel_requested(job_id: str) -> bool:
    """Check if cancel has been requested for this job."""
    job = _jobs.get(job_id)
    return job is not None and job._cancel_requested


async def wait_if_paused(job_id: str) -> None:
    """Block until the job is unpaused (or cancelled). Call between deploy steps."""
    job = _jobs.get(job_id)
    if job is None:
        return
    await job._pause_event.wait()


def update_job(
    job_id: str,
    *,
    status: Optional[Status] = None,
    progress: Optional[int] = None,
    message: Optional[str] = None,
    results: Optional[List[Any]] = None,
    error: Optional[str] = None,
    log_path: Optional[str] = None,
) -> Optional[Job]:
    """Update fields on an existing job. Pushes an SSE event."""
    job = _jobs.get(job_id)
    if job is None:
        return None
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = progress
    if message is not None:
        job.message = message
    if results is not None:
        job.results = results
    if error is not None:
        job.error = error
    if log_path is not None:
        job.log_path = log_path
    # Push event for SSE listeners (non-blocking)
    try:
        job._events.put_nowait(_job_to_dict(job))
    except asyncio.QueueFull:
        pass
    return job


async def event_generator(job_id: str):
    """Async generator yielding SSE events for a job."""
    from api.server import is_shutting_down

    job = _jobs.get(job_id)
    if job is None:
        yield ServerSentEvent(data='{"error": "job not found"}', event="error")
        return
    # Send current state immediately
    yield ServerSentEvent(data=_serialize(job), event="status")
    while job.status in (Status.pending, Status.running, Status.paused):
        if is_shutting_down():
            yield ServerSentEvent(data='{"message": "server shutting down"}', event="closing")
            return
        try:
            data = await asyncio.wait_for(job._events.get(), timeout=30)
            yield ServerSentEvent(data=_serialize_dict(data), event="status")
            if data.get("status") in (Status.completed.value, Status.failed.value):
                return
        except asyncio.TimeoutError:
            # Send keepalive
            yield ServerSentEvent(data="", event="keepalive")
    # Final state
    yield ServerSentEvent(data=_serialize(job), event="status")


def _job_to_dict(job: Job) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "log_file": os.path.basename(job.log_path) if job.log_path else None,
        "cancel_requested": job._cancel_requested,
    }


def _serialize(job: Job) -> str:
    import json
    return json.dumps(_job_to_dict(job))


def _serialize_dict(d: dict) -> str:
    import json
    return json.dumps(d)
