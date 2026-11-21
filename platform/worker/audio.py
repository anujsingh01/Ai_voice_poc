"""Decodes any recording (WebM/Opus from Android, M4A/AAC from iPhone, WAV, MP3, OGG) to 16 kHz mono.

We decode with PyAV directly instead of faster-whisper's helper, which calls a PyAV option that newer
PyAV releases removed (open(..., metadata_errors=...)), so worker installs keep working as PyAV moves on.
"""

from __future__ import annotations

import av
import numpy as np

SAMPLE_RATE = 16000


def load_audio(path: str) -> np.ndarray:
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    with av.open(path) as container:
        for frame in container.decode(audio=0):
            chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
        chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0
