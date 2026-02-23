#!/usr/bin/env python3
"""
Real-time TikTok Live Monitor
Connects to a TikTok live stream via WebSocket, collects real-time metrics,
generates AI advice, and pushes updates to the backend API via SSE.
"""

import asyncio
import json
import logging
import os
import sys
import time
import argparse
from collections import deque
from datetime import datetime, timezone

import httpx

# ── logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("live_monitor")

# ── constants ────────────────────────────────────────────────────────
METRICS_INTERVAL = 5          # seconds between metric snapshots
ADVICE_INTERVAL = 45          # seconds between AI advice generation
ADVICE_COOLDOWN = 30          # minimum seconds between same-type advice
API_TIMEOUT = 10              # seconds for API calls
MAX_COMMENT_BUFFER = 200      # max comments to keep in memory
MAX_METRICS_HISTORY = 360     # 30 minutes of 5-second snapshots

# ── Advice trigger thresholds ────────────────────────────────────────
VIEWER_DROP_THRESHOLD = 0.15   # 15% drop in 2 minutes
COMMENT_SURGE_MULTIPLIER = 2.0 # 2x average comment rate
NO_ENGAGEMENT_TIMEOUT = 300    # 5 minutes no comments/gifts
GIFT_SURGE_MULTIPLIER = 3.0    # 3x average gift rate


