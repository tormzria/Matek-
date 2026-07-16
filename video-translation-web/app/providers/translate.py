"""Translate transcript segments into the target language, keeping timings.

Two providers, selected by config:
  - "anthropic" (default when ANTHROPIC_API_KEY is set): the official Anthropic
    SDK, model claude-opus-4-8, JSON-schema-constrained output.
  - "openai": an OpenAI-compatible /chat/completions endpoint.

Input/output are segment lists [{start, end, text}, ...]; only `text` changes.
Segments are translated in batches so the index-aligned array stays reliable.
"""

import json

import httpx

from ..config import settings

BATCH = 60

_SYSTEM = (
    "You are a professional subtitle translator. Translate each numbered source "
    "line into natural, idiomatic {lang}, preserving meaning and tone. Use proper "
    "{lang} accents and punctuation. Keep each translation roughly as short as the "
    "source so it fits the same on-screen time. If a source line is garbled or "
    "empty, return an empty string for it rather than inventing content. Return "
    "exactly one translation per input line, in order."
)

_SCHEMA = {
    "type": "object",
    "properties": {"translations": {"type": "array", "items": {"type": "string"}}},
    "required": ["translations"],
    "additionalProperties": False,
}


def _prompt(texts):
    lines = "\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(texts))
    return ("Translate these %d lines into %s. Return JSON "
            '{"translations": [...]} with exactly %d strings in the same order.\n\n%s'
            % (len(texts), settings.TARGET_LANGUAGE, len(texts), lines))


def _translate_batch_anthropic(texts):
    import anthropic  # official SDK (imported lazily)

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = client.messages.create(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=8000,
        system=_SYSTEM.format(lang=settings.TARGET_LANGUAGE),
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        messages=[{"role": "user", "content": _prompt(texts)}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)["translations"]


def _translate_batch_openai(texts):
    if not settings.LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY (or OPENAI_API_KEY) is not set")
    url = settings.LLM_BASE_URL.rstrip("/") + "/chat/completions"
    body = {
        "model": settings.LLM_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM.format(lang=settings.TARGET_LANGUAGE)},
            {"role": "user", "content": _prompt(texts)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    with httpx.Client(timeout=300) as client:
        resp = client.post(
            url,
            headers={"Authorization": "Bearer " + settings.LLM_API_KEY},
            json=body,
        )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(content)["translations"]


def translate_segments(segments):
    provider = settings.llm_provider()
    batch_fn = _translate_batch_anthropic if provider == "anthropic" else _translate_batch_openai

    out = []
    for start in range(0, len(segments), BATCH):
        chunk = segments[start:start + BATCH]
        texts = [s["text"] for s in chunk]
        translations = batch_fn(texts)

        # Guard against a length mismatch: pad/truncate to keep alignment.
        if len(translations) != len(chunk):
            translations = (translations + [""] * len(chunk))[:len(chunk)]

        for seg, hu in zip(chunk, translations):
            out.append({"start": seg["start"], "end": seg["end"],
                        "text": (hu or "").strip() or seg["text"]})
    return out
