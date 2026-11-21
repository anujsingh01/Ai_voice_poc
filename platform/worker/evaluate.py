"""Day 3 accuracy test: which speech engine is best for each language?

Put real answer recordings in a folder with a references.csv next to them:

    file,language,reference
    priya-q3.webm,ta,நான் விற்பனையில் வேலை செய்ய விரும்புகிறேன் …
    arun-q7.m4a,hi,अगर ग्राहक दरवाज़ा बंद कर दे तो …

`reference` is what the person actually said, typed by someone who speaks the language (about 50 clips
per language). Then run, for example:

    python evaluate.py clips/ --engine whisper:large-v3-turbo --engine whisper:small \
                              --engine whisper:ta=/models/whisper-tamil-ct2 --engine indicconformer

For each engine and language it reports word error rate (WER), character error rate (CER, fairer for
Tamil and other agglutinative languages) and speed, and writes every transcript to results-<time>.csv.
Lower error is better; pick the best engine per language and set MODEL_OVERRIDES in worker/.env.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path


# ---------- scoring ----------

def normalise(text: str) -> str:
    """Lower-case, drop punctuation (keeping Indic vowel signs), collapse spaces."""
    text = unicodedata.normalize("NFC", text).lower()
    text = "".join(ch if unicodedata.category(ch)[0] in "LMN" or ch.isspace() else " " for ch in text)
    return re.sub(r"\s+", " ", text).strip()


def edit_distance(a: list, b: list) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def error_rates(reference: str, hypothesis: str) -> tuple[int, int, int, int]:
    """Returns (word errors, reference words, char errors, reference chars)."""
    r, h = normalise(reference), normalise(hypothesis)
    rc, hc = r.replace(" ", ""), h.replace(" ", "")
    return edit_distance(r.split(), h.split()), len(r.split()), edit_distance(list(rc), list(hc)), len(rc)


# ---------- engines ----------

class Whisper:
    """faster-whisper; `spec` is a model name or path, optionally per language: 'ta=/path,hi=large-v3'."""

    def __init__(self, spec: str):
        from transcribe_worker import _device
        self.device, self.compute_type = _device()
        parts = spec.split(",")
        self.per_lang = dict(p.split("=", 1) for p in parts if "=" in p)
        self.default = next((p for p in parts if "=" not in p), None)   # None: only the listed languages
        self.name = f"whisper:{spec}"
        self._models: dict[str, object] = {}

    def _model(self, language: str):
        from faster_whisper import WhisperModel
        name = self.per_lang.get(language) or self.default
        if not name:
            return None
        if name not in self._models:
            self._models[name] = WhisperModel(name, device=self.device, compute_type=self.compute_type)
        return self._models[name]

    def transcribe(self, path: Path, language: str) -> str | None:
        model = self._model(language)
        if model is None:
            return None   # this engine isn't configured for this language
        from audio import load_audio
        segments, _ = model.transcribe(load_audio(str(path)), language=language, beam_size=5, vad_filter=True, condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segments)


class IndicConformer:
    """AI4Bharat IndicConformer (MIT, 22 Indian languages). Gated on Hugging Face: accept the terms at
    huggingface.co/ai4bharat/indic-conformer-600m-multilingual and set HF_TOKEN. Extra packages:
    pip install torch torchaudio transformers onnxruntime"""

    name = "indicconformer"

    def __init__(self):
        import torch  # noqa: F401
        from transformers import AutoModel
        self.model = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True)

    def transcribe(self, path: Path, language: str) -> str | None:
        import torchaudio
        wav, sr = torchaudio.load(str(path))
        wav = wav.mean(dim=0, keepdim=True)
        if sr != 16000:
            wav = torchaudio.functional.resample(wav, sr, 16000)
        if language == "en":
            return None   # IndicConformer covers Indian languages only
        return self.model(wav, language, "rnnt")


def make_engine(spec: str):
    if spec == "indicconformer":
        return IndicConformer()
    if spec.startswith("whisper:"):
        return Whisper(spec[len("whisper:"):])
    raise SystemExit(f"Unknown engine {spec!r}: use whisper:<model> or indicconformer")


# ---------- main ----------

def audio_seconds(path: Path) -> float:
    from audio import SAMPLE_RATE, load_audio
    return len(load_audio(str(path))) / SAMPLE_RATE


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--engine", action="append", required=True)
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.folder / "references.csv", encoding="utf-8-sig")))
    missing = [r["file"] for r in rows if not (args.folder / r["file"]).exists()]
    if missing:
        sys.exit(f"Missing audio files: {', '.join(missing[:10])}")
    durations = {r["file"]: audio_seconds(args.folder / r["file"]) for r in rows}

    out_path = args.folder / f"results-{time.strftime('%Y%m%d-%H%M%S')}.csv"
    totals: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0, 0, 0, 0, 0.0, 0.0, 0])
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["engine", "file", "language", "reference", "hypothesis", "wer", "cer", "seconds", "audio_seconds"])
        for spec in args.engine:
            engine = make_engine(spec)
            for r in rows:
                t0 = time.monotonic()
                hyp = engine.transcribe(args.folder / r["file"], r["language"])
                took = time.monotonic() - t0
                if hyp is None:
                    continue
                we, wn, ce, cn = error_rates(r["reference"], hyp)
                t = totals[(engine.name, r["language"])]
                t[0] += we; t[1] += wn; t[2] += ce; t[3] += cn; t[4] += took; t[5] += durations[r["file"]]; t[6] += 1
                w.writerow([engine.name, r["file"], r["language"], r["reference"], hyp,
                            round(we / max(wn, 1), 3), round(ce / max(cn, 1), 3), round(took, 2), round(durations[r["file"]], 2)])
                print(f"{engine.name:40} {r['file']:30} WER {we / max(wn, 1):5.1%}", flush=True)

    print(f"\n{'engine':40} {'lang':5} {'clips':>5} {'WER':>7} {'CER':>7} {'speed':>9}")
    best: dict[str, tuple[float, str]] = {}
    for (name, lang), (we, wn, ce, cn, took, audio, n) in sorted(totals.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        wer, cer = we / max(wn, 1), ce / max(cn, 1)
        print(f"{name:40} {lang:5} {n:5} {wer:7.1%} {cer:7.1%} {audio / took if took else 0:7.1f}x")
        if lang not in best or wer < best[lang][0]:
            best[lang] = (wer, name)
    print("\nBest per language (lowest WER): " + ", ".join(f"{lang}: {name} ({wer:.1%})" for lang, (wer, name) in sorted(best.items())))
    print(f"Every transcript: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
