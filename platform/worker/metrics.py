"""Speech measurements used for the 'confidence' and 'fluency' scores.

These are measured from the audio, not judged by AI. Accent and grammar are never measured.
Note: Whisper tends to drop hesitation sounds ("um", "uh"), so filler counts are a lower bound.
"""

from __future__ import annotations

import re

PAUSE_SECONDS = 1.0        # a gap this long between words counts as a pause
LONG_PAUSE_SECONDS = 3.0   # and this long as a long pause

FILLERS = {
    "en": ["um", "umm", "uh", "uhh", "erm", "hmm", "like", "you know", "basically", "actually", "i mean"],
    "hi": ["मतलब", "यानी", "वो", "अं", "हम्म", "उम्म", "बेसिकली", "actually", "basically", "matlab"],
    "ta": ["அது வந்து", "வந்து", "அப்புறம்", "ம்ம்", "அதாவது", "basically", "actually"],
}


def _count(text: str, phrase: str) -> int:
    # Word-boundary match that also works for Indic scripts (no \b for combining marks).
    return len(re.findall(rf"(?<![\wऀ-෿]){re.escape(phrase)}(?![\wऀ-෿])", text, flags=re.IGNORECASE))


def speech_metrics(text: str, language: str, segments, words, duration: float) -> dict:
    speech = sum(max(0.0, s.end - s.start) for s in segments)
    gaps = [b.start - a.end for a, b in zip(words, words[1:])]
    if words:  # silence before the first word also counts (slow start)
        gaps.append(words[0].start)
    n_words = len(text.split())
    fillers = {f: c for f in FILLERS.get(language, FILLERS["en"]) if (c := _count(text, f))}
    return {
        "duration_seconds": round(duration, 2),
        "speech_seconds": round(speech, 2),
        "pause_count": sum(1 for g in gaps if g >= PAUSE_SECONDS),
        "long_pauses": sum(1 for g in gaps if g >= LONG_PAUSE_SECONDS),
        "words": n_words,
        "words_per_minute": round(n_words / (speech / 60), 1) if speech > 1 else 0.0,
        "filler_count": sum(fillers.values()),
        "fillers": fillers,
    }
