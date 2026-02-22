# audio_pipeline.py
import os
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from decouple import config


# =========================
# ENV
# =========================

def env(key, default=None):
    return os.getenv(key) or config(key, default=default)


AUDIO_OUT_ROOT = "audio"
AUDIO_TEXT_ROOT = "audio_text"

FFMPEG_BIN = env("FFMPEG_PATH", "ffmpeg")
CHUNK_SECONDS = 1800  # v5: 30-min chunks (was 600=10min) — fewer chunks = less overhead

# Whisper engine selection: "local" (faster-whisper) or "azure" (Azure API)
WHISPER_ENGINE = env("WHISPER_ENGINE", "local")

# Azure Whisper settings (used only when WHISPER_ENGINE="azure")
WHISPER_ENDPOINT = env("WHISPER_ENDPOINT", "")
AZURE_KEY = env("AZURE_OPENAI_KEY", "")

# Local Whisper settings (used only when WHISPER_ENGINE="local")
WHISPER_MODEL_SIZE = env("WHISPER_MODEL_SIZE", "large-v3")
WHISPER_DEVICE = env("WHISPER_DEVICE", "auto")          # "auto", "cuda", "cpu"
WHISPER_COMPUTE_TYPE = env("WHISPER_COMPUTE_TYPE", "auto")  # "auto", "float16", "int8_float16", "int8"
WHISPER_BEAM_SIZE = int(env("WHISPER_BEAM_SIZE", "5"))
WHISPER_LANGUAGE = env("WHISPER_LANGUAGE", "ja")

# v4: Parallel transcription workers (limited by GPU VRAM)
# T4 16GB: large-v3 uses ~4GB, so 2 parallel is safe; 3 might OOM
WHISPER_PARALLEL_WORKERS = int(env("WHISPER_PARALLEL_WORKERS", "2"))

MAX_RETRY = 10
SLEEP_BETWEEN_REQUESTS = 2


# =========================
# LOCAL WHISPER MODEL (lazy load)
# =========================

_whisper_model = None


def _get_whisper_model():
    """
    Lazy-load the faster-whisper model.
    Called once on first transcription, then cached.
    """
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    from faster_whisper import WhisperModel
    import torch

    # Auto-detect device
    if WHISPER_DEVICE == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = WHISPER_DEVICE

    # Auto-detect compute type
    if WHISPER_COMPUTE_TYPE == "auto":
        if device == "cuda":
            compute_type = "int8_float16"   # T4: best speed/VRAM balance
        else:
            compute_type = "int8"           # CPU: int8 is fastest
    else:
        compute_type = WHISPER_COMPUTE_TYPE

    print(f"[WHISPER-LOCAL] Loading model: {WHISPER_MODEL_SIZE}")
    print(f"[WHISPER-LOCAL] Device: {device}, Compute: {compute_type}")

    _whisper_model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=device,
        compute_type=compute_type,
    )

    print(f"[WHISPER-LOCAL] Model loaded successfully")
    return _whisper_model


# =========================
# STEP 3.1 – EXTRACT AUDIO (GPU-accelerated)
# =========================

