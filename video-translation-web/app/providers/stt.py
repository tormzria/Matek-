"""Speech-to-text via an OpenAI-compatible /audio/transcriptions endpoint.

Works with OpenAI (whisper-1) or Groq (whisper-large-v3) — same request shape,
just a different base URL + model + key (see config). Returns timestamped
segments: [{start, end, text}].
"""

import httpx

from ..config import settings


def transcribe(audio_path, language=None):
    """Transcribe an audio file, returning [{start, end, text}, ...].

    `language` is an optional ISO-639-1 source code (e.g. "zh"); None = auto.
    """
    if not settings.STT_API_KEY:
        raise RuntimeError("STT_API_KEY (or OPENAI_API_KEY) is not set")

    url = settings.STT_BASE_URL.rstrip("/") + "/audio/transcriptions"
    data = {
        "model": settings.STT_MODEL,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "segment",
    }
    if language:
        data["language"] = language

    with open(audio_path, "rb") as fh:
        files = {"file": ("audio.wav", fh, "audio/wav")}
        with httpx.Client(timeout=600) as client:
            resp = client.post(
                url,
                headers={"Authorization": "Bearer " + settings.STT_API_KEY},
                data=data,
                files=files,
            )
    resp.raise_for_status()
    payload = resp.json()

    segments = []
    for i, seg in enumerate(payload.get("segments", [])):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        segments.append({
            "start": round(float(seg["start"]), 3),
            "end": round(float(seg["end"]), 3),
            "text": text,
        })

    # Fallback: some providers only return a flat transcript with no segments.
    if not segments and payload.get("text"):
        segments.append({"start": 0.0, "end": float(payload.get("duration", 0) or 0),
                         "text": payload["text"].strip()})
    return segments
