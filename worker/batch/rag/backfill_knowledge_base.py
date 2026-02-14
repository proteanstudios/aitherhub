"""
Backfill Script for aitherhub Knowledge Base.

Re-processes past video analyses and stores them in the Qdrant
knowledge base with sales data. This script is used to build the
initial knowledge base from existing analysis results.

Usage:
    python scripts/backfill_knowledge_base.py --source azure
    python scripts/backfill_knowledge_base.py --source local --dir /path/to/analyses
    python scripts/backfill_knowledge_base.py --source api --api-url http://localhost:8000

Prerequisites:
    - Qdrant must be running and accessible
    - Azure Blob Storage credentials (for --source azure)
    - AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY for embeddings
"""

import os
import sys
import json
import logging
import argparse
from typing import Dict, List, Optional
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill")


def backfill_from_azure(container_name: str = "results"):
    """
    Backfill from Azure Blob Storage where analysis results are stored.

    Scans the results container for completed analyses and stores
    each one in the Qdrant knowledge base.
    """
    from azure.storage.blob import BlobServiceClient

    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection_string:
        logger.error("AZURE_STORAGE_CONNECTION_STRING not set")
        return

    blob_service = BlobServiceClient.from_connection_string(connection_string)
    container = blob_service.get_container_client(container_name)

    # List all analysis result blobs
    blobs = container.list_blobs(name_starts_with="analysis/")

    processed = 0
    errors = 0

    for blob in blobs:
        if not blob.name.endswith(".json"):
            continue

        try:
            blob_client = container.get_blob_client(blob.name)
            content = blob_client.download_blob().readall()
            analysis = json.loads(content)

            _store_analysis(analysis)
            processed += 1
            logger.info(f"Processed: {blob.name} ({processed})")

        except Exception as e:
            errors += 1
            logger.error(f"Failed to process {blob.name}: {e}")

    logger.info(
        f"Backfill complete: {processed} processed, {errors} errors"
    )


def backfill_from_local(directory: str):
    """
    Backfill from a local directory of analysis JSON files.

    Each JSON file should contain a complete analysis result
    with optional sales_data and set_products fields.
    """
    if not os.path.isdir(directory):
        logger.error(f"Directory not found: {directory}")
        return

    processed = 0
    errors = 0

    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".json"):
            continue

        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                analysis = json.load(f)

            _store_analysis(analysis)
            processed += 1
            logger.info(f"Processed: {filename} ({processed})")

        except Exception as e:
            errors += 1
            logger.error(f"Failed to process {filename}: {e}")

    logger.info(
        f"Backfill complete: {processed} processed, {errors} errors"
    )


def backfill_from_api(api_url: str):
    """
    Backfill by fetching past analyses from the aitherhub API.

    Queries the API for all completed analyses and stores them
    in the knowledge base.
    """
    import requests

    # Fetch list of completed analyses
    response = requests.get(f"{api_url}/api/v1/videos?status=completed&limit=1000")
    if response.status_code != 200:
        logger.error(f"Failed to fetch videos: {response.status_code}")
        return

    videos = response.json().get("videos", [])
    logger.info(f"Found {len(videos)} completed videos")

    processed = 0
    errors = 0

    for video in videos:
        video_id = video.get("id", "")
        try:
            # Fetch detailed analysis
            detail_response = requests.get(
                f"{api_url}/api/v1/videos/{video_id}/analysis"
            )
            if detail_response.status_code != 200:
                logger.warning(f"No analysis for video {video_id}")
                continue

            analysis = detail_response.json()
            analysis["video_id"] = video_id
            analysis["user_email"] = video.get("user_email", "")
            analysis["filename"] = video.get("filename", "")

            _store_analysis(analysis)
            processed += 1
            logger.info(f"Processed: {video_id} ({processed})")

        except Exception as e:
            errors += 1
            logger.error(f"Failed to process {video_id}: {e}")

    logger.info(
        f"Backfill complete: {processed} processed, {errors} errors"
    )


def _store_analysis(analysis: Dict):
    """
    Store a single analysis result in the knowledge base.

    Accepts various formats and normalizes them before storage.
    """
    from rag.knowledge_store import store_video_analysis

    video_id = analysis.get("video_id", analysis.get("id", ""))
    if not video_id:
        raise ValueError("No video_id found in analysis")

    # Extract phases from various formats
    phases = _extract_phases(analysis)
    if not phases:
        logger.warning(f"No phases found for video {video_id}")
        return

    # Extract sales data if available
    sales_data = analysis.get("sales_data", None)
    set_products = analysis.get("set_products", [])
    screen_metrics = analysis.get("screen_metrics", None)

    store_video_analysis(
        video_id=video_id,
        phases=phases,
        user_email=analysis.get("user_email", "backfill@aitherhub.com"),
        filename=analysis.get("filename", ""),
        total_duration=analysis.get("total_duration", 0.0),
        liver_id=analysis.get("liver_id", ""),
        liver_name=analysis.get("liver_name", ""),
        sales_data=sales_data,
        set_products=set_products,
        screen_metrics=screen_metrics,
        platform=analysis.get("platform", "tiktok"),
        stream_date=analysis.get("stream_date", ""),
        data_source=analysis.get("data_source", "clean"),
    )


def _extract_phases(analysis: Dict) -> List[Dict]:
    """
    Extract phase data from various analysis formats.

    Supports:
    - Direct "phases" array
    - "report" -> "phases" nested format
    - "pipeline_result" -> "labeled_phases" format
    """
    # Direct phases array
    if "phases" in analysis and isinstance(analysis["phases"], list):
        return analysis["phases"]

    # Nested report format
    if "report" in analysis:
        report = analysis["report"]
        if isinstance(report, dict) and "phases" in report:
            return report["phases"]

    # Pipeline result format
    if "pipeline_result" in analysis:
        result = analysis["pipeline_result"]
        if isinstance(result, dict):
            labeled = result.get("labeled_phases", [])
            if labeled:
                return labeled

    # Try to construct phases from flat data
    if "speech_text" in analysis or "visual_context" in analysis:
        return [{
            "phase_type": analysis.get("phase_type", "unknown"),
            "speech_text": analysis.get("speech_text", ""),
            "visual_context": analysis.get("visual_context", ""),
            "behavior_label": analysis.get("behavior_label", ""),
            "ai_insight": analysis.get("ai_insight", analysis.get("insight", "")),
        }]

    return []


def main():
    parser = argparse.ArgumentParser(
        description="Backfill aitherhub knowledge base from past analyses"
    )
    parser.add_argument(
        "--source",
        choices=["azure", "local", "api"],
        required=True,
        help="Source of past analyses",
    )
    parser.add_argument(
        "--dir",
        default="./analyses",
        help="Local directory for --source local",
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="API URL for --source api",
    )
    parser.add_argument(
        "--container",
        default="results",
        help="Azure container name for --source azure",
    )

    args = parser.parse_args()

    logger.info(f"Starting backfill from source: {args.source}")

    if args.source == "azure":
        backfill_from_azure(container_name=args.container)
    elif args.source == "local":
        backfill_from_local(directory=args.dir)
    elif args.source == "api":
        backfill_from_api(api_url=args.api_url)


if __name__ == "__main__":
    main()
