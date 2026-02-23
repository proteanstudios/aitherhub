"""
TikTok Live Stream Service - checks live status and extracts stream info.
Lightweight version for the Backend API (no ffmpeg dependency).
"""
import json
import re
import logging
import httpx

logger = logging.getLogger(__name__)


class TikTokLiveService:
    """Service to interact with TikTok Live streams."""

    BASE_URL = "https://www.tiktok.com"
    WEBCAST_URL = "https://webcast.tiktok.com"
    TIKREC_API = "https://tikrec.com"

    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.tiktok.com/",
    }

    @classmethod
    def extract_username(cls, url: str) -> str:
        """Extract username from TikTok URL (handles short URLs too)."""
        # Handle short URLs
        if "vt.tiktok.com" in url or "vm.tiktok.com" in url:
            try:
                with httpx.Client(follow_redirects=False, headers=cls.HEADERS, timeout=10) as client:
                    resp = client.get(url)
                    if resp.status_code in (301, 302):
                        url = resp.headers.get("location", url)
            except Exception as e:
                logger.warning(f"Short URL redirect failed: {e}")

        # Standard live URL
        match = re.match(r"https?://(?:www\.)?tiktok\.com/@([^/]+)/live", url)
        if match:
            return match.group(1)

        # Any TikTok profile URL
        match = re.match(r"https?://(?:www\.)?tiktok\.com/@([^/?]+)", url)
        if match:
            return match.group(1)

        # From redirect content
        match = re.search(r"@([^/\"]+)/live", url)
        if match:
            return match.group(1)

        raise ValueError(f"Cannot extract username from URL: {url}")

    @classmethod
    async def get_room_id(cls, username: str) -> str | None:
        """Get room_id from username."""
        async with httpx.AsyncClient(headers=cls.HEADERS, timeout=10) as client:
            # Method 1: tikrec API
            try:
                resp = await client.get(
                    f"{cls.TIKREC_API}/tiktok/room/api/sign",
                    params={"unique_id": username},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    signed_path = data.get("signed_path")
                    if signed_path:
                        resp2 = await client.get(f"{cls.BASE_URL}{signed_path}")
                        if resp2.status_code == 200:
                            data2 = resp2.json()
                            room_id = (data2.get("data") or {}).get("user", {}).get("roomId")
                            if room_id and str(room_id) != "0":
                                return str(room_id)
            except Exception as e:
                logger.warning(f"tikrec method failed: {e}")

            # Method 2: Scrape
            try:
                resp = await client.get(f"{cls.BASE_URL}/@{username}/live")
                match = re.search(r'"roomId":"(\d+)"', resp.text)
                if match and match.group(1) != "0":
                    return match.group(1)
            except Exception as e:
                logger.warning(f"Scrape method failed: {e}")

        return None

    @classmethod
    async def check_live(cls, room_id: str) -> bool:
        """Check if a room is currently live."""
        async with httpx.AsyncClient(headers=cls.HEADERS, timeout=10) as client:
            try:
                resp = await client.get(
                    f"{cls.WEBCAST_URL}/webcast/room/check_alive/",
                    params={"aid": "1988", "room_ids": room_id},
                )
                data = resp.json()
                if "data" in data and len(data["data"]) > 0:
                    return data["data"][0].get("alive", False)
            except Exception as e:
                logger.warning(f"Live check failed: {e}")
        return False

    @classmethod
    async def get_stream_title(cls, room_id: str) -> str | None:
        """Get the stream title from room_id."""
        async with httpx.AsyncClient(headers=cls.HEADERS, timeout=10) as client:
            try:
                resp = await client.get(
                    f"{cls.WEBCAST_URL}/webcast/room/info/",
                    params={"aid": "1988", "room_id": room_id},
                )
                data = resp.json()
                return data.get("data", {}).get("title")
            except Exception as e:
                logger.warning(f"Get title failed: {e}")
        return None

    @classmethod
    async def check_and_get_info(cls, url: str) -> dict:
        """
        Full check: URL -> username -> room_id -> live status + title.
        Returns dict with keys: username, room_id, is_live, title
        """
        username = cls.extract_username(url)
        room_id = await cls.get_room_id(username)

        if not room_id:
            return {
                "username": username,
                "room_id": None,
                "is_live": False,
                "title": None,
            }

        is_live = await cls.check_live(room_id)
        title = await cls.get_stream_title(room_id) if is_live else None

        return {
            "username": username,
            "room_id": room_id,
            "is_live": is_live,
            "title": title,
        }
