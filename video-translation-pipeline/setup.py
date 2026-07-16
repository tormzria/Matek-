"""Setup doctor for the video -> Hungarian voice-over pipeline.

Run this first on a new machine. It checks every prerequisite and prints a
PASS/FAIL checklist with exact remediation for anything missing, then scaffolds
config.json from the example if it doesn't exist yet.

  python setup.py            # scaffold config.json (if missing) + run all checks
  python setup.py --check    # checks only, don't touch config.json
  python setup.py --init     # only scaffold config.json from the example

Stdlib only, so it runs under ComfyUI's embedded Python with nothing installed.
Exit code is 0 when everything needed to run the pipeline is present, else 1.
"""

import argparse
import json
import os
import shutil
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GREEN, RED, YEL, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def _load_cfg():
    """Load config.json if present, else the example, else built-in defaults."""
    try:
        import common
        for name in ("config.json", "config.example.json"):
            p = os.path.join(HERE, name)
            if os.path.isfile(p):
                return common.load_config(p)
        return dict(common.DEFAULTS)
    except Exception:
        # common.py should always be next to us, but degrade gracefully.
        return {"comfy_url": "http://127.0.0.1:8188", "comfy_key_file": ".comfy_key",
                "ffmpeg": "ffmpeg", "ffprobe": "ffprobe", "ffmpeg_bin_dir": ""}


def _http_ok(url, timeout=4):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 300, resp
    except Exception as exc:
        return False, exc


# Each check returns (label, ok, detail, remediation).

def check_python():
    ok = sys.version_info >= (3, 8)
    return ("Python >= 3.8", ok, "found %d.%d.%d" % sys.version_info[:3],
            "Use ComfyUI's embedded python (.\\python_embeded\\python.exe).")


def check_ffmpeg(cfg):
    bin_dir = cfg.get("ffmpeg_bin_dir") or ""
    if bin_dir and os.path.isdir(bin_dir):
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
    ff = shutil.which(cfg.get("ffmpeg", "ffmpeg"))
    fp = shutil.which(cfg.get("ffprobe", "ffprobe"))
    ok = bool(ff and fp)
    detail = "ffmpeg=%s ffprobe=%s" % (ff or "MISSING", fp or "MISSING")
    return ("ffmpeg + ffprobe on PATH", ok, detail,
            "Install ffmpeg, or set \"ffmpeg_bin_dir\" in config.json to its bin "
            "folder (the one containing ffmpeg + ffprobe).")


def check_whisper():
    try:
        import whisper  # noqa: F401
        ok, detail = True, "import ok"
    except Exception as exc:
        ok, detail = False, str(exc)
    return ("Whisper (openai-whisper)", ok, detail,
            "Install it:  python -m pip install openai-whisper")


def check_comfy_running(cfg):
    url = cfg["comfy_url"].rstrip("/") + "/system_stats"
    ok, _ = _http_ok(url)
    return ("ComfyUI reachable (%s)" % cfg["comfy_url"], ok,
            "GET /system_stats" + (" ok" if ok else " failed"),
            "Start ComfyUI and confirm it listens at comfy_url (default "
            "http://127.0.0.1:8188).")


def check_elevenlabs_node(cfg):
    url = cfg["comfy_url"].rstrip("/") + "/object_info/ElevenLabsTextToSpeech"
    ok, resp = _http_ok(url)
    if ok:
        try:
            data = json.loads(resp.read().decode("utf-8"))
            ok = "ElevenLabsTextToSpeech" in data
        except Exception:
            ok = False
    return ("ElevenLabs ComfyUI node installed", ok,
            "object_info has ElevenLabsTextToSpeech" if ok else "node not found",
            "Install the ComfyUI custom node that provides ElevenLabsTextToSpeech "
            "/ ElevenLabsVoiceSelector, then restart ComfyUI.")


def check_comfy_key(cfg):
    p = os.path.join(HERE, cfg["comfy_key_file"]) if not os.path.isabs(cfg["comfy_key_file"]) \
        else cfg["comfy_key_file"]
    exists = os.path.isfile(p)
    non_empty = exists and os.path.getsize(p) > 0
    return ("comfy.org API key (%s)" % cfg["comfy_key_file"], non_empty,
            "present" if non_empty else "missing/empty",
            "Create %s with your comfy.org API key on ONE line (no newline). "
            "This bills comfy.org credits and is what ElevenLabs uses here." % cfg["comfy_key_file"])


def check_config():
    ok = os.path.isfile(os.path.join(HERE, "config.json"))
    return ("config.json exists", ok, "present" if ok else "missing",
            "Run: python setup.py --init   (copies config.example.json), then edit "
            "\"video\" and the tts_* fields.")


def scaffold_config():
    src = os.path.join(HERE, "config.example.json")
    dst = os.path.join(HERE, "config.json")
    if os.path.isfile(dst):
        print("config.json already exists - leaving it untouched.")
        return
    shutil.copyfile(src, dst)
    print("Created config.json from config.example.json - edit \"video\" and tts_* fields.")


def run_checks():
    cfg = _load_cfg()
    checks = [
        check_python(),
        check_ffmpeg(cfg),
        check_whisper(),
        check_comfy_running(cfg),
        check_elevenlabs_node(cfg),
        check_comfy_key(cfg),
        check_config(),
    ]
    print("\nSetup check for the video -> Hungarian voice-over pipeline\n")
    all_ok = True
    for label, ok, detail, remedy in checks:
        mark = (GREEN + "PASS" + OFF) if ok else (RED + "FAIL" + OFF)
        print("  [%s] %s  %s(%s)%s" % (mark, label, DIM, detail, OFF))
        if not ok:
            all_ok = False
            print("        %s-> %s%s" % (YEL, remedy, OFF))
    print()
    if all_ok:
        print(GREEN + "All prerequisites satisfied. Run:  python transcribe.py" + OFF)
    else:
        print(RED + "Some prerequisites are missing - fix the FAIL lines above." + OFF)
    return all_ok


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="run checks only")
    ap.add_argument("--init", action="store_true", help="scaffold config.json only")
    args = ap.parse_args()

    if args.init:
        scaffold_config()
        return
    if not args.check:
        scaffold_config()
    ok = run_checks()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