class LiveMetricsCollector:
    """Collects and aggregates real-time metrics from TikTok live events."""

    def __init__(self):
        self.viewer_count = 0
        self.total_likes = 0
        self.total_comments = 0
        self.total_gifts = 0
        self.total_shares = 0
        self.total_gift_value = 0
        self.recent_comments = deque(maxlen=MAX_COMMENT_BUFFER)
        self.metrics_history = deque(maxlen=MAX_METRICS_HISTORY)
        self.last_advice_times = {}  # trigger_type -> timestamp
        self.start_time = time.time()

        # Per-interval counters (reset every METRICS_INTERVAL)
        self._interval_comments = 0
        self._interval_gifts = 0
        self._interval_likes = 0
        self._interval_shares = 0
        self._interval_gift_value = 0
        self._interval_top_comments = []

    def on_viewer_update(self, count: int):
        self.viewer_count = count

    def on_comment(self, username: str, text: str):
        self.total_comments += 1
        self._interval_comments += 1
        entry = {"user": username, "text": text, "ts": time.time()}
        self.recent_comments.append(entry)
        self._interval_top_comments.append(text)

    def on_gift(self, username: str, gift_name: str, value: int, count: int = 1):
        self.total_gifts += count
        self._interval_gifts += count
        self.total_gift_value += value * count
        self._interval_gift_value += value * count

    def on_like(self, count: int):
        self.total_likes += count
        self._interval_likes += count

    def on_share(self, count: int = 1):
        self.total_shares += count
        self._interval_shares += count

    def snapshot(self) -> dict:
        """Create a metrics snapshot and reset interval counters."""
        now = time.time()
        elapsed = now - self.start_time
        snap = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_seconds": int(elapsed),
            "viewer_count": self.viewer_count,
            "comments_in_interval": self._interval_comments,
            "gifts_in_interval": self._interval_gifts,
            "likes_in_interval": self._interval_likes,
            "shares_in_interval": self._interval_shares,
            "gift_value_in_interval": self._interval_gift_value,
            "total_comments": self.total_comments,
            "total_gifts": self.total_gifts,
            "total_likes": self.total_likes,
            "total_shares": self.total_shares,
            "total_gift_value": self.total_gift_value,
            "top_comments": self._interval_top_comments[-10:],  # last 10
        }
        self.metrics_history.append(snap)

        # Reset interval counters
        self._interval_comments = 0
        self._interval_gifts = 0
        self._interval_likes = 0
        self._interval_shares = 0
        self._interval_gift_value = 0
        self._interval_top_comments = []

        return snap

    # ── Trigger detection ────────────────────────────────────────────
    def detect_triggers(self) -> list[dict]:
        """Analyze metrics history and detect advice triggers."""
        triggers = []
        now = time.time()
        history = list(self.metrics_history)
        if len(history) < 6:  # need at least 30 seconds of data
            return triggers

        # 1. Viewer drop detection (last 2 minutes)
        if len(history) >= 24:  # 2 minutes of 5-second snapshots
            viewers_2min_ago = history[-24]["viewer_count"]
            current_viewers = history[-1]["viewer_count"]
            if viewers_2min_ago > 10 and current_viewers > 0:
                drop_pct = (viewers_2min_ago - current_viewers) / viewers_2min_ago
                if drop_pct >= VIEWER_DROP_THRESHOLD:
                    if self._can_trigger("viewer_drop", now):
                        triggers.append({
                            "type": "viewer_drop",
                            "urgency": "high",
                            "data": {
                                "viewer_change_pct": round(drop_pct * 100, 1),
                                "from": viewers_2min_ago,
                                "to": current_viewers,
                                "period": "2min",
                            },
                        })

        # 2. Comment surge detection (last 1 minute vs average)
        if len(history) >= 12:
            recent_comments = sum(h["comments_in_interval"] for h in history[-12:])
            avg_comments = sum(h["comments_in_interval"] for h in history[:-12]) / max(len(history) - 12, 1) * 12
            if avg_comments > 0 and recent_comments > avg_comments * COMMENT_SURGE_MULTIPLIER:
                if self._can_trigger("comment_surge", now):
                    triggers.append({
                        "type": "comment_surge",
                        "urgency": "medium",
                        "data": {
                            "recent_count": recent_comments,
                            "average_count": round(avg_comments, 1),
                            "multiplier": round(recent_comments / avg_comments, 1),
                        },
                    })

        # 3. No engagement detection (5 minutes)
        if len(history) >= 60:  # 5 minutes
            recent_engagement = sum(
                h["comments_in_interval"] + h["gifts_in_interval"]
                for h in history[-60:]
            )
            if recent_engagement == 0:
                if self._can_trigger("no_engagement", now):
                    triggers.append({
                        "type": "no_engagement",
                        "urgency": "high",
                        "data": {"period": "5min", "suggestion": "switch_product"},
                    })

        # 4. Gift surge detection
        if len(history) >= 12:
            recent_gifts = sum(h["gifts_in_interval"] for h in history[-12:])
            avg_gifts = sum(h["gifts_in_interval"] for h in history[:-12]) / max(len(history) - 12, 1) * 12
            if avg_gifts > 0 and recent_gifts > avg_gifts * GIFT_SURGE_MULTIPLIER:
                if self._can_trigger("gift_surge", now):
                    triggers.append({
                        "type": "gift_surge",
                        "urgency": "medium",
                        "data": {
                            "recent_count": recent_gifts,
                            "average_count": round(avg_gifts, 1),
                        },
                    })

        # 5. Viewer growth opportunity
        if len(history) >= 12:
            viewers_1min_ago = history[-12]["viewer_count"]
            current_viewers = history[-1]["viewer_count"]
            if viewers_1min_ago > 10:
                growth_pct = (current_viewers - viewers_1min_ago) / viewers_1min_ago
                if growth_pct >= 0.20:  # 20% growth in 1 minute
                    if self._can_trigger("viewer_growth", now):
                        triggers.append({
                            "type": "viewer_growth",
                            "urgency": "medium",
                            "data": {
                                "growth_pct": round(growth_pct * 100, 1),
                                "from": viewers_1min_ago,
                                "to": current_viewers,
                            },
                        })

        return triggers

    def _can_trigger(self, trigger_type: str, now: float) -> bool:
        last = self.last_advice_times.get(trigger_type, 0)
        if now - last < ADVICE_COOLDOWN:
            return False
        self.last_advice_times[trigger_type] = now
        return True

    def get_context_summary(self) -> str:
        """Build a context summary for GPT advice generation."""
        history = list(self.metrics_history)
        if not history:
            return "データ不足"

        latest = history[-1]
        elapsed_min = latest["elapsed_seconds"] // 60

        # Viewer trend
        viewer_trend = "安定"
        if len(history) >= 12:
            v_now = history[-1]["viewer_count"]
            v_1min = history[-12]["viewer_count"]
            if v_1min > 0:
                change = (v_now - v_1min) / v_1min * 100
                if change > 10:
                    viewer_trend = f"上昇中（+{change:.0f}%）"
                elif change < -10:
                    viewer_trend = f"下降中（{change:.0f}%）"

        # Comment rate
        recent_comments = sum(h["comments_in_interval"] for h in history[-12:]) if len(history) >= 12 else 0
        comment_rate = recent_comments / min(len(history[-12:]), 12) * 12  # per minute

        # Recent top comments
        top_comments = []
        for h in history[-6:]:
            top_comments.extend(h.get("top_comments", []))
        top_comments = top_comments[-15:]

        summary = f"""【ライブ配信状況】
- 配信経過時間: {elapsed_min}分
- 現在の視聴者数: {latest['viewer_count']}人
- 視聴者トレンド: {viewer_trend}
- 直近1分のコメント数: {recent_comments}件（平均 {comment_rate:.1f}件/分）
- 累計コメント: {latest['total_comments']}件
- 累計ギフト: {latest['total_gifts']}件（価値: {latest['total_gift_value']}）
- 累計いいね: {latest['total_likes']}件

【直近のコメント（最新15件）】
{chr(10).join(f'- {c}' for c in top_comments) if top_comments else '- なし'}
"""
        return summary


