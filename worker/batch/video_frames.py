# video_frames.py
import os
import cv2
import numpy as np
import subprocess
from decouple import config


def env(key, default=None):
    return os.getenv(key) or config(key, default=default)

FFMPEG_BIN = env("FFMPEG_PATH", "ffmpeg")

# ======================================================
# STEP 0 – EXTRACT FRAMES
# ======================================================



# def extract_frames(
#     video_path: str,
#     fps: int = 1,
#     frames_root: str = "frames",
# ) -> str:
#     """
#     STEP 0 – Extract frames from video
#     """
#     video_name = os.path.splitext(os.path.basename(video_path))[0]
#     # out_dir = os.path.join(frames_root, video_name)
#     out_dir = os.path.join(frames_root, "frames")
#     os.makedirs(out_dir, exist_ok=True)

#     cap = cv2.VideoCapture(video_path)
#     _video_fps = cap.get(cv2.CAP_PROP_FPS) 

#     sec = 0
#     idx = 0

#     while cap.isOpened():
#         cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
#         ret, frame = cap.read()
#         if not ret:
#             break

#         out_path = os.path.join(
#             out_dir,
#             f"frame_{idx:04d}_{sec}s.jpg"
#         )
#         cv2.imwrite(out_path, frame)

#         sec += fps
#         idx += 1

#     cap.release()
#     print(f"[OK][STEP 0] Frames extracted → {out_dir}")
#     return out_dir

