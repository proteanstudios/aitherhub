"""
AI Commander - Live Analysis API Endpoints

Receives real-time TikTok LIVE metrics from the Chrome extension
and returns AI-powered suggestions using OpenAI GPT.

POST /api/v1/live/ai/analyze  - Analyze current LIVE metrics and return suggestions
"""

import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.dependencies import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live/ai", tags=["Live AI Commander"])


# ── Request / Response Schemas ──────────────────────────────────────

class LiveMetricsSnapshot(BaseModel):
    metrics: dict = Field(default_factory=dict)
    previous_metrics: dict = Field(default_factory=dict)
    comments_count: int = 0
    recent_comments: List[dict] = Field(default_factory=list)
    products: List[dict] = Field(default_factory=list)
    traffic_sources: List[dict] = Field(default_factory=list)


class AiSuggestion(BaseModel):
    type: str  # 'suggestion', 'warning', 'danger', 'info'
    text: str
    action: Optional[str] = None  # Optional action button text


class AiAnalysisResponse(BaseModel):
    suggestions: List[AiSuggestion]
    analyzed_at: str


# ── OpenAI Integration ──────────────────────────────────────────────

async def analyze_with_openai(snapshot: LiveMetricsSnapshot) -> List[dict]:
    """
    Send LIVE metrics to OpenAI for analysis and get actionable suggestions.
    """
    try:
        from openai import OpenAI
        
        client = OpenAI()
        
        # Build context from metrics
        metrics = snapshot.metrics
        prev_metrics = snapshot.previous_metrics
        
        metrics_text = "\n".join([f"- {k}: {v}" for k, v in metrics.items()])
        prev_metrics_text = "\n".join([f"- {k}: {v}" for k, v in prev_metrics.items()]) if prev_metrics else "なし"
        
        comments_text = ""
        if snapshot.recent_comments:
            comments_text = "\n".join([
                f"- {c.get('username', '?')}: {c.get('content', '')}" 
                for c in snapshot.recent_comments[:15]
            ])
        
        products_text = ""
        if snapshot.products:
            products_text = "\n".join([
                f"- {p.get('name', '?')}: GMV={p.get('gmv', '0')}, 販売={p.get('sold', '0')}, クリック={p.get('clicks', '0')}, ピン留め={'はい' if p.get('pinned') else 'いいえ'}"
                for p in snapshot.products[:10]
            ])
        
        traffic_text = ""
        if snapshot.traffic_sources:
            traffic_text = "\n".join([
                f"- {s.get('channel', '?')}: GMV={s.get('gmv', '0')}, インプレッション={s.get('impressions', '0')}, 視聴={s.get('views', '0')}"
                for s in snapshot.traffic_sources
            ])

        prompt = f"""あなたはTikTok Shop LIVEコマースの専門AIアドバイザーです。
以下のリアルタイムデータを分析し、配信者に対して具体的で実行可能なアドバイスを3〜5個提供してください。

## 現在のメトリクス
{metrics_text if metrics_text else "データなし"}

## 前回のメトリクス（変化の比較用）
{prev_metrics_text}

## 最近のコメント（{snapshot.comments_count}件中最新15件）
{comments_text if comments_text else "コメントなし"}

## 商品パフォーマンス
{products_text if products_text else "商品データなし"}

## トラフィックソース
{traffic_text if traffic_text else "トラフィックデータなし"}

## 回答形式
各提案は以下のJSON配列形式で返してください。typeは "suggestion"（提案）、"warning"（注意）、"danger"（危険）、"info"（情報）のいずれかです。
actionは任意で、ボタンに表示するテキストです（例: "商品をピン留め"）。

```json
[
  {{"type": "suggestion", "text": "提案内容", "action": "アクションボタンテキスト"}},
  {{"type": "warning", "text": "注意内容"}},
  ...
]
```

重要なポイント:
- 視聴者数の変動、コメント率、商品クリック率に注目
- 具体的な数値を引用して提案する
- 日本語で回答
- 短く簡潔に（各提案は2-3文以内）
- 実行可能なアクションを含める
"""

        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
            temperature=0.7,
        )
        
        # Parse the response
        response_text = response.output_text if hasattr(response, 'output_text') else str(response)
        
        # Extract JSON from response
        import json
        import re
        
        # Try to find JSON array in the response
        json_match = re.search(r'\[[\s\S]*?\]', response_text)
        if json_match:
            suggestions = json.loads(json_match.group())
            return suggestions
        
        # Fallback: create a single suggestion from the text
        return [{
            "type": "info",
            "text": response_text[:300]
        }]
        
    except ImportError:
        logger.warning("OpenAI package not installed")
        return _generate_rule_based_suggestions(snapshot)
    except Exception as e:
        logger.error(f"OpenAI analysis failed: {e}")
        return _generate_rule_based_suggestions(snapshot)


