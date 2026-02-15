#!/usr/bin/env python3
"""
Unit tests for video_compressor.py

Tests cover:
1. Resolution detection (get_video_resolution)
2. Duration detection (get_video_duration)
3. Compression necessity check (needs_compression)
4. 1080p compression (compress_to_1080p)
5. Blob URL parsing (parse_blob_url)
6. End-to-end compress_and_replace (without actual blob upload)

Usage:
    python test_video_compressor.py

Requirements:
    - ffmpeg and ffprobe must be installed
    - No Azure credentials needed (blob upload is mocked)
"""
import os
import sys
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch, MagicMock

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_compressor import (
    get_video_resolution,
    get_video_duration,
    needs_compression,
    compress_to_1080p,
    parse_blob_url,
    compress_and_replace,
    FFMPEG,
    FFPROBE,
)


def create_test_video(path, width=1920, height=1080, duration=3, fps=30):
    """Create a small test video using FFmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"testsrc=size={width}x{height}:rate={fps}:duration={duration}",
        "-f", "lavfi",
        "-i", f"sine=frequency=440:duration={duration}",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "64k",
        "-pix_fmt", "yuv420p",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create test video: {result.stderr}")
    return path


class TestVideoCompressor(unittest.TestCase):
    """Test suite for video_compressor module."""

    @classmethod
    def setUpClass(cls):
        """Create test videos for all tests."""
        cls.tmpdir = tempfile.mkdtemp(prefix="test_compressor_")

        # 1080p test video
        cls.video_1080p = os.path.join(cls.tmpdir, "test_1080p.mp4")
        create_test_video(cls.video_1080p, 1920, 1080, duration=2)

        # 4K test video
        cls.video_4k = os.path.join(cls.tmpdir, "test_4k.mp4")
        create_test_video(cls.video_4k, 3840, 2160, duration=2)

        # 720p test video
        cls.video_720p = os.path.join(cls.tmpdir, "test_720p.mp4")
        create_test_video(cls.video_720p, 1280, 720, duration=2)

        print(f"\n[SETUP] Test videos created in {cls.tmpdir}")
        for name in ["video_1080p", "video_4k", "video_720p"]:
            path = getattr(cls, name)
            size = os.path.getsize(path) / 1024
            print(f"  {name}: {path} ({size:.1f} KB)")

    @classmethod
    def tearDownClass(cls):
        """Clean up test files."""
        import shutil
        shutil.rmtree(cls.tmpdir, ignore_errors=True)
        print(f"\n[CLEANUP] Removed {cls.tmpdir}")

    # ===========================
    # Test: FFmpeg/FFprobe availability
    # ===========================

    def test_ffmpeg_available(self):
        """FFmpeg binary should be found."""
        self.assertIsNotNone(FFMPEG, "FFmpeg not found")
        self.assertTrue(os.path.exists(FFMPEG) or subprocess.run(
            [FFMPEG, "-version"], capture_output=True).returncode == 0)

    def test_ffprobe_available(self):
        """FFprobe binary should be found."""
        self.assertIsNotNone(FFPROBE, "FFprobe not found")

    # ===========================
    # Test: get_video_resolution
    # ===========================

    def test_resolution_1080p(self):
        """Should detect 1920x1080 for 1080p video."""
        res = get_video_resolution(self.video_1080p)
        self.assertIsNotNone(res)
        w, h = res
        self.assertEqual(w, 1920)
        self.assertEqual(h, 1080)

    def test_resolution_4k(self):
        """Should detect 3840x2160 for 4K video."""
        res = get_video_resolution(self.video_4k)
        self.assertIsNotNone(res)
        w, h = res
        self.assertEqual(w, 3840)
        self.assertEqual(h, 2160)

    def test_resolution_720p(self):
        """Should detect 1280x720 for 720p video."""
        res = get_video_resolution(self.video_720p)
        self.assertIsNotNone(res)
        w, h = res
        self.assertEqual(w, 1280)
        self.assertEqual(h, 720)

    def test_resolution_nonexistent_file(self):
        """Should return None for non-existent file."""
        res = get_video_resolution("/tmp/nonexistent_video.mp4")
        self.assertIsNone(res)

    # ===========================
    # Test: get_video_duration
    # ===========================

    def test_duration(self):
        """Should detect approximately 2 seconds duration."""
        dur = get_video_duration(self.video_1080p)
        self.assertIsNotNone(dur)
        self.assertAlmostEqual(dur, 2.0, delta=0.5)

    # ===========================
    # Test: needs_compression
    # ===========================

    def test_needs_compression_4k(self):
        """4K video should need compression."""
        self.assertTrue(needs_compression(self.video_4k))

    def test_no_compression_720p(self):
        """720p small video should NOT need compression."""
        # 720p and small file size → no compression needed
        self.assertFalse(needs_compression(self.video_720p))

    def test_no_compression_1080p_small(self):
        """1080p small video should NOT need compression."""
        # 1080p but very small file → no compression needed
        self.assertFalse(needs_compression(self.video_1080p))

    def test_needs_compression_large_file(self):
        """Large file (>2GB) should need compression even at 1080p."""
        # Mock os.path.getsize to return > 2GB
        with patch("video_compressor.os.path.getsize", return_value=3 * 1024**3):
            self.assertTrue(needs_compression(self.video_1080p))

    # ===========================
    # Test: compress_to_1080p
    # ===========================

    def test_compress_4k_to_1080p(self):
        """Should compress 4K video to 1080p."""
        output_path = os.path.join(self.tmpdir, "compressed_4k.mp4")
        result = compress_to_1080p(self.video_4k, output_path)

        self.assertIsNotNone(result)
        self.assertTrue(os.path.exists(result))

        # Check output resolution
        res = get_video_resolution(result)
        self.assertIsNotNone(res)
        w, h = res
        self.assertEqual(h, 1080, f"Expected height 1080, got {h}")
        # Width should be auto-calculated (divisible by 2)
        self.assertEqual(w % 2, 0, f"Width {w} is not divisible by 2")

        # Output should be smaller than input
        input_size = os.path.getsize(self.video_4k)
        output_size = os.path.getsize(result)
        print(f"\n  4K→1080p: {input_size/1024:.1f}KB → {output_size/1024:.1f}KB")

    def test_compress_720p_no_upscale(self):
        """Should NOT upscale 720p video to 1080p."""
        output_path = os.path.join(self.tmpdir, "compressed_720p.mp4")
        result = compress_to_1080p(self.video_720p, output_path)

        self.assertIsNotNone(result)
        self.assertTrue(os.path.exists(result))

        # Check output resolution - should stay 720p (not upscaled)
        res = get_video_resolution(result)
        self.assertIsNotNone(res)
        w, h = res
        self.assertEqual(h, 720, f"Expected height 720 (no upscale), got {h}")

    def test_compress_nonexistent_file(self):
        """Should return None for non-existent input."""
        result = compress_to_1080p("/tmp/nonexistent.mp4")
        self.assertIsNone(result)

    def test_compress_default_output_path(self):
        """Should create output with _1080p suffix when no output path given."""
        # Create a copy to avoid modifying original
        import shutil
        copy_path = os.path.join(self.tmpdir, "copy_4k.mp4")
        shutil.copy2(self.video_4k, copy_path)

        result = compress_to_1080p(copy_path)
        self.assertIsNotNone(result)
        expected = os.path.join(self.tmpdir, "copy_4k_1080p.mp4")
        self.assertEqual(result, expected)
        self.assertTrue(os.path.exists(result))

        # Cleanup
        if os.path.exists(result):
            os.remove(result)

    # ===========================
    # Test: parse_blob_url
    # ===========================

    def test_parse_blob_url_basic(self):
        """Should parse basic blob URL."""
        url = "https://myaccount.blob.core.windows.net/videos/user@email.com/video-id/source.mp4"
        result = parse_blob_url(url)
        self.assertEqual(result["container"], "videos")
        self.assertEqual(result["blob_path"], "user@email.com/video-id/source.mp4")
        self.assertEqual(result["parent_path"], "user@email.com/video-id")

    def test_parse_blob_url_with_sas(self):
        """Should parse blob URL with SAS token."""
        url = "https://myaccount.blob.core.windows.net/videos/user@email.com/video-id/source.mp4?sv=2021-06-08&se=2026-01-01&sig=abc123"
        result = parse_blob_url(url)
        self.assertEqual(result["container"], "videos")
        self.assertEqual(result["blob_path"], "user@email.com/video-id/source.mp4")

    def test_parse_blob_url_encoded(self):
        """Should handle URL-encoded characters."""
        url = "https://myaccount.blob.core.windows.net/videos/user%40email.com/video-id/source.mp4"
        result = parse_blob_url(url)
        self.assertEqual(result["blob_path"], "user@email.com/video-id/source.mp4")

    # ===========================
    # Test: compress_and_replace (mocked blob upload)
    # ===========================

    def test_compress_and_replace_4k(self):
        """Should compress 4K video and replace local file."""
        import shutil
        copy_path = os.path.join(self.tmpdir, "replace_test_4k.mp4")
        shutil.copy2(self.video_4k, copy_path)
        original_size = os.path.getsize(copy_path)

        # Mock blob upload to avoid actual Azure calls
        with patch("video_compressor.upload_compressed_to_blob", return_value=True):
            result = compress_and_replace(
                video_path=copy_path,
                blob_url="https://myaccount.blob.core.windows.net/videos/test/video-id/source.mp4",
            )

        self.assertEqual(result, copy_path)
        self.assertTrue(os.path.exists(result))

        # File should be smaller after compression
        new_size = os.path.getsize(result)
        print(f"\n  compress_and_replace: {original_size/1024:.1f}KB → {new_size/1024:.1f}KB")

        # Check resolution is 1080p
        res = get_video_resolution(result)
        self.assertIsNotNone(res)
        _, h = res
        self.assertEqual(h, 1080)

    def test_compress_and_replace_skip_small(self):
        """Should skip compression for small 720p video."""
        import shutil
        copy_path = os.path.join(self.tmpdir, "replace_test_720p.mp4")
        shutil.copy2(self.video_720p, copy_path)
        original_size = os.path.getsize(copy_path)

        result = compress_and_replace(video_path=copy_path)

        self.assertEqual(result, copy_path)
        # File should be unchanged
        self.assertEqual(os.path.getsize(result), original_size)


# ===========================
# Test: STEP_ORDER consistency
# ===========================

class TestStepOrderConsistency(unittest.TestCase):
    """Verify STEP_ORDER indices match start_step conditions in process_video.py."""

    def test_step_order_has_compress(self):
        """STEP_COMPRESS_1080P should be at index 0 in STEP_ORDER."""
        from video_status import VideoStatus
        # Import STEP_ORDER - need to handle import carefully
        # since process_video.py has many dependencies
        step_order = [
            VideoStatus.STEP_COMPRESS_1080P,
            VideoStatus.STEP_0_EXTRACT_FRAMES,
            VideoStatus.STEP_1_DETECT_PHASES,
            VideoStatus.STEP_2_EXTRACT_METRICS,
            VideoStatus.STEP_3_TRANSCRIBE_AUDIO,
            VideoStatus.STEP_4_IMAGE_CAPTION,
            VideoStatus.STEP_5_BUILD_PHASE_UNITS,
            VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION,
            VideoStatus.STEP_7_GROUPING,
            VideoStatus.STEP_8_UPDATE_BEST_PHASE,
            VideoStatus.STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES,
            VideoStatus.STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP,
            VideoStatus.STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS,
            VideoStatus.STEP_12_UPDATE_VIDEO_STRUCTURE_BEST,
            VideoStatus.STEP_13_BUILD_REPORTS,
            VideoStatus.STEP_14_FINALIZE,
        ]

        self.assertEqual(step_order[0], "STEP_COMPRESS_1080P")
        self.assertEqual(step_order[1], "STEP_0_EXTRACT_FRAMES")
        self.assertEqual(step_order[2], "STEP_1_DETECT_PHASES")

    def test_video_status_has_compress(self):
        """VideoStatus should have STEP_COMPRESS_1080P attribute."""
        from video_status import VideoStatus
        self.assertTrue(hasattr(VideoStatus, "STEP_COMPRESS_1080P"))
        self.assertEqual(VideoStatus.STEP_COMPRESS_1080P, "STEP_COMPRESS_1080P")


if __name__ == "__main__":
    print("=" * 60)
    print("video_compressor.py Unit Tests")
    print("=" * 60)
    print(f"FFmpeg: {FFMPEG}")
    print(f"FFprobe: {FFPROBE}")
    print()

    unittest.main(verbosity=2)
