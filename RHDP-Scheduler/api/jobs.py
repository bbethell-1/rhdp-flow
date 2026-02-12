"""In-memory background job manager for long-running operations."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from sse_starlette import ServerSentEvent


class Status(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


@dataclass
class Job:
    job_id: str
    status: Status = Status.pending
    progress: int = 0
    message: str = ""
    results: Optional[List[Any]] = None
    error: Optional[str] = None
    _events: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)


_jobs: Dict[str, Job] = {}


def create_job() -> Job:
    """Create a new pending job and return it."""
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id)
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    """Return job by id, or None."""
    return _jobs.get(job_id)


def update_job(
    job_id: str,
    *,
    status: Optional[Status] = None,
    progress: Optional[int] = None,
    message: Optional[str] = None,
    results: Optional[List[Any]] = None,
    error: Optional[str] = None,
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
    while job.status in (Status.pending, Status.running):
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
    }


def _serialize(job: Job) -> str:
    import json
    return json.dumps(_job_to_dict(job))


def _serialize_dict(d: dict) -> str:
    import json
    return json.dumps(d)
