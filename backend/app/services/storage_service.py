"""Utilities for Azure Blob uploads and SAS generation."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Tuple

from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    generate_blob_sas,
)

CONNECTION_STRING = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
ACCOUNT_NAME = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
CONTAINER_NAME = os.getenv("AZURE_BLOB_CONTAINER", "videos")
SAS_EXP_MINUTES = int(os.getenv("AZURE_BLOB_SAS_EXP_MINUTES", "60"))


def _parse_account_key(conn_str: str) -> str:
    """Extract AccountKey from connection string."""
    if not conn_str:
        raise ValueError("Missing AZURE_STORAGE_CONNECTION_STRING")
    parts = conn_str.split(";")
    for p in parts:
        if p.startswith("AccountKey="):
            return p.split("=", 1)[1]
    raise ValueError("AccountKey not found in connection string")


def _ensure_container(service_client: BlobServiceClient, container: str) -> None:
    container_client = service_client.get_container_client(container)
    try:
        container_client.create_container()
    except Exception:
        # ignore if already exists or cannot create (Azurite already present)
        pass


def generate_blob_name(video_id: str, filename: str | None = None) -> str:
    """Create a blob name using video_id and optional original extension."""
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[1]
        return f"{video_id}.{ext}"
    return f"{video_id}.mp4"


async def generate_upload_sas(video_id: str | None = None, filename: str | None = None) -> Tuple[str, str, str, datetime]:
    """
    Generate a write-only SAS URL for a single blob.

    Returns:
        upload_url: full SAS URL for direct upload
        blob_url: public blob URL (without SAS)
        expiry: datetime in UTC
    """
    vid = video_id or str(uuid.uuid4())

    if not CONNECTION_STRING:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is required to generate SAS")

    blob_name = generate_blob_name(vid, filename)
    account_key = _parse_account_key(CONNECTION_STRING)
    expiry = datetime.now(timezone.utc) + timedelta(minutes=SAS_EXP_MINUTES)

    # Detect Azurite vs Azure
    is_azurite = "devstoreaccount1" in ACCOUNT_NAME.lower()
    
    # Generate SAS token (works for both Azurite and Azure)
    sas_token = generate_blob_sas(
        account_name=ACCOUNT_NAME,
        container_name=CONTAINER_NAME,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(write=True, create=True),
        expiry=expiry,
    )

    if is_azurite:
        # Azurite: extract BlobEndpoint from connection string
        # For local dev: http://localhost:10000/devstoreaccount1
        # For Docker: http://azurite:10000/devstoreaccount1
        blob_endpoint = "http://localhost:10000/devstoreaccount1"  # Default for local
        for part in CONNECTION_STRING.split(";"):
            if part.startswith("BlobEndpoint="):
                blob_endpoint = part.split("=", 1)[1]
                break
        blob_url = f"{blob_endpoint}/{CONTAINER_NAME}/{blob_name}"
    else:
        # Production Azure: use HTTPS
        blob_url = f"https://{ACCOUNT_NAME}.blob.core.windows.net/{CONTAINER_NAME}/{blob_name}"
    
    upload_url = f"{blob_url}?{sas_token}"
    return vid, upload_url, blob_url, expiry