class AIAdvisor:
    """Generates real-time advice using GPT-4o-mini (supports Azure OpenAI)."""

    TRIGGER_PROMPTS = {
        "viewer_drop": """視聴者数が直近2分で{viewer_change_pct}%減少しました（{from}人→{to}人）。
配信者に対して、視聴者を引き留めるための具体的で即座に実行可能なアドバイスを1つ生成してください。""",

        "comment_surge": """コメント数が急増しています（通常の{multiplier}倍、直近1分で{recent_count}件）。
配信者に対して、このエンゲージメントの高まりを売上に繋げるための具体的なアドバイスを1つ生成してください。""",

        "no_engagement": """直近5分間、コメントもギフトもありません。エンゲージメントが完全に止まっています。
配信者に対して、視聴者の関心を取り戻すための具体的なアドバイスを1つ生成してください。""",

        "gift_surge": """ギフトが急増しています（通常の{multiplier:.1f}倍）。
配信者に対して、この好意的な雰囲気を活かすための具体的なアドバイスを1つ生成してください。""",

        "viewer_growth": """視聴者数が直近1分で{growth_pct}%増加しました（{from}人→{to}人）。
新しい視聴者が流入しています。配信者に対して、この機会を最大化するための具体的なアドバイスを1つ生成してください。""",
    }

    SYSTEM_PROMPT = """あなたはTikTokライブコマースの専門AIコーチです。
配信者にリアルタイムで具体的な行動指示を出します。

ルール：
1. アドバイスは1つだけ、30文字〜80文字で簡潔に
2. 「〜してください」「〜しましょう」ではなく「〜してください。」と断定的に
3. 抽象的な指示（「盛り上げて」「頑張って」）は絶対に禁止
4. 必ず具体的な行動を指示する（「価格を言う」「商品を見せる」「コメントを読む」等）
5. 数字や時間を含める（「30秒以内に」「3つの特徴を」等）
6. ライブコマースの売上最大化が最終目的

出力形式（JSON）：
{"message": "具体的なアドバイス文", "action_type": "price|product|engagement|switch|urgency"}
"""

    def __init__(self, api_key: str, api_base: str | None = None, use_azure: bool = False):
        self.api_key = api_key
        self.api_base = api_base or "https://api.openai.com/v1"
        self.use_azure = use_azure

    async def generate_advice(
        self, trigger: dict, context_summary: str
    ) -> dict | None:
        """Generate advice based on a trigger and context."""
        trigger_type = trigger["type"]
        prompt_template = self.TRIGGER_PROMPTS.get(trigger_type)
        if not prompt_template:
            return None

        trigger_prompt = prompt_template.format(**trigger["data"])
        user_prompt = f"""{context_summary}

【トリガー】
{trigger_prompt}

JSON形式で回答してください。"""

        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                if self.use_azure:
                    # Azure OpenAI format
                    url = f"{self.api_base}/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-08-01-preview"
                    headers = {
                        "api-key": self.api_key,
                        "Content-Type": "application/json",
                    }
                else:
                    # Standard OpenAI format
                    url = f"{self.api_base}/chat/completions"
                    headers = {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    }
                resp = await client.post(
                    url,
                    headers=headers,
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": self.SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        "temperature": 0.7,
                        "max_tokens": 200,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"].strip()

                # Parse JSON response
                # Handle markdown code blocks
                if content.startswith("```"):
                    content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

                advice_data = json.loads(content)
                return {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "type": "action",
                    "urgency": trigger["urgency"],
                    "trigger": trigger_type,
                    "message": advice_data.get("message", ""),
                    "action_type": advice_data.get("action_type", "engagement"),
                    "data": trigger["data"],
                }
        except Exception as e:
            logger.error(f"AI advice generation failed: {e}")
            return None


class TikTokLiveMonitor:
    """Main monitor that connects to TikTok live and orchestrates metrics + advice."""

    def __init__(
        self,
        unique_id: str,
        video_id: str,
        backend_url: str,
        worker_api_key: str,
        openai_api_key: str,
        openai_api_base: str | None = None,
        use_azure: bool = False,
    ):
        self.unique_id = unique_id
        self.video_id = video_id
        self.backend_url = backend_url.rstrip("/")
        self.worker_api_key = worker_api_key
        self.collector = LiveMetricsCollector()
        self.advisor = AIAdvisor(openai_api_key, openai_api_base, use_azure=use_azure)
        self.running = False
        self._stream_url = None

    async def start(self):
        """Start the live monitoring loop."""
        logger.info(f"Starting live monitor for @{self.unique_id} (video_id={self.video_id})")
        self.running = True

        # First, get the stream URL for frontend playback
        await self._fetch_stream_url()

        # Run metrics collection and advice generation concurrently
        await asyncio.gather(
            self._poll_tiktok_api_loop(),
            self._metrics_push_loop(),
            self._advice_loop(),
        )

    async def _fetch_stream_url(self):
        """Fetch the HLS/FLV stream URL for frontend playback."""
        try:
            # Use the existing TikTokLiveExtractor to get stream URL
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            from batch.tiktok_stream_capture import TikTokLiveExtractor

            extractor = TikTokLiveExtractor()
            info = extractor.extract(f"https://www.tiktok.com/@{self.unique_id}/live")
            self._stream_url = info.get("stream_url", "")

            if self._stream_url:
                logger.info(f"Stream URL obtained: {self._stream_url[:80]}...")
                # Push stream URL to backend
                await self._push_to_backend("stream_url", {
                    "stream_url": self._stream_url,
                    "username": self.unique_id,
                })
        except Exception as e:
            logger.error(f"Failed to get stream URL: {e}")

    async def _poll_tiktok_api_loop(self):
        """Poll TikTok API for viewer count and room info every 5 seconds."""
        # Use TikTok's webcast API to get room stats
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from batch.tiktok_stream_capture import TikTokLiveExtractor

        extractor = TikTokLiveExtractor()

        # Get room_id
        try:
            room_id = extractor.get_room_id(self.unique_id)
        except Exception as e:
            logger.error(f"Failed to get room_id: {e}")
            return

        logger.info(f"Room ID: {room_id}")

        while self.running:
            try:
                # Poll room info for viewer count
                url = f"https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id={room_id}"
                async with httpx.AsyncClient(
                    headers=extractor.session.headers if hasattr(extractor, 'session') else {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                    timeout=10,
                ) as client:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        data = resp.json()
                        room_data = data.get("data", {})

                        # Extract viewer count
                        user_count = room_data.get("user_count_str", "0")
                        try:
                            viewer_count = int(user_count.replace(",", ""))
                        except (ValueError, AttributeError):
                            # Handle "1.2K" format
                            if "K" in str(user_count).upper():
                                viewer_count = int(float(user_count.upper().replace("K", "")) * 1000)
                            elif "M" in str(user_count).upper():
                                viewer_count = int(float(user_count.upper().replace("M", "")) * 1000000)
                            else:
                                viewer_count = 0

                        self.collector.on_viewer_update(viewer_count)

                        # Extract like count
                        like_count = room_data.get("like_count", 0)
                        if like_count > self.collector.total_likes:
                            delta = like_count - self.collector.total_likes
                            self.collector.on_like(delta)

                        # Check if still live
                        status = room_data.get("status", 0)
                        if status != 2:  # 2 = live
                            logger.info("Stream ended. Stopping monitor.")
                            self.running = False
                            await self._push_to_backend("stream_ended", {
                                "message": "ライブ配信が終了しました",
                            })
                            break

            except Exception as e:
                logger.warning(f"TikTok API poll error: {e}")

            await asyncio.sleep(METRICS_INTERVAL)

    async def _metrics_push_loop(self):
        """Push metrics snapshots to the backend every METRICS_INTERVAL seconds."""
        while self.running:
            await asyncio.sleep(METRICS_INTERVAL)
            try:
                snap = self.collector.snapshot()
                await self._push_to_backend("metrics", snap)
                logger.debug(f"Metrics pushed: viewers={snap['viewer_count']}, comments={snap['comments_in_interval']}")
            except Exception as e:
                logger.warning(f"Metrics push error: {e}")

    async def _advice_loop(self):
        """Detect triggers and generate AI advice periodically."""
        await asyncio.sleep(30)  # Wait for initial data collection

        while self.running:
            try:
                triggers = self.collector.detect_triggers()
                for trigger in triggers:
                    context = self.collector.get_context_summary()
                    advice = await self.advisor.generate_advice(trigger, context)
                    if advice:
                        await self._push_to_backend("advice", advice)
                        logger.info(f"Advice generated: [{advice['trigger']}] {advice['message']}")
            except Exception as e:
                logger.warning(f"Advice loop error: {e}")

            await asyncio.sleep(ADVICE_INTERVAL)

    async def _push_to_backend(self, event_type: str, payload: dict):
        """Push an event to the backend API."""
        url = f"{self.backend_url}/api/v1/live/{self.video_id}/events"
        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                resp = await client.post(
                    url,
                    headers={
                        "X-Worker-Key": self.worker_api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "event_type": event_type,
                        "payload": payload,
                    },
                )
                if resp.status_code not in (200, 201, 202):
                    logger.warning(f"Backend push failed ({resp.status_code}): {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Backend push error: {e}")


def main():
    parser = argparse.ArgumentParser(description="TikTok Live Real-time Monitor")
    parser.add_argument("--unique-id", required=True, help="TikTok username (without @)")
    parser.add_argument("--video-id", required=True, help="Video ID in the database")
    parser.add_argument("--backend-url",
                        default=os.environ.get("BACKEND_API_URL", "https://aitherhubapi-cpcjcnezbgf5f7e2.japaneast-01.azurewebsites.net"),
                        help="Backend API URL")
    parser.add_argument("--worker-api-key", default=None, help="Worker API key for backend auth")
    parser.add_argument("--openai-api-key", default=None, help="OpenAI API key")
    parser.add_argument("--openai-api-base", default=None, help="OpenAI API base URL")
    args = parser.parse_args()

    # Support both standard OpenAI and Azure OpenAI
    use_azure = False
    azure_key = os.environ.get("AZURE_OPENAI_KEY", "")
    azure_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "")

    openai_key = args.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    openai_base = args.openai_api_base or os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")

    if azure_key and azure_endpoint:
        # Prefer Azure OpenAI if configured
        openai_key = azure_key
        # Extract base URL from endpoint (remove path after .com/)
        import re as _re
        base_match = _re.match(r'(https://[^/]+)', azure_endpoint)
        openai_base = base_match.group(1) if base_match else azure_endpoint
        use_azure = True
        logger.info(f"Using Azure OpenAI: {openai_base}")
    elif not openai_key or openai_key.startswith("your-"):
        logger.error("OPENAI_API_KEY or AZURE_OPENAI_KEY is required")
        sys.exit(1)

    worker_key = args.worker_api_key or os.environ.get("WORKER_API_KEY", "aitherhub-worker-internal-key-2026")

    monitor = TikTokLiveMonitor(
        unique_id=args.unique_id,
        video_id=args.video_id,
        backend_url=args.backend_url,
        worker_api_key=worker_key,
        openai_api_key=openai_key,
        openai_api_base=openai_base,
        use_azure=use_azure,
    )

    try:
        asyncio.run(monitor.start())
    except KeyboardInterrupt:
        logger.info("Monitor stopped by user")
    except Exception as e:
        logger.exception(f"Monitor crashed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
