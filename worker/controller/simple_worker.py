#!/usr/bin/env python3
"""Simple queue worker that polls Azure Queue and runs batch processing."""
import os
import sys
import json
import time
import subprocess
from pathlib import Path
from azure.storage.queue import QueueClient
from dotenv import load_dotenv

# Load .env from project root
project_root = Path(__file__).parent.parent.parent
load_dotenv(project_root / ".env")

# Add batch directory to path so we can import if needed
BATCH_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "batch"))
sys.path.insert(0, BATCH_DIR)


def get_queue_client():
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    queue_name = os.getenv("AZURE_QUEUE_NAME", "video-jobs")
    if not conn_str:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING required")
    return QueueClient.from_connection_string(conn_str, queue_name)


def poll_and_process():
    """Poll queue once and process a single message if available."""
    client = get_queue_client()
    
    # Receive 1 message with 5min visibility timeout
    messages = client.receive_messages(messages_per_page=1, visibility_timeout=300)
    
    for msg in messages:
        try:
            payload = json.loads(msg.content)
            print(f"[worker] Received job: {payload}")
            
            video_id = payload.get("video_id")
            blob_url = payload.get("blob_url")
            
            if not video_id or not blob_url:
                print("[worker] Invalid payload, skipping")
                client.delete_message(msg.id, msg.pop_receipt)
                return
            
            # Run batch process_video.py
            print(f"[worker] Starting batch for video_id={video_id}")
            cmd = [
                sys.executable,
                os.path.join(BATCH_DIR, "process_video.py"),
                "--video-id", video_id,
                "--blob-url", blob_url,
            ]
            
            result = subprocess.run(
                cmd,
                cwd=BATCH_DIR,
                env={**os.environ, "PYTHONPATH": BATCH_DIR},
                # Don't capture output, let it stream to terminal
            )
            
            if result.returncode == 0:
                print(f"[worker] Batch completed successfully for {video_id}")
            else:
                print(f"[worker] Batch failed for {video_id} with exit code {result.returncode}")
            
            # Delete message from queue (success or fail, avoid infinite retry)
            client.delete_message(msg.id, msg.pop_receipt)
            
        except Exception as e:
            print(f"[worker] Error processing message: {e}")
            # Don't delete on exception; message will reappear after visibility timeout


def main():
    print("[worker] Starting simple queue worker...")
    print(f"[worker] Queue: {os.getenv('AZURE_QUEUE_NAME', 'video-jobs')}")
    
    while True:
        try:
            poll_and_process()
            time.sleep(5)  # Poll every 5 seconds
        except KeyboardInterrupt:
            print("\n[worker] Shutting down...")
            break
        except Exception as e:
            print(f"[worker] Unexpected error: {e}")
            time.sleep(10)


if __name__ == "__main__":
    main()
