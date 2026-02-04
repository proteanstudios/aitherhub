# audio_pipeline.py
import os
import time
import random
import subprocess
import requests
from decouple import config


# =========================
# ENV
# =========================

def env(key, default=None):
    return os.getenv(key) or config(key, default=default)


AUDIO_OUT_ROOT = "audio"
AUDIO_TEXT_ROOT = "audio_text"

FFMPEG_BIN = env("FFMPEG_PATH", "ffmpeg")
CHUNK_SECONDS = 600

WHISPER_ENDPOINT = env("WHISPER_ENDPOINT")
AZURE_KEY = env("AZURE_OPENAI_KEY")

MAX_RETRY = 10
SLEEP_BETWEEN_REQUESTS = 2


# =========================
# STEP 3.1 – EXTRACT AUDIO
# =========================

# def extract_audio_chunks(video_path: str, out_dir: str) -> str:
#     """
#     Extract audio chunks into out_dir.
#     out_dir should be: Z:\\work\\<video_id>\\audio
#     """
#     os.makedirs(out_dir, exist_ok=True)

#     chunk_pattern = os.path.join(out_dir, "chunk_%03d.mp3")

#     subprocess.run(
#         [
#             FFMPEG_BIN, "-y",
#             "-i", video_path,
#             "-vn",
#             "-f", "segment",
#             "-segment_time", str(CHUNK_SECONDS),
#             "-reset_timestamps", "1",
#             "-ac", "1",
#             "-ar", "16000",
#             "-ab", "64k",
#             "-codec:a", "libmp3lame",
#             chunk_pattern
#         ],
#         stdout=subprocess.DEVNULL,
#         stderr=subprocess.DEVNULL
#     )


#     return out_dir

def extract_audio_chunks(video_path: str, out_dir: str) -> str:
    """
    Extract audio chunks into out_dir.
    WAV, mono, 16kHz – safe for Whisper
    """
    os.makedirs(out_dir, exist_ok=True)

    chunk_pattern = os.path.join(out_dir, "chunk_%03d.wav")

    subprocess.run(
        [
            FFMPEG_BIN, "-y",
            "-i", video_path,
            "-map", "0:a:0",          # <<< QUAN TRỌNG: chọn audio stream đầu
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
# STEP 3.2 – TRANSCRIBE
# =========================

# def transcribe_audio_chunks(audio_dir: str):

def transcribe_audio_chunks(audio_dir: str, text_dir: str):
    os.makedirs(text_dir, exist_ok=True)

    files = sorted([
        f for f in os.listdir(audio_dir)
        if f.startswith("chunk_") and f.endswith(".wav")
    ])

    for f in files:
        audio_path = os.path.join(audio_dir, f)
        txt_path = os.path.join(text_dir, f.replace(".wav", ".txt"))

        print(f"[AZURE Whisper] {audio_path}")

        # ---------- RETRY LOOP ----------
        for attempt in range(1, MAX_RETRY + 1):

            with open(audio_path, "rb") as audio_file:
                audio_data = audio_file.read()

            print(f"[WHISPER] Sending {f}, attempt {attempt}/{MAX_RETRY}")
            t0 = time.time()

            try:
                response = requests.post(
                    WHISPER_ENDPOINT,
                    headers={"api-key": AZURE_KEY},

                    files={
                        "file": (f, audio_data, "audio/wav"),
                        "response_format": (None, "verbose_json"),
                        "timestamp_granularities[]": (None, "word"),
                        "timestamp_granularities[]": (None, "segment"),
                        "temperature": (None, "0"),
                        "task": (None, "transcribe"),
                        "language": (None, "ja"),
                    },

                    timeout=120,   # <<< QUAN TRỌNG: chống treo vô hạn
                )
                print(f"[WHISPER] Done {f} in {time.time() - t0:.1f}s status={response.status_code}")

            except Exception as e:
                print(f"[WHISPER][ERROR] {f} failed after {time.time() - t0:.1f}s: {e}")
                time.sleep(5)
                continue

            # SUCCESS
            if response.status_code == 200:
                data = response.json()

                chunk_index = int(f.split("_")[1].split(".")[0])
                offset = chunk_index * CHUNK_SECONDS

                with open(txt_path, "w", encoding="utf-8") as out:
                    out.write("[TEXT]\n")
                    out.write(data.get("text", ""))

                    out.write("\n\n[TIMELINE]\n")
                    for seg in data.get("segments", []):
                        start = seg["start"] + offset
                        end = seg["end"] + offset
                        out.write(
                            f"{start:.2f}s → {end:.2f}s : {seg['text']}\n"
                        )

                print(f"[OK] Saved → {txt_path}")
                break

            # RATE LIMIT
            if response.status_code == 429:
                wait_time = 5 * attempt + random.uniform(1, 3)
                print(
                    f"[WAIT] 429 rate limit → retry #{attempt} "
                    f"after {wait_time:.1f}s"
                )
                time.sleep(wait_time)
                continue

            # OTHER ERROR
            print("ERROR:", response.text)
            break

        # ---------- THROTTLE ----------
        print(f"[SLEEP] {SLEEP_BETWEEN_REQUESTS}s to avoid quota")
        time.sleep(SLEEP_BETWEEN_REQUESTS)