def _generate_rule_based_suggestions(snapshot: LiveMetricsSnapshot) -> List[dict]:
    """
    Fallback: Generate suggestions based on simple rules when OpenAI is unavailable.
    """
    suggestions = []
    metrics = snapshot.metrics
    
    # Check viewer count
    viewers = _parse_number(metrics.get('current_viewers', '0'))
    if viewers < 50:
        suggestions.append({
            "type": "warning",
            "text": f"現在の視聴者数は{viewers}人です。視聴者を増やすために、商品の紹介やキャンペーンの告知を行いましょう。",
            "action": "商品を紹介する"
        })
    elif viewers > 200:
        suggestions.append({
            "type": "suggestion",
            "text": f"視聴者数が{viewers}人と好調です！今がセールスのチャンスです。人気商品をピン留めしましょう。",
            "action": "商品をピン留め"
        })
    
    # Check comment rate
    comment_rate = metrics.get('comment_rate', '')
    if comment_rate:
        rate_num = _parse_number(comment_rate.replace('%', ''))
        if rate_num < 5:
            suggestions.append({
                "type": "warning",
                "text": f"コメント率が{comment_rate}と低めです。視聴者に質問を投げかけて、エンゲージメントを高めましょう。",
            })
    
    # Check product clicks
    product_clicks = _parse_number(metrics.get('product_clicks', '0'))
    if product_clicks > 100:
        suggestions.append({
            "type": "info",
            "text": f"商品クリック数が{product_clicks}回に達しています。購入を促すために、限定セールや割引を提案しましょう。",
        })
    
    # Check tap-through rate
    ttr = metrics.get('tap_through_rate', '')
    if ttr:
        ttr_num = _parse_number(ttr.replace('%', ''))
        if ttr_num > 15:
            suggestions.append({
                "type": "suggestion",
                "text": f"タップスルー率が{ttr}と高いです。商品への関心が高まっています。今すぐ商品の詳細を紹介しましょう。",
            })
    
    # Comment analysis
    if snapshot.recent_comments:
        # Check for product-related comments
        product_mentions = sum(1 for c in snapshot.recent_comments 
                             if any(kw in c.get('content', '') for kw in ['値段', '価格', 'いくら', '買いたい', '欲しい', 'ほしい']))
        if product_mentions > 0:
            suggestions.append({
                "type": "suggestion",
                "text": f"コメントで{product_mentions}件の商品に関する質問があります。価格や特徴について回答しましょう。",
                "action": "コメントを確認"
            })
    
    # Default suggestion if none generated
    if not suggestions:
        suggestions.append({
            "type": "info",
            "text": "データを収集中です。メトリクスが蓄積されると、より具体的な提案が表示されます。",
        })
    
    return suggestions


def _parse_number(value: str) -> float:
    """Parse a number from a string, handling K, M, 万 suffixes."""
    if not value:
        return 0
    try:
        value = str(value).strip()
        value = value.replace(',', '').replace('円', '').replace('¥', '')
        if 'K' in value or 'k' in value:
            return float(value.replace('K', '').replace('k', '')) * 1000
        if 'M' in value or 'm' in value:
            return float(value.replace('M', '').replace('m', '')) * 1000000
        if '万' in value:
            return float(value.replace('万', '')) * 10000
        return float(value)
    except (ValueError, TypeError):
        return 0


# ── Endpoints ───────────────────────────────────────────────────────

@router.post("/analyze", response_model=AiAnalysisResponse)
async def analyze_live_metrics(
    request: LiveMetricsSnapshot,
    current_user=Depends(get_current_user),
):
    """
    Analyze current LIVE metrics and return AI-powered suggestions.
    Called by the Chrome extension's AI Commander panel.
    """
    logger.info(
        f"AI analysis requested by user {current_user['id']}: "
        f"metrics={len(request.metrics)} keys, "
        f"comments={request.comments_count}, "
        f"products={len(request.products)}"
    )
    
    try:
        suggestions = await analyze_with_openai(request)
    except Exception as e:
        logger.error(f"AI analysis failed: {e}")
        suggestions = _generate_rule_based_suggestions(request)
    
    return AiAnalysisResponse(
        suggestions=[AiSuggestion(**s) for s in suggestions],
        analyzed_at=datetime.now(timezone.utc).isoformat(),
    )