def extract_audio_chunks(video_path: str, out_dir: str) -> str:
    """
    Extract audio chunks into out_dir.
    WAV, mono, 16kHz – safe for Whisper.
    v4: Uses GPU decode if available for faster extraction.
    """
    os.makedirs(out_dir, exist_ok=True)

    chunk_pattern = os.path.join(out_dir, "chunk_%03d.wav")

    subprocess.run(
        [
            FFMPEG_BIN, "-y",
            "-i", video_path,
            "-map", "0:a:0",
            "-vn",
            "-f", "segment",
            "-segment_time", str(CHUNK_SECONDS),
            "-reset_timestamps", "1",
            "-ac", "1",
            "-ar", "16000",
            chunk_pattern
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    return out_dir


# =========================
# STEP 3.2 – TRANSCRIBE (LOCAL)
# =========================

import threading

# Lock for thread-safe access to faster-whisper model
# faster-whisper with CTranslate2 is NOT thread-safe for concurrent inference
_whisper_lock = threading.Lock()


def _transcribe_chunk_local(audio_path: str, chunk_index: int) -> dict:
    """
    Transcribe a single audio chunk using local faster-whisper.
    Thread-safe: uses lock to serialize GPU access.

    Returns dict with:
      - "text": full transcription text
      - "segments": list of {start, end, text} dicts (absolute time with offset)
    """
    model = _get_whisper_model()
    offset = chunk_index * CHUNK_SECONDS

    t0 = time.time()
    print(f"[WHISPER-LOCAL] Transcribing chunk_{chunk_index:03d}.wav ...")

    # Lock for thread-safe model access
    with _whisper_lock:
        segments_iter, info = model.transcribe(
            audio_path,
            beam_size=WHISPER_BEAM_SIZE,
            language=WHISPER_LANGUAGE,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            word_timestamps=True,
        )

        # Consume the generator inside the lock (faster-whisper uses lazy evaluation)
        segments = []
        full_text_parts = []
        for seg in segments_iter:
            segments.append({
                "start": seg.start + offset,
                "end": seg.end + offset,
                "text": seg.text.strip(),
            })
            full_text_parts.append(seg.text.strip())

    elapsed = time.time() - t0
    print(
        f"[WHISPER-LOCAL] Done chunk_{chunk_index:03d}.wav "
        f"in {elapsed:.1f}s "
        f"(lang={info.language}, prob={info.language_probability:.2f}, "
        f"segments={len(segments)})"
    )

    return {
        "text": " ".join(full_text_parts),
        "segments": segments,
    }


# =========================
# STEP 3.2 – TRANSCRIBE (AZURE API) – fallback
# =========================

def _transcribe_chunk_azure(audio_path: str, chunk_index: int, filename: str) -> dict:
    """
    Transcribe a single audio chunk using Azure Whisper API.
    Kept as fallback when WHISPER_ENGINE="azure".

    Returns dict with:
      - "text": full transcription text
      - "segments": list of {start, end, text} dicts (absolute time with offset)
    """
    import requests as req
    import random

    offset = chunk_index * CHUNK_SECONDS

    for attempt in range(1, MAX_RETRY + 1):
        with open(audio_path, "rb") as audio_file:
            audio_data = audio_file.read()

        print(f"[WHISPER-AZURE] Sending {filename}, attempt {attempt}/{MAX_RETRY}")
        t0 = time.time()

        try:
            response = req.post(
                WHISPER_ENDPOINT,
                headers={"api-key": AZURE_KEY},
                files={
                    "file": (filename, audio_data, "audio/wav"),
                    "response_format": (None, "verbose_json"),
                    "timestamp_granularities[]": (None, "word"),
                    "timestamp_granularities[]": (None, "segment"),
                    "temperature": (None, "0"),
                    "task": (None, "transcribe"),
                    "language": (None, "ja"),
                },
                timeout=120,
            )
            print(f"[WHISPER-AZURE] Done {filename} in {time.time() - t0:.1f}s status={response.status_code}")

        except Exception as e:
            print(f"[WHISPER-AZURE][ERROR] {filename} failed after {time.time() - t0:.1f}s: {e}")
            time.sleep(5)
            continue

        # SUCCESS
        if response.status_code == 200:
            data = response.json()
            segments = []
            for seg in data.get("segments", []):
                segments.append({
                    "start": seg["start"] + offset,
                    "end": seg["end"] + offset,
                    "text": seg["text"].strip(),
                })
            return {
                "text": data.get("text", ""),
                "segments": segments,
            }

        # RATE LIMIT
        if response.status_code == 429:
            wait_time = 5 * attempt + random.uniform(1, 3)
            print(f"[WAIT] 429 rate limit → retry #{attempt} after {wait_time:.1f}s")
            time.sleep(wait_time)
            continue

        # OTHER ERROR
        print("ERROR:", response.text)
        break

    # All retries failed
    return {"text": "", "segments": []}


# =========================
# STEP 3.2 – TRANSCRIBE (UNIFIED ENTRY POINT)
# =========================

def transcribe_audio_chunks(audio_dir: str, text_dir: str, on_progress=None):
    """
    Transcribe all audio chunks in audio_dir, write results to text_dir.

    v4: Parallel transcription for local engine.
    - Local engine: uses ThreadPoolExecutor with WHISPER_PARALLEL_WORKERS threads
      (model access is serialized via lock, but I/O and pre/post processing overlap)
    - Azure engine: sequential with rate-limit throttle

    Output format is identical for both engines:
      [TEXT]
      <full transcription>

      [TIMELINE]
      0.00s → 3.50s : こんにちは
      3.50s → 7.20s : 今日は...

    on_progress(percent): optional callback for real-time progress (0-100)
    """
    os.makedirs(text_dir, exist_ok=True)

    files = sorted([
        f for f in os.listdir(audio_dir)
        if f.startswith("chunk_") and f.endswith(".wav")
    ])

    total_chunks = len(files)
    engine = WHISPER_ENGINE.lower()
    print(f"[TRANSCRIBE] Engine: {engine}, Chunks: {total_chunks}, Workers: {WHISPER_PARALLEL_WORKERS}")

    if engine == "local" and total_chunks > 1:
        # ---- PARALLEL LOCAL TRANSCRIPTION ----
        # Pre-load model before spawning threads
        _get_whisper_model()

        completed = [0]
        results_map = {}  # {chunk_index: result}

        def _process_chunk(f):
            audio_path = os.path.join(audio_dir, f)
            chunk_index = int(f.split("_")[1].split(".")[0])
            result = _transcribe_chunk_local(audio_path, chunk_index)
            results_map[chunk_index] = (f, result)

            completed[0] += 1
            if on_progress and total_chunks > 0:
                pct = min(int(completed[0] / total_chunks * 100), 100)
                on_progress(pct)

            return chunk_index

        with ThreadPoolExecutor(max_workers=WHISPER_PARALLEL_WORKERS) as pool:
            futures = [pool.submit(_process_chunk, f) for f in files]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as e:
                    print(f"[TRANSCRIBE][ERROR] Chunk failed: {e}")

        # Write results in order
        for f in files:
            chunk_index = int(f.split("_")[1].split(".")[0])
            if chunk_index not in results_map:
                continue
            _, result = results_map[chunk_index]
            txt_path = os.path.join(text_dir, f.replace(".wav", ".txt"))
            _write_transcription(txt_path, result)
            print(f"[OK] Saved → {txt_path}")

    else:
        # ---- SEQUENTIAL (Azure or single chunk) ----
        for idx, f in enumerate(files):
            audio_path = os.path.join(audio_dir, f)
            txt_path = os.path.join(text_dir, f.replace(".wav", ".txt"))
            chunk_index = int(f.split("_")[1].split(".")[0])

            if engine == "local":
                result = _transcribe_chunk_local(audio_path, chunk_index)
            else:
                result = _transcribe_chunk_azure(audio_path, chunk_index, f)

            _write_transcription(txt_path, result)
            print(f"[OK] Saved → {txt_path}")

            if on_progress and total_chunks > 0:
                pct = min(int((idx + 1) / total_chunks * 100), 100)
                on_progress(pct)

            if engine == "azure":
                print(f"[SLEEP] {SLEEP_BETWEEN_REQUESTS}s to avoid quota")
                time.sleep(SLEEP_BETWEEN_REQUESTS)


def _write_transcription(txt_path: str, result: dict):
    """Write transcription result to text file in standard format."""
    with open(txt_path, "w", encoding="utf-8") as out:
        out.write("[TEXT]\n")
        out.write(result.get("text", ""))

        out.write("\n\n[TIMELINE]\n")
        for seg in result.get("segments", []):
            out.write(
                f"{seg['start']:.2f}s → {seg['end']:.2f}s : {seg['text']}\n"
            )
