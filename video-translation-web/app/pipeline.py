"""Orchestrates one job end to end, reporting progress as it goes.

  upload.mp4
   → ffmpeg extract 16k mono wav
   → STT (Whisper API)            [{start,end,text}]
   → translate (LLM)              → target-language text
   → TTS per segment (ElevenLabs) → seg_NN.mp3
   → flow placement + mux + srt   → <id>_translated.mp4 + .srt
"""

import os
import subprocess

from .config import settings
from . import placement
from .providers import stt, translate, tts


def extract_audio(video_path, wav_path):
    subprocess.run([
        settings.FFMPEG, "-y", "-i", video_path,
        "-ar", "16000", "-ac", "1", "-vn", wav_path,
    ], check=True)


def process(job_dir, video_path, source_language, progress):
    """Run the full pipeline. `progress(stage, pct)` reports status.

    Returns (out_mp4_path, out_srt_path).
    """
    seg_dir = os.path.join(job_dir, "segments")
    os.makedirs(seg_dir, exist_ok=True)

    progress("extracting audio", 5)
    wav = os.path.join(job_dir, "audio_16k.wav")
    extract_audio(video_path, wav)

    progress("transcribing", 20)
    segments = stt.transcribe(wav, source_language or None)
    if not segments:
        raise RuntimeError("No speech was detected in the video.")

    progress("translating", 40)
    segments = translate.translate_segments(segments)

    progress("synthesizing voice", 55)
    rows = []
    total = len(segments)
    for i, seg in enumerate(segments):
        clip = os.path.join(seg_dir, "seg_%03d.mp3" % i)
        tts.synth(seg["text"], clip)
        rows.append({
            "start": seg["start"],
            "dur": round(placement.media_duration(clip), 3),
            "file": clip,
            "text": seg["text"],
        })
        progress("synthesizing voice (%d/%d)" % (i + 1, total),
                 55 + int(30 * (i + 1) / max(total, 1)))

    progress("assembling video", 90)
    placement.place(rows)
    video_dur = placement.media_duration(video_path)
    vo_wav = os.path.join(job_dir, "vo_track.wav")
    placement.render_vo_track(rows, video_dur, vo_wav)

    out_mp4 = os.path.join(job_dir, "translated.mp4")
    out_srt = os.path.join(job_dir, "translated.srt")
    placement.mux(video_path, vo_wav, out_mp4)
    placement.write_srt(rows, out_srt)

    progress("done", 100)
    return out_mp4, out_srt
