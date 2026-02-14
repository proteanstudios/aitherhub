"""
Embedding Service for aitherhub RAG system.

Converts text content (speech transcripts, visual descriptions, AI insights)
into vector embeddings using OpenAI's text-embedding-3-small model.
These embeddings are stored in Qdrant for similarity search.
"""

import os
import logging
from typing import List
from openai import AzureOpenAI

logger = logging.getLogger("embedding_service")

# Use Azure OpenAI for consistency with report_pipeline.py
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY")
EMBEDDING_API_VERSION = os.getenv("EMBEDDING_API_VERSION", "2024-02-01")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

client = AzureOpenAI(
    api_key=AZURE_OPENAI_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=EMBEDDING_API_VERSION,
)


def create_embedding(text: str) -> List[float]:
    """
    Generate a vector embedding for the given text.

    The text is truncated to 8000 characters to stay within token limits.
    Returns a 1536-dimensional vector suitable for cosine similarity search.
    """
    if not text or not text.strip():
        logger.warning("Empty text provided for embedding, using placeholder")
        text = "empty content"

    # Truncate to avoid token limits
    truncated = text[:8000]

    try:
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=truncated,
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Failed to create embedding: {e}")
        raise


def create_analysis_embedding(
    speech_text: str,
    visual_context: str,
    phase_type: str = "",
    ai_insight: str = "",
) -> List[float]:
    """
    Create a composite embedding from multiple analysis components.

    Combines speech transcript, visual context, phase type, and AI insight
    into a single text representation, then generates its embedding.
    This composite approach ensures that similarity search considers
    all aspects of the analysis.
    """
    parts = []
    if phase_type:
        parts.append(f"Phase: {phase_type}")
    if speech_text:
        parts.append(f"Speech: {speech_text[:3000]}")
    if visual_context:
        parts.append(f"Visual: {visual_context[:2000]}")
    if ai_insight:
        parts.append(f"Insight: {ai_insight[:2000]}")

    combined_text = "\n".join(parts)
    return create_embedding(combined_text)
