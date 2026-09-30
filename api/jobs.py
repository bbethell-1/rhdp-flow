"""In-memory background job manager for long-running operations."""

from __future__ import annotations

import asyncio
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

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
    results: list[Any] | None = None
    error: str | None = None
    log_path: str | None = None
    created_at: float = field(default_factory=time.time)
    _events: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)
    _cancel_requested: bool = field(default=False, repr=False)
    _pause_event: asyncio.Event = field(default_factory=lambda: _make_set_event(), repr=False)
    # Event loop the job's async task + SSE queue live on. Captured at creation
    # (create_job runs inside the request handler, i.e. on the loop). Progress
    # updates arrive from worker threads (asyncio.to_thread), so queue writes
    # must be marshalled back onto this loop — touching an asyncio.Queue from
    # another thread races the loop's ready-queue and can wedge it.
    _loop: asyncio.AbstractEventLoop | None = field(default=None, repr=False)


MAX_JOBS = int(os.environ.get("RHDP_MAX_JOBS", "100"))
_jobs: dict[str, Job] = {}
_jobs_truncated: int = 0
_jobs_lock = threading.Lock()

# TODO: Basic persistent storage option
# Set RHDP_JOBS_PERSIST=file to enable file-backed storage
# Set RHDP_JOBS_PERSIST=sqlite to enable SQLite-backed storage
_persistence_mode = os.environ.get("RHDP_JOBS_PERSIST", "memory").lower()


def _cleanup_old_jobs() -> None:
    """Remove oldest terminal jobs when store exceeds MAX_JOBS."""
    global _jobs_truncated
    with _jobs_lock:
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
    # Bind the job to the loop it is created on so worker-thread progress updates
    # can be marshalled back safely. create_job is called from the async request
    # handler, so a loop is normally running here.
    try:
        job._loop = asyncio.get_running_loop()
    except RuntimeError:
        job._loop = None
    with _jobs_lock:
        _jobs[job_id] = job
    return job


def _put_nowait_safe(queue: asyncio.Queue, data: dict) -> None:
    """put_nowait that drops the event if the queue is full (SSE lag)."""
    try:
        queue.put_nowait(data)
    except asyncio.QueueFull:
        pass


def _pause_event_op(job: Job, op: str) -> None:
    """Set/clear a job's ``_pause_event`` from any thread, safely.

    ``request_cancel``/``request_pause``/``request_resume`` are called from the
    *sync* deploy control endpoints, which FastAPI runs in its threadpool — off
    the loop. ``asyncio.Event.set()`` wakes waiters via the non-threadsafe
    ``loop.call_soon`` (a paused deploy parks in ``wait_if_paused``), so calling
    it off-loop can lose the wakeup and wedge the loop. Marshal onto the job's
    loop, mirroring :func:`_emit_event`.
    """
    fn = job._pause_event.set if op == "set" else job._pause_event.clear
    loop = job._loop
    if loop is None or loop.is_closed():
        fn()
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        fn()
    else:
        try:
            loop.call_soon_threadsafe(fn)
        except RuntimeError:
            pass


def _emit_event(job: Job, data: dict) -> None:
    """Push an SSE event onto the job's queue, thread-safely.

    ``update_job`` is called both from the event loop (endpoints) and from
    worker threads (``asyncio.to_thread`` deploy/QA runs). ``asyncio.Queue`` is
    not thread-safe, and its ``put_nowait`` wakes waiting getters via
    ``loop.call_soon`` — calling that off-loop corrupts the loop's ready queue
    and can silently wedge the loop (a completed ``to_thread`` never resumes its
    awaiting coroutine). Marshal off-thread writes back with
    ``call_soon_threadsafe``; write directly when already on the loop.
    """
    loop = job._loop
    if loop is None or loop.is_closed():
        # No bound loop (e.g. a unit test calling update_job directly).
        _put_nowait_safe(job._events, data)
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        _put_nowait_safe(job._events, data)
    else:
        try:
            loop.call_soon_threadsafe(_put_nowait_safe, job._events, data)
        except RuntimeError:
            # Loop stopped/closed between the check and the call — nothing to
            # notify.
            pass


def get_job(job_id: str) -> Job | None:
    """Return job by id, or None."""
    with _jobs_lock:
        return _jobs.get(job_id)


def get_stats() -> dict:
    """Return job store statistics including truncation info."""
    with _jobs_lock:
        return {
            "total": len(_jobs),
            "max": MAX_JOBS,
            "truncated": _jobs_truncated,
        }


def request_cancel(job_id: str) -> bool:
    """Request cancellation of a running job. Returns True if the job was found and running."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.status not in (Status.pending, Status.running, Status.paused):
            return False
        job._cancel_requested = True
        _pause_event_op(job, "set")  # unpause if paused so loop can exit
        return True


def request_pause(job_id: str) -> bool:
    """Request pause of a running job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.status != Status.running:
            return False
        _pause_event_op(job, "clear")
        job.status = Status.paused
        _emit_event(job, _job_to_dict(job))
        return True


def request_resume(job_id: str) -> bool:
    """Resume a paused job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.status != Status.paused:
            return False
        _pause_event_op(job, "set")
        job.status = Status.running
        _emit_event(job, _job_to_dict(job))
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
    status: Status | None = None,
    progress: int | None = None,
    message: str | None = None,
    results: list[Any] | None = None,
    error: str | None = None,
    log_path: str | None = None,
) -> Job | None:
    """Update fields on an existing job. Pushes an SSE event."""
    with _jobs_lock:
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
        data = _job_to_dict(job)
    # Push event for SSE listeners (non-blocking, thread-safe). Done outside the
    # _jobs_lock so a slow cross-thread hop never holds the store lock.
    _emit_event(job, data)
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
        except TimeoutError:
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
