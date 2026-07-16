"""In-process job store + background worker(s).

MVP-grade: jobs live in a dict + on disk under JOBS_DIR/<id>/, and a small pool
of daemon threads pulls from a queue. This is deliberately simple — swap in
Redis + RQ/Celery when you need multiple instances or durability across restarts.
"""

import json
import os
import queue
import shutil
import threading
import time
import uuid

from .config import settings
from . import pipeline

_jobs = {}
_lock = threading.Lock()
_queue = queue.Queue()


def _job_dir(job_id):
    return os.path.join(settings.JOBS_DIR, job_id)


def _write_state(job):
    try:
        with open(os.path.join(_job_dir(job["id"]), "state.json"), "w") as fh:
            json.dump(job, fh)
    except OSError:
        pass


def _set(job_id, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        _write_state(job)


def create_job(video_bytes, filename, source_language):
    job_id = uuid.uuid4().hex[:12]
    d = _job_dir(job_id)
    os.makedirs(d, exist_ok=True)

    ext = os.path.splitext(filename)[1] or ".mp4"
    video_path = os.path.join(d, "input" + ext)
    with open(video_path, "wb") as fh:
        fh.write(video_bytes)

    job = {
        "id": job_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "error": None,
        "created_at": time.time(),
        "source_language": source_language,
        "video_path": video_path,
        "outputs": {},
    }
    with _lock:
        _jobs[job_id] = job
        _write_state(job)
    _queue.put(job_id)
    return job_id


def get_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def output_path(job_id, kind):
    job = get_job(job_id)
    if not job:
        return None
    return job.get("outputs", {}).get(kind)


def _run(job_id):
    job = get_job(job_id)
    if not job:
        return
    _set(job_id, status="processing", stage="starting")

    def progress(stage, pct):
        _set(job_id, stage=stage, progress=pct)

    try:
        out_mp4, out_srt = pipeline.process(
            _job_dir(job_id), job["video_path"], job["source_language"], progress)
        _set(job_id, status="done", stage="done", progress=100,
             outputs={"video": out_mp4, "srt": out_srt})
    except Exception as exc:  # surface a readable message to the UI
        _set(job_id, status="error", stage="error", error=str(exc))


def _worker():
    while True:
        job_id = _queue.get()
        try:
            _run(job_id)
        finally:
            _queue.task_done()


def _reaper():
    """Delete job dirs older than the retention window."""
    while True:
        time.sleep(1800)
        cutoff = time.time() - settings.JOB_RETENTION_HOURS * 3600
        with _lock:
            stale = [jid for jid, j in _jobs.items() if j["created_at"] < cutoff]
        for jid in stale:
            shutil.rmtree(_job_dir(jid), ignore_errors=True)
            with _lock:
                _jobs.pop(jid, None)


def start_workers():
    os.makedirs(settings.JOBS_DIR, exist_ok=True)
    for _ in range(max(1, settings.WORKER_COUNT)):
        threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=_reaper, daemon=True).start()
