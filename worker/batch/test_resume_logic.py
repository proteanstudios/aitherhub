#!/usr/bin/env python3
"""
Integration tests for process_video.py resume logic.

Verifies that STEP_ORDER indices and start_step conditions are consistent
after adding STEP_COMPRESS_1080P at index 0.

Usage:
    python test_resume_logic.py
"""
import os
import sys
import re
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_status import VideoStatus


# Reconstruct STEP_ORDER as defined in process_video.py
STEP_ORDER = [
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


def status_to_step_index(status):
    """Mirror of the function in process_video.py."""
    if not status:
        return 0
    if status == VideoStatus.DONE:
        return len(STEP_ORDER)
    if status in STEP_ORDER:
        return STEP_ORDER.index(status)
    return 0


class TestStepOrderIndices(unittest.TestCase):
    """Verify STEP_ORDER indices are correct."""

    def test_compress_at_index_0(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_COMPRESS_1080P), 0)

    def test_extract_frames_at_index_1(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_0_EXTRACT_FRAMES), 1)

    def test_detect_phases_at_index_2(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_1_DETECT_PHASES), 2)

    def test_extract_metrics_at_index_3(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_2_EXTRACT_METRICS), 3)

    def test_transcribe_audio_at_index_4(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_3_TRANSCRIBE_AUDIO), 4)

    def test_image_caption_at_index_5(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_4_IMAGE_CAPTION), 5)

    def test_build_phase_units_at_index_6(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_5_BUILD_PHASE_UNITS), 6)

    def test_build_phase_description_at_index_7(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION), 7)

    def test_grouping_at_index_8(self):
        self.assertEqual(STEP_ORDER.index(VideoStatus.STEP_7_GROUPING), 8)

    def test_total_steps(self):
        self.assertEqual(len(STEP_ORDER), 16)


class TestStatusToStepIndex(unittest.TestCase):
    """Verify status_to_step_index returns correct indices."""

    def test_none_returns_0(self):
        self.assertEqual(status_to_step_index(None), 0)

    def test_empty_returns_0(self):
        self.assertEqual(status_to_step_index(""), 0)

    def test_unknown_status_returns_0(self):
        self.assertEqual(status_to_step_index("UNKNOWN_STATUS"), 0)

    def test_compress_returns_0(self):
        self.assertEqual(status_to_step_index(VideoStatus.STEP_COMPRESS_1080P), 0)

    def test_extract_frames_returns_1(self):
        self.assertEqual(status_to_step_index(VideoStatus.STEP_0_EXTRACT_FRAMES), 1)

    def test_grouping_returns_8(self):
        self.assertEqual(status_to_step_index(VideoStatus.STEP_7_GROUPING), 8)

    def test_done_returns_len(self):
        self.assertEqual(status_to_step_index(VideoStatus.DONE), len(STEP_ORDER))


class TestResumeLogic(unittest.TestCase):
    """Verify resume logic works correctly with new STEP_ORDER."""

    def _simulate_resume(self, current_status):
        """Simulate the resume logic from process_video.py main()."""
        raw_start_step = status_to_step_index(current_status)

        # Resume only if >= STEP 8 (was STEP 7 before COMPRESS was added)
        # STEP 8 = STEP_7_GROUPING (index 8 in new STEP_ORDER)
        if raw_start_step >= 8:
            start_step = raw_start_step
            resumed = True
        else:
            start_step = 0
            resumed = False

        return start_step, resumed

    def test_new_video_starts_from_0(self):
        """New video (no status) should start from step 0 (COMPRESS)."""
        start_step, resumed = self._simulate_resume(None)
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_uploaded_starts_from_0(self):
        """Uploaded video should start from step 0 (COMPRESS)."""
        start_step, resumed = self._simulate_resume("uploaded")
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_compress_in_progress_restarts(self):
        """Video stuck at COMPRESS should restart from 0."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_COMPRESS_1080P)
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_extract_frames_in_progress_restarts(self):
        """Video stuck at STEP_0 should restart from 0."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_0_EXTRACT_FRAMES)
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_step5_restarts(self):
        """Video at STEP_5 (index 6) should restart from 0."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_5_BUILD_PHASE_UNITS)
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_step6_restarts(self):
        """Video at STEP_6 (index 7) should restart from 0."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_6_BUILD_PHASE_DESCRIPTION)
        self.assertEqual(start_step, 0)
        self.assertFalse(resumed)

    def test_step7_resumes(self):
        """Video at STEP_7 GROUPING (index 8) should resume."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_7_GROUPING)
        self.assertEqual(start_step, 8)
        self.assertTrue(resumed)

    def test_step8_resumes(self):
        """Video at STEP_8 (index 9) should resume."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_8_UPDATE_BEST_PHASE)
        self.assertEqual(start_step, 9)
        self.assertTrue(resumed)

    def test_step13_resumes(self):
        """Video at STEP_13 (index 14) should resume."""
        start_step, resumed = self._simulate_resume(VideoStatus.STEP_13_BUILD_REPORTS)
        self.assertEqual(start_step, 14)
        self.assertTrue(resumed)


