# Video → Voice-Over Translator (web MVP)

Upload a video, get it back with a **translated voice-over** plus a matching
**`.srt`** — from a browser, no ComfyUI or GPU required. This is the cloud-API
version of the local [`../video-translation-pipeline`](../video-translation-pipeline):
same no-time-stretch flow-placement/mux/subtitle logic, but the transport is
direct cloud APIs so anyone can run it as a service.

```
Browser upload ─▶ FastAPI ─▶ background worker:
                              ffmpeg extract → Whisper API (STT) → LLM translate
                              → ElevenLabs (TTS) → flow-placement mux + srt
Browser ◀── download translated.mp4 + .srt ◀── job store ◀───────┘
```

## What you provide

Three cloud capabilities, via environment variables (see `.env.example`):

| Capability | Provider | Env |
|---|---|---|
| Speech-to-text | OpenAI `whisper-1` **or** Groq `whisper-large-v3` (same API shape) | `STT_BASE_URL`, `STT_MODEL`, `STT_API_KEY` |
| Translation | Claude `claude-opus-4-8` (default) **or** an OpenAI chat model | `ANTHROPIC_API_KEY` / `LLM_PROVIDER=openai` + `LLM_*` |
| Text-to-speech | ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |

`TARGET_LANGUAGE` (default `Hungarian`) sets the output language.

## Run locally

```bash
cp .env.example .env          # fill in your keys
pip install -r requirements.txt
# ffmpeg + ffprobe must be on PATH (brew install ffmpeg / apt install ffmpeg)
uvicorn app.main:app --reload
```

Open http://localhost:8000, drop a video, pick the source language, and wait for
the download links. `GET /api/health` shows which keys are configured.

## Deploy (Render / Railway / Fly)

The included `Dockerfile` bundles ffmpeg and serves on `$PORT`.

- **Render / Railway:** point at this directory, it builds the Dockerfile. Set
  the env vars from `.env.example` in the dashboard. Add a persistent disk
  mounted at `/data` if you want jobs to survive restarts (they're ephemeral
  otherwise, which is fine for an MVP).
- **Fly.io:** `fly launch` (detects the Dockerfile), `fly secrets set ...` for
  the keys, `fly deploy`.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/jobs` | multipart `video` + `source_language` → `{job_id}` |
| `GET` | `/api/jobs/{id}` | `{status, stage, progress, error, has_video, has_srt}` |
| `GET` | `/api/jobs/{id}/download/{video\|srt}` | the finished files |
| `GET` | `/api/health` | which capabilities are configured |

## Architecture notes & MVP limits

- **Jobs run in-process** — a small pool of daemon threads (`WORKER_COUNT`) pulls
  from an in-memory queue; state and files live under `JOBS_DIR/<id>/`. Simple
  and single-instance. For horizontal scale or restart-durability, swap the queue
  in `app/jobs.py` for Redis + RQ/Celery and move files to object storage (S3/R2).
- **No accounts / quotas / payment / moderation yet** — this is the "make it work"
  slice. Those are the next layer for a truly public deployment: auth, per-user
  rate limits, a billing hook, and upload scanning. Uploads are capped by
  `MAX_UPLOAD_MB` and job dirs are reaped after `JOB_RETENTION_HOURS`.
- **Cost is per use** — each job spends STT + LLM + ElevenLabs credits. Meter it
  before opening the doors wide.

## Files

| Path | Role |
|---|---|
| `app/main.py` | FastAPI routes + static frontend mount |
| `app/config.py` | env-driven settings |
| `app/jobs.py` | in-process job store + worker pool + reaper |
| `app/pipeline.py` | orchestrates the five stages with progress reporting |
| `app/placement.py` | flow placement, VO render, mux, srt (ported from the local pipeline) |
| `app/providers/stt.py` | Whisper-API transcription |
| `app/providers/translate.py` | Claude / OpenAI translation, JSON-schema constrained |
| `app/providers/tts.py` | ElevenLabs synthesis |
| `static/index.html` | upload → progress → download UI (vanilla, no build step) |
| `Dockerfile` | ffmpeg + app, serves on `$PORT` |
