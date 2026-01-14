import json
import os
import logging
from typing import Any, Dict

from azure.storage.queue import QueueClient

logger = logging.getLogger(__name__)
if not logger.handlers:
    # Fallback basic config so logs appear in stdout if app didn't configure logging
    logging.basicConfig(level=logging.INFO)
logger.setLevel(logging.INFO)


def _get_queue_client() -> QueueClient:
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    queue_name = os.getenv("AZURE_QUEUE_NAME", "video-jobs")
    if not conn_str:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is required for queue messaging")

    # Light logging without leaking full secret
    account_name = None
    for part in conn_str.split(";"):
        if part.startswith("AccountName="):
            account_name = part.split("=", 1)[1]
            break
    logger.info(f"[queue] connect account={account_name} queue={queue_name}")

    client = QueueClient.from_connection_string(conn_str, queue_name)
    try:
        client.create_queue()
    except Exception:
        pass
    return client


async def enqueue_job(payload: Dict[str, Any]) -> None:
    """Push a job message to Azure Storage Queue.

    payload example:
    {
      "job_id": "uuid",
      "video_id": "uuid",
      "blob_url": "http://...",
      "original_filename": "file.mp4"
    }
    """
    client = _get_queue_client()
    message = json.dumps(payload, ensure_ascii=False)
    logger.info(f"[queue] enqueue len={len(message)} payload_keys={list(payload.keys())}")
    client.send_message(message)
    return None
