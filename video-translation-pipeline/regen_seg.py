"""Step 3b - regenerate individual segments with edited (usually shorter) text.

When build_vo.py --report shows a line overrunning its slot, shorten just that
Hungarian line and regenerate only that segment instead of the whole batch.

Provide edits as {index: "new text"} either inline or in a JSON file:

  python regen_seg.py --edits '{"3": "Rövidebb mondat.", "7": "Kevesebb szó."}'
  python regen_seg.py --edits-file regen_edits.json

This updates segments.json in place (so the change is permanent), re-runs TTS
for those indices, and refreshes their vo_manifest.json rows. Then rebuild with
build_vo.py.
"""

import argparse
import json
import os

import common
import submit_tts


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--segments", default="segments.json")
    ap.add_argument("--edits", help='inline JSON, e.g. \'{"3": "shorter text"}\'')
    ap.add_argument("--edits-file", help="path to a JSON file of {index: text}")
    args = ap.parse_args()

    if not args.edits and not args.edits_file:
        raise SystemExit("Provide --edits '<json>' or --edits-file <path>.")

    edits_raw = {}
    if args.edits_file:
        with open(args.edits_file, "r", encoding="utf-8") as fh:
            edits_raw.update(json.load(fh))
    if args.edits:
        edits_raw.update(json.loads(args.edits))

    # Normalise keys to ints.
    edits = {int(k): v for k, v in edits_raw.items()}

    cfg = common.load_config(args.config)
    segs = submit_tts.load_segments(args.segments)

    for idx, new_text in edits.items():
        if idx < 0 or idx >= len(segs):
            raise SystemExit("edit index %d out of range (0..%d)" % (idx, len(segs) - 1))
        print("[edit] seg_%02d: %r -> %r" % (idx, segs[idx]["text"][:40], new_text[:40]))
        segs[idx]["text"] = new_text

    # Persist the edited text so the segment source stays the source of truth.
    with open(args.segments, "w", encoding="utf-8") as fh:
        json.dump(segs, fh, ensure_ascii=False, indent=2)

    # Regenerate only the edited indices, reusing submit_tts's logic.
    seg_dir = common.work_dir(cfg, "segments")
    os.makedirs(seg_dir, exist_ok=True)

    manifest_path = common.work_dir(cfg, "vo_manifest.json")
    manifest = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as fh:
            for row in json.load(fh):
                manifest[row["index"]] = row

    for idx in sorted(edits):
        prefix = "seg_%02d" % idx
        dest = os.path.join(seg_dir, prefix + ".flac")
        print("[tts] regenerating %s" % prefix)
        common.synth_segment(cfg, segs[idx]["text"], prefix, dest)
        manifest[idx] = {
            "index": idx,
            "start": segs[idx]["start"],
            "end": segs[idx]["end"],
            "text": segs[idx]["text"],
            "file": os.path.relpath(dest, cfg["work_dir"]).replace("\\", "/"),
            "dur": round(common.media_duration(cfg, dest), 3),
        }

    rows = [manifest[k] for k in sorted(manifest)]
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)

    print("\n[done] regenerated %d segment(s); rebuild with build_vo.py"
          % len(edits))


if __name__ == "__main__":
    main()
