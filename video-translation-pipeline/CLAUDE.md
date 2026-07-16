# Claude Code playbook — set up the video → Hungarian voice-over pipeline

You are helping a **non-technical user** get this pipeline running on their own
machine. Be friendly, do the work for them, and never assume prior knowledge.
Follow this order. Do not skip the honest prerequisites in step 1.

## 0. What this tool does
It takes a foreign-language video and produces the same video with a Hungarian
voice-over plus a `.srt` subtitle file. It runs on top of **ComfyUI** (which
does the ElevenLabs text-to-speech) and uses **Whisper** + **ffmpeg** locally.

## 1. Hard prerequisites you cannot install for them
Tell the user up front they need these; help them get each one:
1. **A running ComfyUI** (the portable install is easiest) reachable at
   `http://127.0.0.1:8188`. On a machine with an NVIDIA GPU it's much faster.
2. **The ElevenLabs custom node** inside ComfyUI (provides
   `ElevenLabsTextToSpeech` + `ElevenLabsVoiceSelector`). Install via ComfyUI
   Manager, then restart ComfyUI.
3. **A comfy.org API key with credits.** ElevenLabs here is billed as
   comfy.org credits, NOT an ElevenLabs subscription. They get the key from
   their comfy.org account.
4. **ffmpeg + ffprobe** on the machine.

## 2. Run the doctor
From this folder, using ComfyUI's embedded Python when on the portable install:
```
python setup.py
```
(On ComfyUI portable: `..\python_embeded\python.exe setup.py` run from here, or
adjust the path.) It scaffolds `config.json` and prints a PASS/FAIL checklist.
**Work down the FAIL lines** and fix each using its `->` remediation:
- Whisper missing → `python -m pip install openai-whisper`
- ffmpeg missing → install it, or set `ffmpeg_bin_dir` in `config.json`
- ComfyUI unreachable → have them start ComfyUI
- ElevenLabs node missing → install the custom node + restart ComfyUI
- comfy key missing → create the `.comfy_key` file (ask them to paste the key;
  write it as a single line, no trailing newline). Never commit this file.
Re-run `python setup.py --check` until every line is PASS.

## 3. Fill in config.json
Ask the user for their video file path and set `"video"` in `config.json`. Set
`"source_language"` (e.g. `zh`, `ja`, `ko`, or `""` for auto-detect). Leave the
`tts_*` defaults (`eleven_v3` + George) unless they want a different voice.

## 4. Run the pipeline with them
Walk through it one command at a time, explaining each:
1. `python transcribe.py` → makes `vo_work/segments.template.json`.
2. **Translate to Hungarian.** Read `vo_work/segments.template.json`, translate
   each `text` to natural Hungarian *with accents* (keep `start`/`end`), and
   save the result as `segments.json` in this folder. YOU (Claude) can do this
   translation directly. Flag garbled source lines instead of inventing content.
3. `python test_voices.py` → optional: let them listen and pick a voice.
4. `python submit_tts.py` → generates the Hungarian audio clips.
5. `python build_vo.py --report` → show the timing table; if some lines overrun
   badly, shorten those Hungarian lines and
   `python regen_seg.py --edits '{"<idx>": "shorter text"}'`.
6. `python build_vo.py` → produces `<name>_HU.mp4` and `<name>_HU.srt` next to
   the source video. Point the user at those two files.

## 5. Troubleshooting notes
- Whisper: use the `medium` model (default). `large-v3` crashed on the nightly
  PyTorch of the reference install.
- If TTS audio sounds un-Hungarian, it's the **voice**, not the model — try a
  different preset with `test_voices.py`. `eleven_v3` + George/Brian worked well.
- Never speed audio up to fit timing. Use the silent gaps (automatic) or shorten
  the Hungarian (`regen_seg.py`). See README.md § "Timing strategy".

Full details are in `README.md`.
