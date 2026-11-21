# Transcription worker (office GPU PCs)

Turns candidates' recorded answers into text on your own PCs, with free open-source models.
The PC only makes **outbound HTTPS** calls to the platform, so no office ports or VPN are needed.
Audio is downloaded to a temporary folder, transcribed, and deleted straight away.

## Recommended PC

- NVIDIA GPU with 8 GB memory or more (e.g. RTX 3060 12 GB / RTX 4060 Ti 16 GB), current NVIDIA driver
- Windows 10/11 or Ubuntu 22.04+, always on, wired internet
- Two PCs for redundancy: if one is off, the other takes every job; nothing is lost

## Install

1. Install Python 3.12 and, for NVIDIA GPUs, CUDA 12 + cuDNN 9 (see the faster-whisper README).
2. Copy this `worker` folder to the PC and, inside it:
   ```
   python -m venv .venv
   .venv\Scripts\activate            (Windows)   |   source .venv/bin/activate   (Linux)
   pip install -r requirements.txt
   ```
3. In the platform: **Super Admin → Workers → Register a transcription PC**. Copy the two lines it shows
   into a file named `.env` in this folder:
   ```
   PLATFORM_URL=https://interview.yourcompany.com
   WORKER_TOKEN=wk_…
   ```
4. Test it: `python transcribe_worker.py --once` (downloads the model on first run, about 1.6 GB).

## Run it as a service (restarts after crashes and reboots)

Ready-made files in `service/`:

| PC | File | Install |
|---|---|---|
| Windows | `install-windows.ps1` | Administrator PowerShell in the worker folder: `powershell -ExecutionPolicy Bypass -File service\install-windows.ps1` |
| Linux | `transcribe-worker.service` | Steps at the top of the file (`systemctl enable --now transcribe-worker`) |
| macOS | `com.interview.transcribe-worker.plist` | Steps at the top of the file (`launchctl load -w ...`) |

All three restart the worker after a crash and start it at boot. A worker that dies mid-answer loses
nothing: its lease expires and another worker (or the restarted one) picks the answer up again.

The Super Admin's Workers page shows each PC as Online/Offline, how many answers it did in the last
hour, and the queue. Disable a PC there to cut it off instantly (its jobs go back to the queue).

## Settings (`.env`)

| Setting | Default | Meaning |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | Main model (name or folder) |
| `MODEL_OVERRIDES` | — | Better model for some languages, e.g. `ta=/models/whisper-tamil-ct2` |
| `WHISPER_DEVICE` | `auto` | `cuda`, `cpu` or `auto` |
| `WHISPER_COMPUTE_TYPE` | `float16` (GPU) / `int8` (CPU) | Precision |
| `POLL_SECONDS` | `2` | How often to check for new answers when idle |
| `LANGUAGE_SWITCH_MIN` | `0.5` | The spoken language is detected before transcribing; if it differs from the one the candidate chose (e.g. chose English, answered in Hindi), it is used when at least this likely and twice as likely as the chosen one |
| `EXPECTED_LANGUAGES` | Indian languages + `en` | Languages an answer may switch to; anything else is treated as a misdetection |

## Day 3 accuracy test

Collect ~50 real answers per language with what was actually said typed out (`references.csv`, see the
top of `evaluate.py`), then compare engines:

```
python evaluate.py clips/ --engine whisper:large-v3-turbo --engine whisper:small --engine indicconformer
```

It prints word and character error rates per language and engine, and the fastest/most accurate choice.
IndicConformer needs a free Hugging Face account that has accepted its terms
(huggingface.co/ai4bharat/indic-conformer-600m-multilingual), `HF_TOKEN` set, and
`pip install torch torchaudio transformers onnxruntime`.
