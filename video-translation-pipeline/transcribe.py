"""Step 1 - extract audio and transcribe the source language with Whisper.

    video.mp4  --ffmpeg-->  audio_16k.wav  --Whisper-->  transcript.json

Writes into the work folder:
  audio_16k.wav          16 kHz mono PCM (what Whisper wants)
  transcript.json        {language, model, segments:[{id,start,end,text}]}
  transcript.txt         human-readable, one timestamped line per segment
  segments.template.json [{start,end,text}] copy of source text, ready to be
                         translated to Hungarian in place (feed to submit_tts.py)

Model note: use "medium". large-v3 silently crashed on the portable install's
nightly PyTorch (2.11 + cu130) - downloads then dies with no transcript. medium
on CUDA transcribes ~3.5 min of audio in ~18s and is good for Chinese.

Usage:
  python transcribe.py [--config config.json] [--video PATH] [--language zh]
"""

import argparse
import json
import os

import common


def extract_audio(cfg, video, wav_path):
    common.run([
        cfg["ffmpeg"], "-y", "-i", video,
        "-ar", "16000", "-ac", "1", "-vn", wav_path,
    ])


def transcribe(cfg, wav_path):
    # Imported here so the other steps don't pay Whisper's import cost.
    import whisper

    print("[whisper] loading model=%s device=%s"
          % (cfg["whisper_model"], cfg["whisper_device"]))
    model = whisper.load_model(cfg["whisper_model"], device=cfg["whisper_device"])

    lang = cfg["source_language"] or None  # None => auto-detect
    print("[whisper] transcribing (language=%s)" % (lang or "auto"))
    result = model.transcribe(
        wav_path,
        language=lang,
        task="transcribe",
        fp16=bool(cfg["whisper_fp16"]),
    )
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--video", help="override config video path")
    ap.add_argument("--language", help="override source language (e.g. zh, ja, ko; '' = auto)")
    ap.add_argument("--skip-extract", action="store_true",
                    help="reuse an existing audio_16k.wav")
    args = ap.parse_args()

    cfg = common.load_config(args.config)
    if args.video:
        cfg["video"] = args.video
    if args.language is not None:
        cfg["source_language"] = args.language

    if not cfg["video"] or not os.path.isfile(cfg["video"]):
        raise SystemExit("Set 'video' in config.json (or pass --video); not found: %r"
                         % cfg["video"])

    wav_path = common.work_dir(cfg, "audio_16k.wav")
    if args.skip_extract and os.path.isfile(wav_path):
        print("[ffmpeg] reusing %s" % wav_path)
    else:
        extract_audio(cfg, cfg["video"], wav_path)

    result = transcribe(cfg, wav_path)

    segments = [
        {"id": s.get("id", i), "start": round(s["start"], 3),
         "end": round(s["end"], 3), "text": s["text"].strip()}
        for i, s in enumerate(result.get("segments", []))
    ]

    transcript = {
        "language": result.get("language", cfg["source_language"]),
        "model": cfg["whisper_model"],
        "segments": segments,
    }

    json_path = common.work_dir(cfg, "transcript.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(transcript, fh, ensure_ascii=False, indent=2)

    txt_path = common.work_dir(cfg, "transcript.txt")
    with open(txt_path, "w", encoding="utf-8") as fh:
        for s in segments:
            fh.write("[%7.2f -> %7.2f] %s\n" % (s["start"], s["end"], s["text"]))

    # Translation template: same timings, source text to be replaced by Hungarian.
    template = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segments]
    tmpl_path = common.work_dir(cfg, "segments.template.json")
    with open(tmpl_path, "w", encoding="utf-8") as fh:
        json.dump(template, fh, ensure_ascii=False, indent=2)

    print("\n[done] %d segments" % len(segments))
    print("  %s" % json_path)
    print("  %s" % txt_path)
    print("  %s  <- translate 'text' to Hungarian, save as segments.json" % tmpl_path)


if __name__ == "__main__":
    main()
