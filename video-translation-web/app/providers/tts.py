"""Text-to-speech via the ElevenLabs API (direct — no ComfyUI).

Synthesizes one clip per segment and writes it to disk. The multilingual model
auto-detects the target language from the text; voice choice matters most for
accent (see README).
"""

import httpx

from ..config import settings


def synth(text, out_path):
    """Synthesize `text` to `out_path` (mp3). Returns out_path."""
    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")

    url = "https://api.elevenlabs.io/v1/text-to-speech/%s" % settings.ELEVENLABS_VOICE_ID
    body = {
        "text": text,
        "model_id": settings.ELEVENLABS_MODEL,
        "voice_settings": {
            "stability": settings.ELEVENLABS_STABILITY,
            "similarity_boost": settings.ELEVENLABS_SIMILARITY,
        },
    }
    with httpx.Client(timeout=300) as client:
        resp = client.post(
            url,
            params={"output_format": "mp3_44100_192"},
            headers={"xi-api-key": settings.ELEVENLABS_API_KEY,
                     "accept": "audio/mpeg"},
            json=body,
        )
    resp.raise_for_status()
    with open(out_path, "wb") as fh:
        fh.write(resp.content)
    return out_path
