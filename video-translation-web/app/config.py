"""Environment-driven configuration for the video-translation web service.

Everything is read from environment variables so the same image runs anywhere
(Render / Railway / Fly / a local `uvicorn`). Copy `.env.example` to `.env`
for local dev.
"""

import os


def _bool(name, default=False):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    # --- speech-to-text (OpenAI-compatible /audio/transcriptions) ---
    # Works with OpenAI (whisper-1) or Groq (whisper-large-v3) by pointing the
    # base URL + model at the provider and supplying its key.
    STT_BASE_URL = os.environ.get("STT_BASE_URL", "https://api.openai.com/v1")
    STT_MODEL = os.environ.get("STT_MODEL", "whisper-1")
    STT_API_KEY = os.environ.get("STT_API_KEY") or os.environ.get("OPENAI_API_KEY", "")

    # --- translation LLM ---
    # provider: "anthropic" (default when ANTHROPIC_API_KEY is set) or "openai".
    LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "").strip().lower()
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
    # OpenAI-compatible chat fallback for translation.
    LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    LLM_API_KEY = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY", "")

    TARGET_LANGUAGE = os.environ.get("TARGET_LANGUAGE", "Hungarian")

    # --- text-to-speech (ElevenLabs) ---
    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
    # Default preset voice: "George" (male, british) — sounded properly Hungarian
    # on the reference job. Override with any ElevenLabs voice id.
    ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    ELEVENLABS_STABILITY = float(os.environ.get("ELEVENLABS_STABILITY", "0.5"))
    ELEVENLABS_SIMILARITY = float(os.environ.get("ELEVENLABS_SIMILARITY", "0.75"))

    # --- ffmpeg ---
    FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
    FFPROBE = os.environ.get("FFPROBE", "ffprobe")

    # --- assembly (flow placement) ---
    MIN_GAP = float(os.environ.get("MIN_GAP", "0.12"))
    LEAD = float(os.environ.get("LEAD", "0.8"))
    AUDIO_BITRATE = os.environ.get("AUDIO_BITRATE", "192k")

    # --- service ---
    JOBS_DIR = os.environ.get("JOBS_DIR", "jobs")
    MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "300"))
    JOB_RETENTION_HOURS = int(os.environ.get("JOB_RETENTION_HOURS", "6"))
    WORKER_COUNT = int(os.environ.get("WORKER_COUNT", "1"))

    def llm_provider(self):
        if self.LLM_PROVIDER:
            return self.LLM_PROVIDER
        return "anthropic" if self.ANTHROPIC_API_KEY else "openai"


settings = Settings()
