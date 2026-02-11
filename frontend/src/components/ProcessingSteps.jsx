import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import VideoService from '../base/services/videoService';

const normalizeProcessingStatus = (status) => {
  if (status === 'uploaded') {
    // Keep analysis spinner active immediately after upload complete.
    return 'STEP_0_EXTRACT_FRAMES';
  }
  return status;
};

function ProcessingSteps({ videoId, initialStatus, videoTitle, onProcessingComplete, externalProgress }) {
  const [currentStatus, setCurrentStatus] = useState(initialStatus || 'NEW');
  const [smoothProgress, setSmoothProgress] = useState(externalProgress || 0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [_usePolling, setUsePolling] = useState(false);
  const statusStreamRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const lastStatusChangeRef = useRef(0);
  const retryCountRef = useRef(0);
  const lastInitializedVideoIdRef = useRef(null); // Track last initialized videoId
  const maxProgressRef = useRef(0);
  const MAX_SSE_RETRIES = 2;

  // Update smooth progress from external prop if provided (for upload progress)
  const setMonotonicProgress = useCallback((nextProgress) => {
    if (nextProgress < 0) {
      setSmoothProgress(nextProgress);
      return;
    }
    setSmoothProgress((prev) => {
      const safeProgress = Math.max(prev, nextProgress, maxProgressRef.current);
      maxProgressRef.current = safeProgress;
      return safeProgress;
    });
  }, []);

  useEffect(() => {
    if (externalProgress !== undefined && externalProgress !== null) {
      queueMicrotask(() => setMonotonicProgress(externalProgress));
    }
  }, [externalProgress, setMonotonicProgress]);

  // Helper to calculate progress percentage from status
  const calculateProgressFromStatus = useCallback((status) => {
    const statusMap = {
      NEW: 0,
      uploaded: 0,
      STEP_0_EXTRACT_FRAMES: 2,
      STEP_1_DETECT_PHASES: 4,
      STEP_2_EXTRACT_METRICS: 10,
      STEP_3_TRANSCRIBE_AUDIO: 80,
      STEP_4_IMAGE_CAPTION: 87,
      STEP_5_BUILD_PHASE_UNITS: 89,
      STEP_6_BUILD_PHASE_DESCRIPTION: 91,
      STEP_7_GROUPING: 93,
      STEP_8_UPDATE_BEST_PHASE: 94,
      STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES: 95,
      STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP: 96,
      STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS: 97,
      STEP_12_UPDATE_VIDEO_STRUCTURE_BEST: 98,
      STEP_13_BUILD_REPORTS: 99,
      STEP_14_FINALIZE: 99,
      STEP_14_SPLIT_VIDEO: 99,
      DONE: 100,
      ERROR: -1,
    };
    return statusMap[status] || 0;
  }, []);

  const calculateProgressCeilingFromStatus = useCallback((status) => {
    const ceilingMap = {
      NEW: 0,
      uploaded: 2,
      STEP_0_EXTRACT_FRAMES: 4,
      STEP_1_DETECT_PHASES: 10,
      STEP_2_EXTRACT_METRICS: 79,
      STEP_3_TRANSCRIBE_AUDIO: 86,
      STEP_4_IMAGE_CAPTION: 88,
      STEP_5_BUILD_PHASE_UNITS: 90,
      STEP_6_BUILD_PHASE_DESCRIPTION: 92,
      STEP_7_GROUPING: 94,
      STEP_8_UPDATE_BEST_PHASE: 95,
      STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES: 96,
      STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP: 97,
      STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS: 98,
      STEP_12_UPDATE_VIDEO_STRUCTURE_BEST: 99,
      STEP_13_BUILD_REPORTS: 99,
      STEP_14_FINALIZE: 99,
      STEP_14_SPLIT_VIDEO: 99,
      DONE: 100,
      ERROR: -1,
    };
    return ceilingMap[status] ?? 99;
  }, []);

  // Start gradual progress increase
  const startGradualProgress = useCallback((targetProgress, status) => {
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    const ceiling = calculateProgressCeilingFromStatus(status);
    const boundedTarget = Math.min(targetProgress, ceiling);
    setMonotonicProgress(boundedTarget);

    // Start interval to gradually increase progress every 3-5 seconds
    progressIntervalRef.current = setInterval(() => {
      setSmoothProgress(prev => {
        if (prev < 0) return prev;
        const increment = Math.random() * 2 + 1; // Random increment 1-3%
        const newProgress = Math.min(prev + increment, ceiling);
        const monotonicProgress = Math.max(newProgress, maxProgressRef.current);
        maxProgressRef.current = monotonicProgress;

        // Stop if we've reached the max allowed progress for this step
        if (monotonicProgress >= ceiling) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          return ceiling;
        }

        return monotonicProgress;
      });
    }, 2000 + Math.random() * 3000); // Random interval 2-5 seconds
  }, [calculateProgressCeilingFromStatus, setMonotonicProgress]);

  // Callback when processing completes - memoize to prevent re-creation
  const handleProcessingComplete = useCallback(() => {
    if (onProcessingComplete) {
      onProcessingComplete();
    }
  }, [onProcessingComplete]);

  // Polling fallback - fetch status periodically
  const startPolling = useCallback(() => {
    if (!videoId) return;

    console.log('📊 Starting polling fallback for video status');
    setUsePolling(true);
    setErrorMessage(null);

    const poll = async () => {
      try {
        const response = await VideoService.getVideoById(videoId);
        if (response && response.status) {
          const newStatus = normalizeProcessingStatus(response.status);
          setCurrentStatus(newStatus);

          const serverProgress = typeof response.progress === 'number' ? response.progress : 0;
          const progress = Math.max(serverProgress, calculateProgressFromStatus(newStatus));
          startGradualProgress(progress, newStatus);
          lastStatusChangeRef.current = Date.now();

          // Stop polling if done or error
          if (newStatus === 'DONE' || newStatus === 'ERROR') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            if (newStatus === 'DONE' && handleProcessingComplete) {
              handleProcessingComplete();
            }
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
        // Continue polling even on error - might be transient
      }
    };

    // Poll immediately, then every 5 seconds
    poll();
    pollingIntervalRef.current = setInterval(poll, 5000);
  }, [videoId, calculateProgressFromStatus, startGradualProgress, handleProcessingComplete]);

  // Stream status updates if video is processing
  useEffect(() => {
    // Only reset state when videoId actually changes
    if (lastInitializedVideoIdRef.current !== videoId) {
      const initial = normalizeProcessingStatus(initialStatus || 'NEW');
      queueMicrotask(() => {
        setCurrentStatus(initial);
        const initialProgress = calculateProgressFromStatus(initial);
        maxProgressRef.current = Math.max(initialProgress, 0);
        setSmoothProgress(initialProgress);
        setErrorMessage(null);
        setUsePolling(false);
      });
      lastStatusChangeRef.current = Date.now();
      retryCountRef.current = 0;
    }

    // Only stream/poll if video exists
    if (!videoId) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Skip if already initialized for this same videoId (prevents StrictMode double-mount)
    if (lastInitializedVideoIdRef.current === videoId) {
      console.log(`⚠️  Stream already initialized for video ${videoId}, skipping duplicate`);
      return;
    }

    // Close any existing stream first
    if (statusStreamRef.current) {
      statusStreamRef.current.close();
      statusStreamRef.current = null;
    }

    // Mark this videoId as initialized
    lastInitializedVideoIdRef.current = videoId;

    // Start SSE stream
    statusStreamRef.current = VideoService.streamVideoStatus({
      videoId: videoId,

      onStatusUpdate: (data) => {
        console.log(`📡 SSE Update: ${data.status}`);
        const nextStatus = normalizeProcessingStatus(data.status);
        setCurrentStatus(nextStatus);
        setErrorMessage(null); // Clear any previous errors
        retryCountRef.current = 0; // Reset retry count on success
        // Start gradual progress increase
        const serverProgress = typeof data.progress === 'number' ? data.progress : 0;
        const safeProgress = Math.max(serverProgress, calculateProgressFromStatus(nextStatus));
        startGradualProgress(safeProgress, nextStatus);
        lastStatusChangeRef.current = Date.now();

        // Auto-stop stream if done or error
        if (nextStatus === 'DONE' || nextStatus === 'ERROR') {
          console.log(`✅ Stream auto-closing due to status: ${nextStatus}`);
          if (statusStreamRef.current) {
            statusStreamRef.current.close();
            statusStreamRef.current = null;
          }
          // Notify parent when processing is done
          if (nextStatus === 'DONE' && handleProcessingComplete) {
            handleProcessingComplete();
          }
        }
      },

      onDone: async () => {
        console.log('✅ SSE Stream completed');
        // Processing complete - notify parent
        setCurrentStatus('DONE');
        maxProgressRef.current = 100;
        setSmoothProgress(100);
        if (handleProcessingComplete) {
          handleProcessingComplete();
        }
      },

      onError: (error) => {
        console.error('❌ Status stream error:', error);
        retryCountRef.current++;

        // If we've exceeded retry attempts, fallback to polling
        if (retryCountRef.current > MAX_SSE_RETRIES) {
          console.warn(`SSE failed ${MAX_SSE_RETRIES} times, falling back to polling`);
          setErrorMessage('リアルタイム更新に接続できません。定期的に更新しています。');
          startPolling();
        } else {
          setErrorMessage('接続エラーが発生しました。再試行中...');
        }
      },
    });

    // Cleanup - only close stream if videoId changed (switching videos)
    // Don't close in StrictMode when videoId stays the same
    return () => {
      const videoIdChanged = lastInitializedVideoIdRef.current !== videoId;

      if (videoIdChanged) {
        console.log(`🧹 Cleaning up SSE stream for video ${videoId} (videoId changed)`);
        if (statusStreamRef.current) {
          statusStreamRef.current.close();
          statusStreamRef.current = null;
        }
      }

      // Always clear intervals
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [videoId]); // Only depend on videoId, not initialStatus which changes frequently
  const uploadStep = { key: 'uploaded', label: window.__t('statusUploaded') || 'アップロード完了' };

  // Analysis steps are shown in a 5-row window while upload step stays fixed above.
  const analysisSteps = [
    { key: 'STEP_0_EXTRACT_FRAMES', label: window.__t('statusStep0') || 'フレーム抽出中...' },
    { key: 'STEP_1_DETECT_PHASES', label: window.__t('statusStep1') || 'フェーズ検出中...' },
    { key: 'STEP_2_EXTRACT_METRICS', label: window.__t('statusStep2') || 'メトリクス抽出中...' },
    { key: 'STEP_3_TRANSCRIBE_AUDIO', label: window.__t('statusStep3') || '音声文字起こし中...' },
    { key: 'STEP_4_IMAGE_CAPTION', label: window.__t('statusStep4') || '画像キャプション生成中...' },
    { key: 'STEP_5_BUILD_PHASE_UNITS', label: window.__t('statusStep5') || 'フェーズユニット構築中...' },
    { key: 'STEP_6_BUILD_PHASE_DESCRIPTION', label: window.__t('statusStep6') || 'フェーズ説明構築中...' },
    { key: 'STEP_7_GROUPING', label: window.__t('statusStep7') || 'グループ化中...' },
    { key: 'STEP_8_UPDATE_BEST_PHASE', label: window.__t('statusStep8') || 'ベストフェーズ更新中...' },
    { key: 'STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES', label: window.__t('statusStep9') || '動画構造特徴構築中...' },
    { key: 'STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP', label: window.__t('statusStep10') || '動画構造グループ割り当て中...' },
    { key: 'STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS', label: window.__t('statusStep11') || '動画構造グループ統計更新中...' },
    { key: 'STEP_12_UPDATE_VIDEO_STRUCTURE_BEST', label: window.__t('statusStep12') || '動画構造ベスト更新中...' },
    { key: 'STEP_13_BUILD_REPORTS', label: window.__t('statusStep13') || 'レポート構築中...' },
    { key: 'STEP_14_FINALIZE', label: window.__t('statusStep14') || '動画分割中...' },
    { key: 'DONE', label: window.__t('statusDone') || '完了' },
  ];

  const getUploadStepStatus = () => {
    if (currentStatus === 'UPLOADING') return 'current';
    if (currentStatus === 'NEW') return 'pending';
    return 'completed';
  };

  // Get analysis step status: 'completed', 'current', 'pending', or 'error'
  const getAnalysisStepStatus = (stepKey) => {
    if (currentStatus === 'ERROR') return 'error';
    if (currentStatus === 'NEW' || currentStatus === 'UPLOADING') {
      return 'pending';
    }

    const currentIndex = analysisSteps.findIndex(s => s.key === currentStatus);
    const stepIndex = analysisSteps.findIndex(s => s.key === stepKey);

    if (currentIndex === -1) return 'pending';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'pending';
  };

  // Render step icon based on status
  const renderStepIcon = (status) => {
    if (status === 'completed') {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white transition-all duration-500 ease-out">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }

    if (status === 'current') {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full scale-105 transition-all duration-500 ease-out">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-loader-circle-icon lucide-loader-circle w-[18px] h-[18px] animate-spin"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500/20 text-red-400">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }

    // Pending - hollow circle
    return (
      <div className="flex items-center justify-center w-6 h-6 rounded-full transition-all duration-500 ease-out">
        <svg
          className="w-5 h-5"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
    );
  };

  // Get visible analysis steps window (max 5 steps, current step in middle)
  const { visibleAnalysisSteps, isAnalysisFirst, isAnalysisLast, currentAnalysisIndex } = useMemo(() => {
    const totalSteps = analysisSteps.length;
    const foundIndex = analysisSteps.findIndex(s => s.key === currentStatus);
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;

    // Always show 5 steps or less if near boundaries
    let startIndex = Math.max(0, currentIndex - 2); // Current step in middle (index 2)
    let endIndex = Math.min(totalSteps, startIndex + 5);

    // Adjust if we're near the end
    if (endIndex - startIndex < 5) {
      startIndex = Math.max(0, endIndex - 5);
    }

    return {
      visibleAnalysisSteps: analysisSteps.slice(startIndex, endIndex),
      isAnalysisFirst: startIndex === 0,
      isAnalysisLast: endIndex === totalSteps,
      currentAnalysisIndex: currentIndex,
    };
  }, [currentStatus]);

  const isError = currentStatus === 'ERROR';
  const uploadStepStatus = getUploadStepStatus();
  const currentAnalysisLabel = visibleAnalysisSteps.find(
    (step) => getAnalysisStepStatus(step.key) === 'current',
  )?.label;
  const progressLabel = uploadStepStatus === 'current'
    ? (window.__t('statusNew') || 'ファイルをアップロードしています')
    : (currentAnalysisLabel || (window.__t('statusAnalyzing') || '解析中...'));
  const videoTitleNode = useMemo(() => {
    if (!videoTitle) return null;
    return (
      <div className="flex justify-center mb-5">
        <div className="inline-flex items-center px-4 py-2 rounded-full border border-white/30 bg-white/5">
          <div className="text-sm font-medium whitespace-nowrap text-white">
            {videoTitle}
          </div>
        </div>
      </div>
    );
  }, [videoTitle]);

  return (
    <div className="w-full">
      {/* Video title */}
      {videoTitleNode}

      {/* Fixed upload step + scrolling analysis steps */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-3 transition-all duration-500 ease-out">
          {renderStepIcon(uploadStepStatus)}
          <span className={`text-sm transition-all duration-500 ease-out ${uploadStepStatus === 'current' ? 'text-white font-medium' : 'text-green-500'}`}>
            {uploadStep.label}
          </span>
        </div>

        <div className="pt-1 pb-1 text-left">
          <p className="text-[11px] text-white/45">
            {window.__t('analysisSectionHint') || 'アップロード完了後、解析ステップを実行中'}
          </p>
        </div>

        {/* Show ellipsis if analysis window is not at start */}
        {!isAnalysisFirst && (
          <div className="flex items-center gap-3 text-gray-500">
            <div className="flex items-center justify-center w-6">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-xs text-gray-500">...</span>
          </div>
        )}

        {/* Visible analysis steps */}
        {visibleAnalysisSteps.map((step) => {
          const stepStatus = getAnalysisStepStatus(step.key);
          const isActive = stepStatus === 'current';
          const isCompleted = stepStatus === 'completed';
          const stepGlobalIndex = analysisSteps.findIndex((analysisStep) => analysisStep.key === step.key);
          const distanceFromCurrent = currentAnalysisIndex >= 0
            ? Math.abs(stepGlobalIndex - currentAnalysisIndex)
            : 0;
          const transitionDelay = `${Math.min(distanceFromCurrent, 4) * 45}ms`;

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 transition-all duration-500 ease-out will-change-transform ${isActive
                ? 'opacity-100 translate-y-0 scale-[1.01] ml-1'
                : isCompleted
                  ? 'opacity-95 translate-y-0 scale-100'
                  : 'opacity-70 translate-y-px scale-[0.99]'
                }`}
              style={{ transitionDelay }}
            >
              {renderStepIcon(stepStatus)}
              <span className={`text-sm transition-all duration-500 ease-out ${isActive ? 'text-white font-medium' :
                isCompleted ? 'text-green-500' :
                  'text-gray-400'
                }`}>
                {step.label}
              </span>
            </div>
          );
        })}

        {/* Show ellipsis if analysis window is not at end */}
        {!isAnalysisLast && (
          <div className="flex items-center gap-3 text-gray-500">
            <div className="flex items-center justify-center w-6">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832l-3.71 3.938a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-xs text-gray-500">...</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!isError && smoothProgress >= 0 && (
        <>
          <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-500 ease-out bg-linear-to-r from-indigo-500 to-violet-400"
              style={{ width: `${smoothProgress}%` }}
            />
          </div>
          {/* Current status message */}
          <div className="flex items-center justify-between mb-3 mt-2">
            <span className="text-sm text-white/70">
              {progressLabel}
            </span>
            <span className="text-sm text-white/70">
              {Math.round(smoothProgress)}%
            </span>
          </div>

          <p className="text-sm text-white/50 mt-5 text-center">
            {window.__t('progressCompleteMessage') || '解析が完了すると、自動的に結果が表示されます。'}
          </p>

          {/* Show warning if using polling fallback */}
          {errorMessage && (
            <p className="text-xs text-yellow-400 mt-2 text-center">
              {errorMessage}
            </p>
          )}
        </>
      )}

      {/* Error message */}
      {isError && (
        <p className="text-sm text-red-400 mt-2">
          {window.__t('errorAnalysisMessage') || '解析中にエラーが発生しました。'}
        </p>
      )}
    </div>
  );
}

const areProcessingStepsPropsEqual = (prevProps, nextProps) =>
  prevProps.videoId === nextProps.videoId &&
  prevProps.initialStatus === nextProps.initialStatus &&
  prevProps.videoTitle === nextProps.videoTitle &&
  prevProps.externalProgress === nextProps.externalProgress &&
  prevProps.onProcessingComplete === nextProps.onProcessingComplete;

export default memo(ProcessingSteps, areProcessingStepsPropsEqual);
