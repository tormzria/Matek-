"""FastAPI entrypoint: upload a video, poll status, download results."""

import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from . import jobs

app = FastAPI(title="Video → Voice-Over Translator")

_STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


@app.on_event("startup")
def _startup():
    jobs.start_workers()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm_provider": settings.llm_provider(),
        "target_language": settings.TARGET_LANGUAGE,
        "stt_configured": bool(settings.STT_API_KEY),
        "tts_configured": bool(settings.ELEVENLABS_API_KEY),
        "llm_configured": bool(settings.ANTHROPIC_API_KEY or settings.LLM_API_KEY),
    }


@app.post("/api/jobs")
async def create_job(video: UploadFile = File(...), source_language: str = Form("")):
    data = await video.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(413, "File exceeds %d MB limit." % settings.MAX_UPLOAD_MB)

    job_id = jobs.create_job(data, video.filename or "input.mp4", source_language.strip())
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return JSONResponse({
        "id": job["id"],
        "status": job["status"],
        "stage": job["stage"],
        "progress": job["progress"],
        "error": job["error"],
        "has_video": bool(job.get("outputs", {}).get("video")),
        "has_srt": bool(job.get("outputs", {}).get("srt")),
    })


@app.get("/api/jobs/{job_id}/download/{kind}")
def download(job_id: str, kind: str):
    if kind not in ("video", "srt"):
        raise HTTPException(400, "Unknown download kind.")
    path = jobs.output_path(job_id, kind)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "Output not ready.")
    filename = "translated.mp4" if kind == "video" else "translated.srt"
    media = "video/mp4" if kind == "video" else "application/x-subrip"
    return FileResponse(path, media_type=media, filename=filename)


# Serve the frontend last so /api routes take precedence.
app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
