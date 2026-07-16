"""Flow placement, VO-track render, mux, and .srt — the assembly stage.

Ported from the reference pipeline's build_vo. No time-stretch: each clip starts
at its cue, or flows on right after the previous clip when running behind,
absorbing drift into the silent gaps. Never speeds audio up.
"""

import subprocess

from .config import settings


def media_duration(path):
    out = subprocess.check_output([
        settings.FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
    ])
    return float(out.decode("utf-8").strip())


def run(cmd):
    subprocess.run(cmd, check=True)


def place(rows, min_gap=None, lead=None):
    """Assign each clip a `placed` start and `placed_end`.

    rows: [{start, dur, file, text}, ...] sorted by cue. Mutates and returns rows.
    """
    min_gap = settings.MIN_GAP if min_gap is None else min_gap
    lead = settings.LEAD if lead is None else lead
    prev_end = None
    for r in rows:
        cue, dur = r["start"], r["dur"]
        earliest = 0.0 if prev_end is None else prev_end + min_gap
        if earliest > cue - lead:
            placed = max(cue - lead, earliest)  # behind: flow on (may lead <= lead)
        else:
            placed = cue                        # on time: sync to the cue
        r["placed"] = round(placed, 3)
        r["placed_end"] = round(placed + dur, 3)
        prev_end = placed + dur
    return rows


def render_vo_track(rows, video_dur, out_wav):
    """Delay each clip to its placed start, mix, pad to full video length."""
    inputs, filters, labels = [], [], []
    for k, r in enumerate(rows):
        inputs += ["-i", r["file"]]
        ms = int(round(r["placed"] * 1000))
        filters.append("[%d]adelay=%d:all=1[a%d]" % (k, ms, k))
        labels.append("[a%d]" % k)
    filtergraph = (";".join(filters) + ";" + "".join(labels)
                   + "amix=inputs=%d:normalize=0,apad[mix]" % len(rows))
    run([settings.FFMPEG, "-y"] + inputs + [
        "-filter_complex", filtergraph, "-map", "[mix]",
        "-t", "%.3f" % video_dur, out_wav,
    ])


def mux(video, vo_wav, out_mp4):
    run([
        settings.FFMPEG, "-y", "-i", video, "-i", vo_wav,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", settings.AUDIO_BITRATE, out_mp4,
    ])


def _srt_ts(seconds):
    if seconds < 0:
        seconds = 0.0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def write_srt(rows, out_srt):
    lines = []
    for i, r in enumerate(rows):
        end = r["placed_end"]
        if i + 1 < len(rows):
            end = min(end, rows[i + 1]["placed"] - 0.02)
        end = max(end, r["placed"] + 0.3)
        lines.append(str(i + 1))
        lines.append("%s --> %s" % (_srt_ts(r["placed"]), _srt_ts(end)))
        lines.append(r["text"].strip())
        lines.append("")
    with open(out_srt, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