def extract_frames(
    video_path: str,
    fps: int = 1,
    frames_root: str = "frames",
) -> str:
    """
    STEP 0 – Extract frames from video (FFmpeg, fastest CPU)

    - Decode video 1 lần
    - Không seek
    - Không loop Python
    - Output frame_%08d.jpg (safe for very long video)
    - Pipeline phía sau chỉ cần sorted(os.listdir)
    """
    out_dir = os.path.join(frames_root, "frames")
    os.makedirs(out_dir, exist_ok=True)

    subprocess.run(
        [
            FFMPEG_BIN, "-y",
            "-i", video_path,
            "-vf", f"fps={fps}",
            "-vsync", "0",
            os.path.join(out_dir, "frame_%08d.jpg"),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    print(f"[OK][STEP 0][FFMPEG] Frames extracted → {out_dir}")
    return out_dir


# ======================================================
# STEP 1 – PHASE DETECTION
# ======================================================

# ---------- 1.1 SCORE FUNCTIONS ----------

def hist_diff_score(img1, img2):
    img1_hsv = cv2.cvtColor(img1, cv2.COLOR_BGR2HSV)
    img2_hsv = cv2.cvtColor(img2, cv2.COLOR_BGR2HSV)

    hist1 = cv2.calcHist([img1_hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
    hist2 = cv2.calcHist([img2_hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])

    cv2.normalize(hist1, hist1)
    cv2.normalize(hist2, hist2)

    return cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)


def absdiff_score(img1, img2):
    img1_small = cv2.resize(img1, (256, 256))
    img2_small = cv2.resize(img2, (256, 256))

    diff = cv2.absdiff(img1_small, img2_small)
    gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)

    _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    return np.sum(thresh > 0)


# ---------- UTILS ----------

def normalize(arr):
    arr = np.array(arr, dtype=np.float32)
    if np.max(arr) - np.min(arr) == 0:
        return np.zeros_like(arr)
    return (arr - np.min(arr)) / (np.max(arr) - np.min(arr))


def moving_average(arr, k=5):
    arr = np.array(arr, dtype=np.float32)
    if len(arr) < k:
        return arr
    return np.convolve(arr, np.ones(k) / k, mode="same")


def peak_detect(arr, th):
    peaks = []
    for i in range(1, len(arr) - 1):
        if arr[i] > arr[i - 1] and arr[i] > arr[i + 1] and arr[i] > th:
            peaks.append(i)
    return peaks


# ---------- 1.1 RAW SCORE ----------

def compute_raw_scores(frame_dir):
    files = sorted(os.listdir(frame_dir))
    hist_scores = []
    absdiff_scores = []

    prev = None
    for f in files:
        img = cv2.imread(os.path.join(frame_dir, f))
        if prev is not None:
            hist_scores.append(hist_diff_score(prev, img))
            absdiff_scores.append(absdiff_score(prev, img))
        prev = img

    return hist_scores, absdiff_scores


# ---------- 1.2 CANDIDATE DETECTION ----------

def detect_candidates(hist_scores, absdiff_scores):
    hist_norm = normalize(hist_scores)
    absdiff_norm = normalize(absdiff_scores)

    hist_inv = 1 - hist_norm
    mix = (hist_inv + absdiff_norm) / 2

    smooth = moving_average(mix, k=5)

    mean_val = np.mean(smooth)
    std_val = np.std(smooth)
    th = mean_val + std_val * 1.0

    peaks = peak_detect(smooth, th)
    return peaks


# ---------- 1.3 YOLO CONFIRM ----------

def yolo_compare(model, frame1, frame2):
    r1 = model(frame1)[0]
    r2 = model(frame2)[0]

    c1 = [model.names[int(b.cls)] for b in r1.boxes]
    c2 = [model.names[int(b.cls)] for b in r2.boxes]

    if set(c1) != set(c2):
        return True
    if len(c1) != len(c2):
        return True

    def total_area(r):
        area = 0
        for b in r.boxes.xyxy:
            x1, y1, x2, y2 = b
            area += (x2 - x1) * (y2 - y1)
        return area

    a1 = total_area(r1)
    a2 = total_area(r2)

    ratio = abs(a1 - a2) / (a1 + 1e-5)
    return ratio > 0.20


def confirm_boundaries(peaks, frame_dir, model):
    confirmed = []
    files = sorted(os.listdir(frame_dir))

    for p in peaks:
        if p <= 0 or p >= len(files):
            continue

        f0 = cv2.imread(os.path.join(frame_dir, files[p - 1]))
        f1 = cv2.imread(os.path.join(frame_dir, files[p]))

        if yolo_compare(model, f0, f1):
            confirmed.append(p)

    return confirmed


# ---------- 1.4 PHASE POST-PROCESS ----------

def merge_close_boundaries(indices, min_gap=3):
    if not indices:
        return []

    merged = [indices[0]]
    for x in indices[1:]:
        if x - merged[-1] >= min_gap:
            merged.append(x)
    return merged


# def filter_min_phase(indices, total_frames, min_len=25):
#     result = []
#     extended = [0] + indices + [total_frames - 1]
#     phase_len = np.diff(extended)

#     for i in range(1, len(extended) - 1):
#         if phase_len[i] >= min_len:
#             result.append(extended[i])

#     return result

def filter_min_phase(indices, total_frames, min_len=25):
    result = []
    extended = [0] + indices + [total_frames - 1]
    phase_len = np.diff(extended)

    for i in range(1, len(extended) - 1):
        if extended[i] < min_len:
            continue

        if phase_len[i] >= min_len:
            result.append(extended[i])

    return result



def apply_max_phase(indices, total_frames, max_len=150):
    result = []
    extended = [0] + indices + [total_frames - 1]

    for i in range(1, len(extended) - 1):
        start = extended[i - 1]
        end = extended[i]
        length = end - start

        if length > max_len:
            mid = (start + end) // 2
            result.append(mid)

        result.append(end)

    return sorted(list(set(result)))

def pick_representative_frames(model, phases, total_frames, frame_dir):
    files = sorted(os.listdir(frame_dir))
    reps = []

    extended = [0] + phases + [total_frames - 1]

    for i in range(1, len(extended)):
        start = extended[i - 1]
        end = extended[i]

        best_frame = start
        best_score = 0

        for f in range(start, end):
            img_path = os.path.join(frame_dir, files[f])
            img = cv2.imread(img_path)

            result = model(img)[0]

            score = 0
            for box in result.boxes:
                conf = float(box.conf)
                x1, y1, x2, y2 = box.xyxy[0]
                area = (x2 - x1) * (y2 - y1)
                score += conf * area

            if score > best_score:
                best_score = score
                best_frame = f

        reps.append(best_frame)

    return reps


# ---------- MAIN STEP 1 ENTRY ----------

def detect_phases(frame_dir: str, model):
    files = sorted(os.listdir(frame_dir))
    total_frames = len(files)

    hist_scores, absdiff_scores = compute_raw_scores(frame_dir)
    peaks = detect_candidates(hist_scores, absdiff_scores)
    confirmed = confirm_boundaries(peaks, frame_dir, model)

    merged = merge_close_boundaries(confirmed, min_gap=3)
    filtered = filter_min_phase(merged, total_frames, min_len=25)
    filtered = apply_max_phase(filtered, total_frames, max_len=150)

    # keyframes = filtered.copy()
    # rep_frames = filtered.copy()

    # return keyframes, rep_frames, total_frames
    keyframes = filtered.copy()
    rep_frames = pick_representative_frames(model, keyframes, total_frames, frame_dir)
    return keyframes, rep_frames, total_frames
