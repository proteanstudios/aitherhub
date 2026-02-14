"""
Embedding Service for aitherhub RAG system (v2 - Extended).

Converts text content (speech transcripts, visual descriptions, AI insights,
and sales/metrics data) into vector embeddings using OpenAI's
text-embedding-3-small model.

v2 Extensions:
- Sales context integration into embeddings
- Weighted combination of content and sales signals
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

# Lazy-initialized client to avoid import-time errors in test environments
_client = None


def _get_client() -> AzureOpenAI:
    """Get or create the Azure OpenAI client (lazy initialization)."""
    global _client
    if _client is None:
        _client = AzureOpenAI(
            api_key=AZURE_OPENAI_KEY,
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_version=EMBEDDING_API_VERSION,
        )
    return _client


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
        response = _get_client().embeddings.create(
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
    sales_context: str = "",
) -> List[float]:
    """
    Create a composite embedding from multiple analysis components.

    Combines speech transcript, visual context, phase type, AI insight,
    and sales/metrics context into a single text representation, then
    generates its embedding.

    The sales_context parameter enables similarity search to consider
    performance metrics alongside content analysis, allowing retrieval
    of past analyses with similar sales patterns.

    Parameters:
        speech_text: Transcribed speech content
        visual_context: Visual description from frame analysis
        phase_type: Classified phase type
        ai_insight: AI-generated insight
        sales_context: Formatted sales/metrics data string

    Returns:
        1536-dimensional embedding vector
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
    if sales_context:
        parts.append(f"Performance: {sales_context[:1500]}")

    combined_text = "\n".join(parts)
    return create_embedding(combined_text)
