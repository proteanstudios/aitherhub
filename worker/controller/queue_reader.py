import json
import os
from azure.storage.queue import QueueClient
from azure.identity import DefaultAzureCredential
from loguru import logger


QUEUE_NAME = os.getenv("AZURE_QUEUE_NAME")
ACCOUNT_URL = f"https://{os.getenv('AZURE_STORAGE_ACCOUNT_NAME')}.queue.core.windows.net"


def get_queue_client():
    credential = DefaultAzureCredential()
    return QueueClient(
        account_url=ACCOUNT_URL,
        queue_name=QUEUE_NAME,
        credential=credential,
    )


def get_next_message():
    """
    Poll 1 message from Azure Queue
    Return dict or None
    """
    try:
        queue = get_queue_client()

        messages = queue.receive_messages(messages_per_page=1, visibility_timeout=300)
        for msg in messages:
            payload = json.loads(msg.content)

            queue.delete_message(msg.id, msg.pop_receipt)

            logger.info(f"Received job: {payload}")
            return payload

    except Exception as e:
        logger.error(f"Queue read error: {e}")

    return None
