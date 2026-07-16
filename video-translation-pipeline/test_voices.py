"""A/B a Hungarian sentence across voices and models before a long job.

The built-in ElevenLabs node exposes ~21 English-native preset voices (no
Hungarian-native one). Accent quality depends more on the voice than the model,
so audition a representative sentence and listen before committing.

Writes <work_dir>/voice_tests/<model>__<voice>.flac for each combination.

Usage:
  python test_voices.py
  python test_voices.py --text "Egy rövid magyar próbamondat." \
      --voices "George (male, british)" "Brian (male, american)" \
      --models eleven_v3 eleven_multilingual_v2
"""

import argparse
import os
import re

import common

DEFAULT_TEXT = ("Sziasztok! Ez egy rövid magyar próbamondat, hogy halljuk, "
                "mennyire természetes az akcentus.")
DEFAULT_VOICES = ["George (male, british)", "Brian (male, american)"]
DEFAULT_MODELS = ["eleven_v3"]


def slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--voices", nargs="+", default=DEFAULT_VOICES)
    ap.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    args = ap.parse_args()

    cfg = common.load_config(args.config)
    out_dir = common.work_dir(cfg, "voice_tests")
    os.makedirs(out_dir, exist_ok=True)

    for model in args.models:
        for voice in args.voices:
            trial = dict(cfg)
            trial["tts_model"] = model
            trial["tts_voice"] = voice
            name = "%s__%s" % (slug(model), slug(voice))
            dest = os.path.join(out_dir, name + ".flac")
            print("[test] model=%s voice=%s" % (model, voice))
            common.synth_segment(trial, args.text, name, dest)
            print("       -> %s" % dest)

    print("\n[done] listen in %s and pick a voice/model for config.json" % out_dir)


if __name__ == "__main__":
    main()
