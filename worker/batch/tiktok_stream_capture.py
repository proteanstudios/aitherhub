#!/usr/bin/env python3
"""
TikTok Live Stream Capture Module for AitherHub Worker.

Captures a TikTok live stream and saves it as a local video file,
then uploads to Azure Blob Storage for processing by the existing pipeline.

Usage:
    python tiktok_stream_capture.py --video-id <uuid> --live-url <tiktok_url> [--duration <seconds>]
"""
import os
import sys
import json
import re
import time
import logging
import argparse
import subprocess
import requests
from datetime import datetime
from pathlib import Path

# Setup logging
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "tiktok_capture.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("tiktok_capture")


class TikTokLiveExtractor:
    """Extract stream URLs from TikTok Live."""

    def __init__(self):
        self.BASE_URL = "https://www.tiktok.com"
        self.WEBCAST_URL = "https://webcast.tiktok.com"
        self.TIKREC_API = "https://tikrec.com"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://www.tiktok.com/",
        })

    def extract_username_from_url(self, url: str) -> str:
        """Extract username from TikTok URL (handles short URLs too)."""
        if "vt.tiktok.com" in url or "vm.tiktok.com" in url:
            resp = self.session.get(url, allow_redirects=False, timeout=10)
            if resp.status_code in (301, 302):
                url = resp.headers.get("Location", url)
                logger.info(f"Redirected to: {url}")

        match = re.match(r"https?://(?:www\.)?tiktok\.com/@([^/]+)/live", url)
        if match:
            return match.group(1)

        match = re.search(r"@([^/\"]+)/live", url)
        if match:
            return match.group(1)

        # Try extracting username from non-live URL
        match = re.match(r"https?://(?:www\.)?tiktok\.com/@([^/?]+)", url)
        if match:
            return match.group(1)

        raise ValueError(f"Cannot extract username from URL: {url}")

    def get_room_id(self, username: str) -> str:
        """Get room_id from username."""
        logger.info(f"Getting room_id for @{username}...")

        # Method 1: tikrec API
        try:
            resp = self.session.get(
                f"{self.TIKREC_API}/tiktok/room/api/sign",
                params={"unique_id": username},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                signed_path = data.get("signed_path")
                if signed_path:
                    signed_url = f"{self.BASE_URL}{signed_path}"
                    resp2 = self.session.get(signed_url, timeout=10)
                    if resp2.status_code == 200:
                        data2 = resp2.json()
                        room_id = (data2.get("data") or {}).get("user", {}).get("roomId")
                        if room_id and str(room_id) != "0":
                            logger.info(f"Room ID (tikrec): {room_id}")
                            return str(room_id)
        except Exception as e:
            logger.warning(f"tikrec method failed: {e}")

        # Method 2: Direct page scrape
        try:
            resp = self.session.get(f"{self.BASE_URL}/@{username}/live", timeout=10)
            match = re.search(r'"roomId":"(\d+)"', resp.text)
            if match:
                room_id = match.group(1)
                if room_id != "0":
                    logger.info(f"Room ID (scrape): {room_id}")
                    return room_id
        except Exception as e:
            logger.warning(f"Scrape method failed: {e}")

        raise RuntimeError(f"Could not get room_id for @{username} - user may not be live")

    def is_live(self, room_id: str) -> bool:
        """Check if the room is currently live."""
        try:
            resp = self.session.get(
                f"{self.WEBCAST_URL}/webcast/room/check_alive/",
                params={"aid": "1988", "room_ids": room_id},
                timeout=10,
            )
            data = resp.json()
            if "data" in data and len(data["data"]) > 0:
                return data["data"][0].get("alive", False)
        except Exception as e:
            logger.warning(f"Live check failed: {e}")
        return False

    def get_stream_url(self, room_id: str) -> dict:
        """Get the stream URL (FLV/M3U8) from room_id."""
        logger.info(f"Getting stream URL for room {room_id}...")

        resp = self.session.get(
            f"{self.WEBCAST_URL}/webcast/room/info/",
            params={"aid": "1988", "room_id": room_id},
            timeout=10,
        )
        data = resp.json()

        result = {
            "room_id": room_id,
            "title": None,
            "flv_url": None,
            "audio_only_url": None,
        }

        room_data = data.get("data", {})
        result["title"] = room_data.get("title")
        stream_url = room_data.get("stream_url", {})

        # Try new SDK format
        sdk_data_str = (
            stream_url.get("live_core_sdk_data", {})
            .get("pull_data", {})
            .get("stream_data")
        )

        if sdk_data_str:
            sdk_data = json.loads(sdk_data_str).get("data", {})
            qualities = (
                stream_url.get("live_core_sdk_data", {})
                .get("pull_data", {})
                .get("options", {})
                .get("qualities", [])
            )
            level_map = {q["sdk_key"]: q for q in qualities}

            best_level = -1
            for sdk_key, entry in sdk_data.items():
                q_info = level_map.get(sdk_key, {})
                level = q_info.get("level", -1)
                name = q_info.get("name", sdk_key)
                stream_main = entry.get("main", {})

                # Audio only
                if name == "ao" or level == -1:
                    result["audio_only_url"] = stream_main.get("flv")
                    continue

                if level > best_level:
                    best_level = level
                    result["flv_url"] = stream_main.get("flv")

        # Fallback to legacy format
        if not result["flv_url"]:
            flv_pull = stream_url.get("flv_pull_url", {})
            result["flv_url"] = (
                flv_pull.get("FULL_HD1")
                or flv_pull.get("HD1")
                or flv_pull.get("SD2")
                or flv_pull.get("SD1")
            )

        return result

    def extract(self, url: str) -> dict:
        """Main extraction: URL -> stream info."""
        username = self.extract_username_from_url(url)
        logger.info(f"Username: @{username}")

        room_id = self.get_room_id(username)
        alive = self.is_live(room_id)
        logger.info(f"Live status: {'LIVE' if alive else 'OFFLINE'}")

        if not alive:
            return {
                "status": "offline",
                "username": username,
                "room_id": room_id,
            }

        stream_info = self.get_stream_url(room_id)
        stream_info["username"] = username
        stream_info["status"] = "live"
        return stream_info


def capture_stream(
    stream_url: str,
    output_path: str,
    duration: int = 0,
    use_gpu: bool = False,
) -> bool:
    """
    Capture a live stream using ffmpeg.

    Args:
        stream_url: FLV stream URL
        output_path: Local path to save the video
        duration: Max duration in seconds (0 = until stream ends)
        use_gpu: Whether to use GPU decoding
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    cmd = ["ffmpeg", "-y"]

    # Input
    cmd.extend([
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "30",
        "-i", stream_url,
    ])

    # Duration limit
    if duration > 0:
        cmd.extend(["-t", str(duration)])

    # Copy streams (no re-encoding)
    cmd.extend(["-c", "copy", output_path])

    logger.info(f"Starting ffmpeg capture: {' '.join(cmd[:6])}... -> {output_path}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=duration + 300 if duration > 0 else None,
        )
        if result.returncode == 0 or os.path.exists(output_path):
            file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            logger.info(f"Capture complete: {output_path} ({file_size / 1024 / 1024:.1f} MB)")
            return file_size > 0
        else:
            logger.error(f"ffmpeg failed: {result.stderr[-500:]}")
            return False
    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg timeout - stream may have ended")
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        logger.error(f"Capture error: {e}")
        return False


def upload_to_blob(local_path: str, email: str, video_id: str) -> str:
    """Upload captured video to Azure Blob Storage."""
    from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
    from datetime import timedelta

    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "videos")

    if not conn_str:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING required")

    blob_service = BlobServiceClient.from_connection_string(conn_str)
    blob_name = f"{email}/{video_id}/{video_id}.mp4"
    blob_client = blob_service.get_blob_client(container=container, blob=blob_name)

    file_size = os.path.getsize(local_path)
    logger.info(f"Uploading {file_size / 1024 / 1024:.1f} MB to blob: {blob_name}")

    with open(local_path, "rb") as f:
        blob_client.upload_blob(f, overwrite=True)

    # Generate SAS URL for worker to download
    account_name = blob_service.account_name
    account_key = None
    for part in conn_str.split(";"):
        if part.startswith("AccountKey="):
            account_key = part.split("=", 1)[1]
            break

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.utcnow() + timedelta(hours=24),
    )

    blob_url = f"https://{account_name}.blob.core.windows.net/{container}/{blob_name}?{sas_token}"
    logger.info(f"Upload complete. Blob URL generated.")
    return blob_url


def enqueue_video_job(video_id: str, blob_url: str, user_id: str, original_filename: str):
    """Enqueue a video processing job to Azure Queue."""
    from azure.storage.queue import QueueClient

    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    queue_name = os.getenv("AZURE_QUEUE_NAME", "video-jobs")

    if not conn_str:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING required")

    client = QueueClient.from_connection_string(conn_str, queue_name)

    payload = {
        "video_id": video_id,
        "blob_url": blob_url,
        "original_filename": original_filename,
        "user_id": user_id,
        "upload_type": "live_capture",
    }

    client.send_message(json.dumps(payload, ensure_ascii=False))
    logger.info(f"Enqueued video job: video_id={video_id}")


def main():
    parser = argparse.ArgumentParser(description="Capture TikTok Live Stream")
    parser.add_argument("--video-id", dest="video_id", type=str, required=True,
                        help="UUID for this video in the database")
    parser.add_argument("--live-url", dest="live_url", type=str, required=True,
                        help="TikTok live URL or username")
    parser.add_argument("--duration", type=int, default=0,
                        help="Max recording duration in seconds (0 = until stream ends)")
    parser.add_argument("--email", type=str, default="",
                        help="User email for blob storage path")
    parser.add_argument("--user-id", dest="user_id", type=str, default="",
                        help="User ID for queue payload")
    parser.add_argument("--skip-upload", dest="skip_upload", action="store_true",
                        help="Skip blob upload (for testing)")
    args = parser.parse_args()

    logger.info(f"=== TikTok Live Capture Start ===")
    logger.info(f"Video ID: {args.video_id}")
    logger.info(f"Live URL: {args.live_url}")
    logger.info(f"Max Duration: {args.duration}s" if args.duration else "Duration: until stream ends")

    # Step 1: Extract stream URL
    extractor = TikTokLiveExtractor()
    try:
        stream_info = extractor.extract(args.live_url)
    except Exception as e:
        logger.error(f"Failed to extract stream info: {e}")
        sys.exit(1)

    if stream_info.get("status") == "offline":
        logger.error(f"@{stream_info.get('username')} is not currently live")
        sys.exit(2)

    flv_url = stream_info.get("flv_url")
    if not flv_url:
        logger.error("No stream URL found")
        sys.exit(3)

    username = stream_info.get("username", "unknown")
    title = stream_info.get("title", "")
    logger.info(f"Stream found: @{username} - {title}")
    logger.info(f"FLV URL: {flv_url[:80]}...")

    # Step 2: Capture stream
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"tiktok_live_{username}_{timestamp}.mp4"
    output_dir = os.path.join("artifacts", args.video_id)
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, filename)

    success = capture_stream(
        stream_url=flv_url,
        output_path=output_path,
        duration=args.duration,
    )

    if not success:
        logger.error("Stream capture failed")
        sys.exit(4)

    # Step 3: Upload to blob (if not skipping)
    if not args.skip_upload:
        try:
            blob_url = upload_to_blob(output_path, args.email, args.video_id)
            logger.info("Blob upload successful")

            # Step 4: Enqueue for processing
            enqueue_video_job(
                video_id=args.video_id,
                blob_url=blob_url,
                user_id=args.user_id,
                original_filename=filename,
            )
            logger.info("Video job enqueued for processing")

            # Step 5: Clean up local capture file (already uploaded to blob)
            try:
                import shutil as _shutil
                if os.path.isdir(output_dir):
                    _shutil.rmtree(output_dir, ignore_errors=True)
                    logger.info(f"[CLEANUP] Removed local capture dir: {output_dir}")
            except Exception as ce:
                logger.warning(f"[CLEANUP] Could not remove {output_dir}: {ce}")

        except Exception as e:
            logger.error(f"Upload/enqueue failed: {e}")
            sys.exit(5)
    else:
        logger.info(f"Skip upload mode. File saved at: {output_path}")

    logger.info(f"=== TikTok Live Capture Complete ===")


if __name__ == "__main__":
    main()
