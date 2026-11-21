"""Transcription worker for the office GPU PCs.

Pulls recorded answers from the platform over outbound HTTPS, transcribes them locally with
faster-whisper (Whisper large-v3-turbo by default), measures speech, pauses, pace and fillers, and
sends the text back. Nothing is ever pushed to this PC, so no office ports need opening.

    python transcribe_worker.py            # run forever (install as a service, see README.md)
    python transcribe_worker.py --once     # process the queue until empty, then exit
"""

from __future__ import annotations

import argparse
import logging
import os
import platform
import signal
import sys
import tempfile
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

from audio import load_audio
from metrics import speech_metrics

load_dotenv(Path(__file__).with_name(".env"))

PLATFORM_URL = os.environ.get("PLATFORM_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")          # auto | cuda | cpu
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "")  # default: float16 on GPU, int8 on CPU
# Per-language model overrides, e.g. "ta=/models/whisper-tamil-ct2,ml=/models/whisper-malayalam-ct2"
MODEL_OVERRIDES = dict(p.split("=", 1) for p in os.environ.get("MODEL_OVERRIDES", "").split(",") if "=" in p)
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "2"))
VERSION = "1.0.0"

log = logging.getLogger("worker")
_stop = False
_models: dict[str, object] = {}


def _device() -> tuple[str, str]:
    device = DEVICE
    if device == "auto":
        try:
            import ctranslate2
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    return device, COMPUTE_TYPE or ("float16" if device == "cuda" else "int8")


def model_for(language: str):
    """Loads (once) the model for this language: an override if configured, else the default."""
    from faster_whisper import WhisperModel

    name = MODEL_OVERRIDES.get(language, MODEL)
    if name not in _models:
        device, compute_type = _device()
        log.info("loading model %s on %s (%s)", name, device, compute_type)
        _models[name] = WhisperModel(name, device=device, compute_type=compute_type)
    return name, _models[name]


# Candidates often choose English and then answer in Hindi or Hinglish (or the reverse). Forced into the
# chosen language, Whisper translates or invents text ("you can buy money, you can buy money…"). So the
# spoken language is detected first, and the answer is transcribed in it when the evidence is clear:
# an expected language (Indian languages and English, never a stray guess like Albanian) that is at
# least SWITCH_MIN_PROBABILITY likely and twice as likely as the language the candidate chose.
SWITCH_MIN_PROBABILITY = float(os.environ.get("LANGUAGE_SWITCH_MIN", "0.5"))
EXPECTED_LANGUAGES = os.environ.get("EXPECTED_LANGUAGES", "en,hi,ta,ml,te,kn,mr,bn,gu,pa,or,as,ur").split(",")


def spoken_language(audio, chosen: str) -> str:
    _, model = model_for("")
    _, _, all_probs = model.detect_language(audio, vad_filter=True, language_detection_segments=2)
    probs = dict(all_probs)
    best = max(EXPECTED_LANGUAGES, key=lambda l: probs.get(l, 0.0))
    if best != chosen and probs.get(best, 0.0) >= SWITCH_MIN_PROBABILITY and probs[best] >= 2 * probs.get(chosen, 0.0):
        log.info("answer is in %s (%.2f), not %s (%.2f)", best, probs[best], chosen, probs.get(chosen, 0.0))
        return best
    return chosen


def transcribe(path: str, language: str, hints: list[str], question: str | None) -> dict:
    audio = load_audio(path)
    used = spoken_language(audio, language)
    name, model = model_for(used)
    segments, info = model.transcribe(
        audio,
        language=used,
        task="transcribe",
        beam_size=5,
        vad_filter=True,                   # Silero VAD: skip silence, which also stops "hallucinated" text
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=True,
        condition_on_previous_text=False,
        # Product names (Prestige, cooker, EMI, gasket, …) help English spelling, but on Hindi or other
        # languages these English hotwords pull the output into made-up English, so only use them for English.
        hotwords=(" ".join(hints) or None) if used == "en" else None,
    )
    segments = list(segments)
    words = [w for s in segments for w in (s.words or [])]
    text = " ".join(s.text.strip() for s in segments).strip()
    confidence = sum(w.probability for w in words) / len(words) if words else 0.0
    return {
        "transcript": text,
        "language": used,
        "model": f"faster-whisper:{Path(name).name}",
        "confidence": round(float(confidence), 4),
        "metrics": speech_metrics(text, used, segments, words, float(info.duration)),
    }


class Platform:
    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {WORKER_TOKEN}"
        self.s.headers["User-Agent"] = f"transcribe-worker/{VERSION}"

    def lease(self) -> dict | None:
        device, compute_type = _device()
        info = {"model": MODEL, "device": f"{device}/{compute_type}", "version": VERSION, "host": platform.node()[:60]}
        r = self.s.post(f"{PLATFORM_URL}/api/worker/lease", json={"info": info}, timeout=30)
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()["job"]

    def download(self, job: dict, dest: str) -> None:
        with self.s.get(f"{PLATFORM_URL}{job['audioPath']}", timeout=60, stream=True) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(64 * 1024):
                    f.write(chunk)

    def report(self, job_id: int, body: dict) -> None:
        r = self.s.post(f"{PLATFORM_URL}/api/worker/jobs/{job_id}/result", json=body, timeout=30)
        if r.status_code == 409:
            log.warning("job %s: lease was lost (taken by another worker); result discarded", job_id)
            return
        r.raise_for_status()


def process(p: Platform, job: dict) -> None:
    started = time.monotonic()
    suffix = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/mpeg": ".mp3"}.get(job["mimeType"], "")
    with tempfile.TemporaryDirectory() as tmp:   # audio never stays on this PC
        path = os.path.join(tmp, "answer" + suffix)
        try:
            p.download(job, path)
            result = transcribe(path, job["language"], job.get("hints", []), job.get("question"))
        except Exception as e:  # report and move on; the platform retries up to 3 times
            log.exception("job %s failed", job["id"])
            p.report(job["id"], {"error": f"{type(e).__name__}: {e}"[:1900]})
            return
    p.report(job["id"], result)
    took = time.monotonic() - started
    audio_s = job["durationMs"] / 1000
    log.info("job %s: %.1fs audio in %.1fs (%.1fx real time), confidence %.2f",
             job["id"], audio_s, took, audio_s / took if took else 0, result["confidence"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="exit when the queue is empty")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not PLATFORM_URL or not WORKER_TOKEN:
        log.error("Set PLATFORM_URL and WORKER_TOKEN in worker/.env (from Super Admin → Workers)")
        return 2

    def stop(*_):
        global _stop
        _stop = True
        log.info("stopping after the current job")
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    p = Platform()
    model_for("default")   # load the main model at start, not on the first candidate's answer
    log.info("worker ready, polling %s", PLATFORM_URL)
    backoff = POLL_SECONDS
    while not _stop:
        try:
            job = p.lease()
            backoff = POLL_SECONDS
        except requests.RequestException as e:
            log.warning("platform unreachable (%s); retrying in %.0fs", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        if job is None:
            if args.once:
                break
            time.sleep(POLL_SECONDS)
            continue
        process(p, job)
    return 0


if __name__ == "__main__":
    sys.exit(main())
