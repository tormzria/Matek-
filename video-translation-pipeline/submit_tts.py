"""Step 3 - generate one Hungarian TTS clip per segment.

Reads the translated segments (segments.json: [{start, end, text}, ...]), runs
each through the ElevenLabs graph in ComfyUI, and copies the resulting audio to

    <work_dir>/segments/seg_00.flac ... seg_NN.flac

then writes <work_dir>/vo_manifest.json:

    [{index, start, end, text, file, dur}, ...]

which build_vo.py consumes for flow placement and the .srt.

Voice / model note (from the Taobao job): eleven_v3 + George / Brian sounded
properly Hungarian; eleven_multilingual_v2 + Brian did not. Voice matters more
than model for accent - A/B with test_voices.py before committing a long job.

Usage:
  python submit_tts.py [--config config.json] [--segments segments.json]
                       [--voice "George (male, british)"] [--model eleven_v3]
                       [--only 0,3,5]
"""

import argparse
import json
import os

import common


def load_segments(path):
    with open(path, "r", encoding="utf-8") as fh:
        segs = json.load(fh)
    for i, s in enumerate(segs):
        if "text" not in s or "start" not in s or "end" not in s:
            raise SystemExit("segment %d missing start/end/text: %r" % (i, s))
    return segs


def parse_only(spec):
    if not spec:
        return None
    return {int(x) for x in spec.replace(" ", "").split(",") if x != ""}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--segments", default="segments.json")
    ap.add_argument("--voice", help="override tts_voice")
    ap.add_argument("--model", help="override tts_model")
    ap.add_argument("--only", help="comma-separated indices to (re)generate, e.g. 0,3,5")
    args = ap.parse_args()

    cfg = common.load_config(args.config)
    if args.voice:
        cfg["tts_voice"] = args.voice
    if args.model:
        cfg["tts_model"] = args.model

    segs = load_segments(args.segments)
    only = parse_only(args.only)

    seg_dir = common.work_dir(cfg, "segments")
    os.makedirs(seg_dir, exist_ok=True)

    # Start from an existing manifest so --only preserves untouched entries.
    manifest_path = common.work_dir(cfg, "vo_manifest.json")
    manifest = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as fh:
            for row in json.load(fh):
                manifest[row["index"]] = row

    print("[tts] voice=%s model=%s  %d segment(s)"
          % (cfg["tts_voice"], cfg["tts_model"], len(segs)))

    for i, s in enumerate(segs):
        if only is not None and i not in only:
            continue
        prefix = "seg_%02d" % i
        dest = os.path.join(seg_dir, prefix + ".flac")
        print("[tts] %s  %r" % (prefix, s["text"][:60]))
        common.synth_segment(cfg, s["text"], prefix, dest)
        manifest[i] = {
            "index": i,
            "start": s["start"],
            "end": s["end"],
            "text": s["text"],
            "file": os.path.relpath(dest, cfg["work_dir"]).replace("\\", "/"),
            "dur": round(common.media_duration(cfg, dest), 3),
        }

    rows = [manifest[k] for k in sorted(manifest)]
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)

    print("\n[done] %d clip(s) -> %s" % (len(rows), manifest_path))


if __name__ == "__main__":
    main()
