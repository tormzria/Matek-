# Video Translation → Hungarian Voice-Over Pipeline

Turn a foreign-language (e.g. Chinese) video into the same video with a
**segment-timed Hungarian voice-over** (ElevenLabs) plus a matching **`.srt`**.
Whisper + ffmpeg run locally; ElevenLabs TTS runs through ComfyUI's comfy.org
proxy.

This is a **config-driven, reusable** version of the pipeline originally built
and verified on the `Taobao.mp4` job (2026-07-16). Job-specific paths, voices,
and the translated text live in `config.json` / `segments.json`, not in the
scripts, so a new video needs no code edits.

> **Runs on the ComfyUI portable install.** These scripts are meant to be run
> from the portable root with the embedded Python, e.g.
> `./python_embeded/python.exe -u transcribe.py`. ComfyUI must be running at
> `http://127.0.0.1:8188`.

---

## Pipeline overview

```
video.mp4
 │ ffmpeg (extract 16k mono wav)
 ▼
audio_16k.wav
 │ Whisper (medium, language=source) ─ transcribe.py
 ▼
transcript.json / segments.template.json  [{start,end,text}, ...]
 │ translate text → Hungarian, keep timestamps  (LLM / manual)
 ▼
segments.json  [{start,end,hungarian_text}, ...]
 │ ElevenLabs TTS per segment (v3 + George) ─ submit_tts.py
 ▼
vo_work/segments/seg_00.flac … + vo_manifest.json
 │ flow-placement + mux + srt ─ build_vo.py
 ▼
<name>_HU.mp4 + <name>_HU.srt
```

---

## Setup

1. **Copy the config** and edit it for your job:
   ```bash
   cp config.example.json config.json
   ```
   Key fields: `video` (source path), `work_dir`, `source_language`,
   `ffmpeg_bin_dir` (added to `PATH` so Whisper/ffmpeg are found),
   `comfy_url`, `comfy_key_file`, and the `tts_*` voice/model settings.

2. **comfy.org key.** ElevenLabs here bills **comfy.org credits**, not an
   ElevenLabs account. Put your comfy.org API key on a single line (no trailing
   newline) in the file named by `comfy_key_file` (default `.comfy_key`). It is
   `.gitignore`d — never commit it. The key rides in the `/prompt` request as
   `extra_data.api_key_comfy_org`.

3. **Whisper model: use `medium`.** `large-v3` silently crashed on the portable
   install's nightly PyTorch (2.11 + cu130) — it downloads then dies with no
   transcript. `medium` on CUDA transcribes ~3.5 min of audio in ~18s and is
   good for Chinese.

---

## Steps

### 1. Transcribe — `transcribe.py`
Extracts `audio_16k.wav` (`ffmpeg -ar 16000 -ac 1 -vn`) and runs Whisper,
writing `transcript.json`, `transcript.txt`, and `segments.template.json`.

```bash
python transcribe.py                 # uses config.json
python transcribe.py --language ja   # different source language ('' = auto-detect)
```

### 2. Translate → Hungarian (keep timestamps)
Translate each segment's `text` to natural Hungarian **with accents**
(á é í ó ö ő ú ü ű), keeping its `start`/`end`. Flag garbled source lines rather
than inventing content. Save the result as **`segments.json`** (same shape as
`segments.template.json`). For dense clusters, prefer **shorter Hungarian**
(see Timing below). See `segments.example.json` for the format.

### 3. Generate TTS — `submit_tts.py`
One ElevenLabs clip per segment, copied to `vo_work/segments/seg_NN.flac`, with
`vo_manifest.json` recording each clip's measured duration.

```bash
python submit_tts.py                                    # all segments
python submit_tts.py --voice "Brian (male, american)"   # override voice
python submit_tts.py --only 3,7                          # just a few
```

**Voice/model notes.** `eleven_v3` + **George / Brian** sounded properly
Hungarian on this job; `eleven_multilingual_v2` + Brian did not. Voice matters
more than the model for accent — A/B first:

```bash
python test_voices.py    # writes vo_work/voice_tests/<model>__<voice>.flac
```

Gotchas baked into the graph builder (`common.build_tts_graph`):
- Dynamic-combo sub-inputs carry a `model.` prefix (`model.speed`,
  `model.similarity_boost`; `eleven_multilingual_v2` also `model.style`,
  `model.use_speaker_boost`). `eleven_v3` takes only speed + similarity_boost.
- `eleven_multilingual_v2` **rejects** `language_code:"hu"` — left empty so the
  multilingual models auto-detect Hungarian.
- The built-in node exposes ~21 English-native preset voices (no
  Hungarian-native). A native accent needs `ElevenLabsInstantVoiceClone` from a
  Hungarian sample, or a custom node that accepts a raw `voice_id`.

### 4. Assemble — `build_vo.py`
Flow-placement (no time-stretch): each clip starts at its cue, or flows on right
after the previous clip when running behind, absorbing drift into the silent
gaps. Renders the VO track (`adelay`+`amix`, `normalize=0`), muxes it over the
video replacing the original audio (`-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac
-b:a 192k`), and writes the `.srt`.

```bash
python build_vo.py --report   # per-segment cue / start / dur / drift / gapNext
python build_vo.py            # → <name>_HU.mp4 + <name>_HU.srt (next to the video)
```

Constants (in `config.json`): `min_gap` `0.12` s between clips, `lead` `0.8` s
allowed lead-in before a cue.

---

## Timing strategy (when lines don't fit)

Two levers, in order — **never** just speed the audio up:
1. **Use the free space.** Instructional videos have long silent gaps; flow
   placement lets a line breathe into the following gap and re-sync afterward.
   ~1 s of drift at a dense cluster is fine and sounds natural.
2. **Shorten the Hungarian** for genuinely cramped clusters (keep meaning, fewer
   words). Edit and regenerate just that line, then rebuild:
   ```bash
   python regen_seg.py --edits '{"3": "Rövidebb mondat."}'
   python build_vo.py
   ```

---

## Reusing for a new video

1. Edit `config.json`: point `video` / `work_dir` at the new file, set
   `source_language`.
2. `python transcribe.py` → `segments.template.json`.
3. Translate to Hungarian → save as `segments.json`.
4. `python submit_tts.py` (pick voice/model via config or flags).
5. `python build_vo.py --report`, shorten any overruns with `regen_seg.py`, then
   `python build_vo.py` → final mp4 + srt.

## Files

| File | Role |
|---|---|
| `config.example.json` | copy to `config.json`; all job settings |
| `common.py` | shared: config, ComfyUI submit/poll/download, TTS graph, ffprobe, srt |
| `transcribe.py` | ffmpeg audio extract + Whisper transcription |
| `test_voices.py` | A/B a Hungarian sentence across voices & models |
| `submit_tts.py` | generate all Hungarian TTS segments from `segments.json` |
| `regen_seg.py` | regenerate individual segments with edited text |
| `build_vo.py` | flow-placement report / VO render / mux / srt |
| `segments.example.json` | the translated-segments format |
| `.comfy_key` | comfy.org API key (local, git-ignored — create yourself) |
```
