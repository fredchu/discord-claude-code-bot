#!/usr/bin/env python3
"""Reference helper implementing the VOICE_TRANSCRIBE_CMD transcription contract."""

import argparse
import os
import platform
import re
import sys
import traceback

# Both backends pull models through huggingface_hub, whose download progress bars
# go to stderr. The caller shows only the first 200 characters of stderr in its
# Discord notice, so that progress noise would crowd out the message that matters.
# Set before either backend is imported. Exporting it yourself still wins.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

# The caller truncates the note it shows to 200 characters. Some upstream errors
# are far longer than that and put the real cause LAST — mlx-whisper's "failed to
# load audio" embeds the entire ffmpeg banner ahead of "No such file or directory".
# Keeping both ends is what makes the notice actionable.
def one_line(text, limit=160):
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    head = limit // 3
    tail = limit - head - 3
    return f"{text[:head]} … {text[-tail:]}"


def transcribe_mlx(audio, model, language, prompt):
    try:
        import mlx_whisper
    except ImportError as exc:
        raise RuntimeError(
            "mlx-whisper is not installed; run: pip install mlx-whisper"
        ) from exc

    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        language=language,
        initial_prompt=prompt,
        verbose=None,
    )
    return result["text"]


def transcribe_faster_whisper(audio, model, language, prompt, no_vad):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed; run: pip install faster-whisper"
        ) from exc

    whisper = WhisperModel(model, device="cpu", compute_type="int8")
    segments, _info = whisper.transcribe(
        audio,
        language=language,
        initial_prompt=prompt,
        vad_filter=not no_vad,
    )
    return "".join(segment.text for segment in segments)


def main():
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", newline="\n")

    parser = argparse.ArgumentParser(
        description="Transcribe audio for VOICE_TRANSCRIBE_CMD."
    )
    parser.add_argument(
        "--backend", choices=("auto", "mlx", "faster-whisper"), default="auto"
    )
    parser.add_argument("--model")
    parser.add_argument("--terms", metavar="PATH")
    parser.add_argument("--language", metavar="LANG", default="zh")
    parser.add_argument("--no-vad", action="store_true")
    parser.add_argument("audio", metavar="AUDIO")
    args = parser.parse_args()

    backend = args.backend
    apple_silicon = platform.system() == "Darwin" and platform.machine() == "arm64"
    if backend == "auto":
        backend = "mlx" if apple_silicon else "faster-whisper"
    elif backend == "mlx" and not apple_silicon:
        raise RuntimeError("mlx-whisper requires Apple Silicon")

    prompt = None
    if args.terms:
        with open(args.terms, encoding="utf-8") as terms_file:
            prompt = " ".join(terms_file.read().split())

    if backend == "mlx":
        model = args.model or "eoleedi/Breeze-ASR-25-mlx"
        text = transcribe_mlx(args.audio, model, args.language, prompt)
    else:
        model = args.model or "large-v3-turbo"
        text = transcribe_faster_whisper(
            args.audio, model, args.language, prompt, args.no_vad
        )

    text = text.strip()
    if not text:
        print("no speech detected", file=sys.stderr)
        return 0

    print(text)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        # Compact the whole line, not just the message: the type name sits inside
        # the caller's 200-character budget too.
        print(one_line(f"transcribe.py: {type(exc).__name__}: {exc}"), file=sys.stderr)
        if os.environ.get("TRANSCRIBE_DEBUG"):
            traceback.print_exc()
        raise SystemExit(1)
