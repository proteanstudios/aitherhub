"""
Video processing progress calculation utilities.
"""


def calculate_progress(status: str) -> int:
    """
    Calculate progress percentage based on current video processing status.

    Args:
        status: Current video status (e.g., 'STEP_0_EXTRACT_FRAMES', 'DONE', etc.)

    Returns:
        Progress percentage (0-100). Returns -1 for ERROR status.

    Examples:
        >>> calculate_progress('uploaded')
        0
        >>> calculate_progress('STEP_5_BUILD_PHASE_UNITS')
        60
        >>> calculate_progress('DONE')
        100
        >>> calculate_progress('ERROR')
        -1
    """
    status_map = {
        "NEW": 0,
        "uploaded": 0,
        "STEP_0_EXTRACT_FRAMES": 10,
        "STEP_1_DETECT_PHASES": 20,
        "STEP_2_EXTRACT_METRICS": 30,
        "STEP_3_TRANSCRIBE_AUDIO": 40,
        "STEP_4_IMAGE_CAPTION": 50,
        "STEP_5_BUILD_PHASE_UNITS": 60,
        "STEP_6_BUILD_PHASE_DESCRIPTION": 70,
        "STEP_7_GROUPING": 80,
        "STEP_8_UPDATE_BEST_PHASE": 90,
        "STEP_9_BUILD_REPORTS": 95,
        "DONE": 100,
        "ERROR": -1,
    }
    return status_map.get(status, 0)


def get_status_message(status: str) -> str:
    """
    Get user-friendly Japanese message for current processing status.

    Args:
        status: Current video status

    Returns:
        Japanese message describing the current processing step

    Examples:
        >>> get_status_message('STEP_3_TRANSCRIBE_AUDIO')
        '音声書き起こし中...'
        >>> get_status_message('DONE')
        '解析完了'
    """
    messages = {
        "NEW": "アップロード待ち",
        "uploaded": "アップロード完了",
        "STEP_0_EXTRACT_FRAMES": "フレーム抽出中...",
        "STEP_1_DETECT_PHASES": "フェーズ検出中...",
        "STEP_2_EXTRACT_METRICS": "メトリクス抽出中...",
        "STEP_3_TRANSCRIBE_AUDIO": "音声書き起こし中...",
        "STEP_4_IMAGE_CAPTION": "画像キャプション生成中...",
        "STEP_5_BUILD_PHASE_UNITS": "フェーズユニット構築中...",
        "STEP_6_BUILD_PHASE_DESCRIPTION": "フェーズ説明生成中...",
        "STEP_7_GROUPING": "グルーピング中...",
        "STEP_8_UPDATE_BEST_PHASE": "ベストフェーズ更新中...",
        "STEP_9_BUILD_REPORTS": "レポート生成中...",
        "DONE": "解析完了",
        "ERROR": "エラーが発生しました",
    }
    return messages.get(status, "処理中...")
