"""Step 4 - flow-placement, VO track render, mux over video, and .srt.

Flow placement (no time-stretch). Each clip starts at its cue, or - if the
previous clip is still running - flows straight on from it, absorbing drift into
the silent gaps that instructional videos leave between lines. This avoids the
sped-up, unnatural sound of an "atempo-to-fit" approach. Never speed the audio
up; the two real levers are the free space and shorter Hungarian (see README).

    --report   print per-segment cue / start / dur / drift / gapNext and stop,
               so you can see which lines overrun and shorten just those.
    (default)  render the VO track (ffmpeg adelay + amix, normalize=0), mux it
               over the video replacing the original audio, and write the .srt.

Outputs (next to the source video): <name>_HU.mp4, <name>_HU.srt

Usage:
  python build_vo.py --report
  python build_vo.py
"""

import argparse
import json
import os

import common


def load_manifest(cfg):
    path = common.work_dir(cfg, "vo_manifest.json")
    if not os.path.isfile(path):
        raise SystemExit("No manifest at %s - run submit_tts.py first." % path)
    with open(path, "r", encoding="utf-8") as fh:
        rows = json.load(fh)
    rows.sort(key=lambda r: r["index"])
    for r in rows:
        if "dur" not in r:
            raise SystemExit("manifest row %r has no 'dur'" % r.get("index"))
    return rows


def place(rows, min_gap, lead):
    """Assign each clip a placed start time using flow placement.

    earliest = prev_end + min_gap (no overlap). If the previous clip runs past
    cue - lead we flow on from it (start = earliest, drifting); otherwise we
    sync the clip to its own cue. Returns rows with 'placed' and 'placed_end'.
    """
    prev_end = None
    for r in rows:
        cue = r["start"]
        dur = r["dur"]
        earliest = 0.0 if prev_end is None else prev_end + min_gap
        if earliest > cue - lead:
            placed = max(cue - lead, earliest)  # behind: flow on (may lead <= lead)
        else:
            placed = cue                        # on time: sync to the cue
        r["placed"] = round(placed, 3)
        r["placed_end"] = round(placed + dur, 3)
        prev_end = placed + dur
    return rows


def report(rows):
    print("%3s  %8s  %8s  %6s  %7s  %7s  %s"
          % ("idx", "cue", "start", "dur", "drift", "gapNext", "text"))
    for i, r in enumerate(rows):
        nxt = rows[i + 1]["placed"] if i + 1 < len(rows) else None
        gap = "" if nxt is None else "%7.2f" % (nxt - r["placed_end"])
        print("%3d  %8.2f  %8.2f  %6.2f  %+7.2f  %7s  %s"
              % (r["index"], r["start"], r["placed"], r["dur"],
                 r["placed"] - r["start"], gap, r["text"][:48]))
    overruns = [r for i, r in enumerate(rows[:-1])
                if rows[i + 1]["placed"] < r["placed_end"]]
    if overruns:
        print("\n%d line(s) push the next clip past its cue - shorten them "
              "(regen_seg.py) if the drift sounds off." % len(overruns))


def render_vo_track(cfg, rows, video_dur, out_wav):
    """Delay each clip to its placed start, mix, pad to full video length."""
    seg_dir = common.work_dir(cfg, "segments")
    inputs = []
    filters = []
    labels = []
    for k, r in enumerate(rows):
        seg_file = os.path.join(cfg["work_dir"], r["file"]) \
            if "file" in r else os.path.join(seg_dir, "seg_%02d.flac" % r["index"])
        if not os.path.isfile(seg_file):
            raise SystemExit("missing clip: %s" % seg_file)
        inputs += ["-i", seg_file]
        ms = int(round(r["placed"] * 1000))
        filters.append("[%d]adelay=%d:all=1[a%d]" % (k, ms, k))
        labels.append("[a%d]" % k)

    filtergraph = ";".join(filters) + ";" + "".join(labels) \
        + "amix=inputs=%d:normalize=0,apad[mix]" % len(rows)

    cmd = [cfg["ffmpeg"], "-y"] + inputs + [
        "-filter_complex", filtergraph,
        "-map", "[mix]",
        "-t", "%.3f" % video_dur,
        out_wav,
    ]
    common.run(cmd)


def mux(cfg, video, vo_wav, out_mp4):
    common.run([
        cfg["ffmpeg"], "-y",
        "-i", video, "-i", vo_wav,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", cfg["audio_bitrate"],
        out_mp4,
    ])


def write_subs(cfg, rows, out_srt):
    cues = []
    for i, r in enumerate(rows):
        end = r["placed_end"]
        if i + 1 < len(rows):  # don't let a subtitle overlap the next line
            end = min(end, rows[i + 1]["placed"] - 0.02)
        cues.append((r["placed"], max(end, r["placed"] + 0.3), r["text"]))
    common.write_srt(out_srt, cues)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--report", action="store_true",
                    help="print placement table and exit (no render)")
    args = ap.parse_args()

    cfg = common.load_config(args.config)
    rows = load_manifest(cfg)
    rows = place(rows, cfg["min_gap"], cfg["lead"])

    if args.report:
        report(rows)
        return

    if not cfg["video"] or not os.path.isfile(cfg["video"]):
        raise SystemExit("Set 'video' in config.json; not found: %r" % cfg["video"])

    video = cfg["video"]
    video_dur = common.media_duration(cfg, video)

    stem = os.path.splitext(video)[0]
    out_mp4 = stem + "_HU.mp4"
    out_srt = stem + "_HU.srt"
    vo_wav = common.work_dir(cfg, "vo_track.wav")

    print("[build] %d clips, video is %.1fs" % (len(rows), video_dur))
    render_vo_track(cfg, rows, video_dur, vo_wav)
    mux(cfg, video, vo_wav, out_mp4)
    write_subs(cfg, rows, out_srt)

    print("\n[done]")
    print("  %s" % out_mp4)
    print("  %s" % out_srt)


if __name__ == "__main__":
    main()