class TestStartStepConditions(unittest.TestCase):
    """
    Verify that start_step conditions in process_video.py match STEP_ORDER indices.
    
    Expected mapping (after adding COMPRESS at index 0):
        STEP COMPRESS:  start_step <= 0
        STEP 0:         start_step <= 1
        STEP 1:         start_step <= 2
        STEP 2:         start_step <= 3
        STEP 3:         start_step <= 4
        STEP 4:         start_step <= 5
        STEP 5:         start_step <= 6
        STEP 6:         start_step <= 7
        STEP 7:         start_step <= 8
        STEP 8:         start_step <= 9
        STEP 9:         start_step <= 10
        STEP 10:        start_step <= 11
        STEP 11:        start_step <= 12
        STEP 12:        start_step <= 13
        STEP 13:        start_step <= 14
        STEP 14:        start_step <= 15
    """

    def setUp(self):
        """Read process_video.py and extract all start_step conditions."""
        script_path = os.path.join(os.path.dirname(__file__), "process_video.py")
        with open(script_path, "r") as f:
            self.source = f.read()

    def test_compress_condition(self):
        """STEP COMPRESS should use start_step <= 0."""
        # Find the COMPRESS step block
        pattern = r'# STEP COMPRESS.*?if start_step <= (\d+):'
        match = re.search(pattern, self.source, re.DOTALL)
        self.assertIsNotNone(match, "STEP COMPRESS condition not found")
        self.assertEqual(int(match.group(1)), 0)

    def test_step0_condition(self):
        """STEP 0 should use start_step <= 1."""
        pattern = r'# STEP 0.*?if start_step <= (\d+):'
        match = re.search(pattern, self.source, re.DOTALL)
        self.assertIsNotNone(match, "STEP 0 condition not found")
        self.assertEqual(int(match.group(1)), 1)

    def test_step1_condition(self):
        """STEP 1 should use start_step <= 2."""
        pattern = r'# STEP 1 \u2013 PHASE.*?if start_step <= (\d+):'
        match = re.search(pattern, self.source, re.DOTALL)
        if not match:
            # Try with literal em dash
            pattern = '# STEP 1 \u2013 PHASE.*?if start_step <= (\\d+):'
            match = re.search(pattern, self.source, re.DOTALL)
        self.assertIsNotNone(match, "STEP 1 condition not found")
        self.assertEqual(int(match.group(1)), 2)

    def test_all_conditions_sequential(self):
        """All start_step conditions should be sequential (0, 1, 2, ...)."""
        # Extract all "if start_step <= N:" conditions in order
        conditions = re.findall(r'if start_step <= (\d+):', self.source)
        conditions = [int(c) for c in conditions]

        # Should be sequential starting from 0
        for i, val in enumerate(conditions):
            self.assertEqual(val, i, 
                f"Condition at position {i} should be <= {i}, got <= {val}")

    def test_condition_count_matches_step_order(self):
        """Number of start_step conditions should match STEP_ORDER length."""
        conditions = re.findall(r'if start_step <= (\d+):', self.source)
        self.assertEqual(len(conditions), len(STEP_ORDER),
            f"Expected {len(STEP_ORDER)} conditions, got {len(conditions)}")

    def test_resume_threshold(self):
        """Resume threshold should be >= 8 (STEP_7_GROUPING index)."""
        match = re.search(r'if raw_start_step >= (\d+):', self.source)
        self.assertIsNotNone(match, "Resume threshold not found")
        threshold = int(match.group(1))
        self.assertEqual(threshold, 8,
            f"Resume threshold should be 8 (STEP_7_GROUPING index), got {threshold}")

        # Verify this corresponds to STEP_7_GROUPING
        self.assertEqual(STEP_ORDER[threshold], VideoStatus.STEP_7_GROUPING)


class TestVideoProgressConsistency(unittest.TestCase):
    """Verify video_progress.py has entries for all steps."""

    def test_progress_has_compress_step(self):
        """video_progress.py should have STEP_COMPRESS_1080P entry."""
        progress_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "backend", "app", "utils", "video_progress.py"
        )
        if not os.path.exists(progress_path):
            self.skipTest("video_progress.py not found at expected path")

        with open(progress_path, "r") as f:
            content = f.read()

        self.assertIn("STEP_COMPRESS_1080P", content)


if __name__ == "__main__":
    print("=" * 60)
    print("process_video.py Resume Logic Tests")
    print("=" * 60)
    print(f"STEP_ORDER length: {len(STEP_ORDER)}")
    for i, step in enumerate(STEP_ORDER):
        print(f"  [{i:2d}] {step}")
    print()

    unittest.main(verbosity=2)
