import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import MarkdownWithTables from "./markdown/MarkdownWithTables";
import ChatInput from "./ChatInput";
import VideoPreviewModal from "./modals/VideoPreviewModal";
import VideoService from "../base/services/videoService";
import UploadService from "../base/services/uploadService";
import "../assets/css/sidebar.css";

export default function VideoDetail({ video, onClearUploadPlaceholder }) {
  // Debug: Log video prop whenever it changes
  console.log('[VideoDetail] Mounted/Updated, video prop:', video);
  
  const markdownTableStyles = `
  .markdown table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
  }
  .markdown th,
  .markdown td {
    border: 1px solid rgba(255,255,255,0.12);
    padding: 0.5rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }
  .markdown th {
    font-weight: 600;
    background: rgba(255,255,255,0.03);
  }
  .markdown tr:nth-child(even) td {
    background: rgba(255,255,255,0.02);
  }
  .markdown caption {
    caption-side: top;
    text-align: left;
    font-weight: 600;
    padding-bottom: 0.25rem;
  }
  .markdown p,
  .markdown li {
    line-height: 1.9;
    margin-top: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .markdown ul,
  .markdown ol {
    margin: 0.4rem 0 0.4rem 1.25rem;
    padding-left: 1rem;
    list-style-position: outside;
  }
  .markdown ul {
    list-style-type: disc;
  }
  .markdown ol {
    list-style-type: decimal;
  }
  .markdown li {
    margin: 0.25rem 0;
    color: inherit;
  }
  .markdown li::marker {
    color: rgba(255,255,255,0.95);
    opacity: 0.95;
    font-size: 0.95em;
  }
  .markdown hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.12);
    margin: 0.75rem 0;
  }
  .markdown h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin-top: 0.6rem;
    margin-bottom: 0.6rem;
    line-height: 1.2;
  }
  .markdown h3 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-top: 0.45rem;
    margin-bottom: 0.45rem;
    line-height: 1.2;
  }
  .markdown strong {
    font-weight: 800;
  }
  `;
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [previewData, setPreviewData] = useState(null); // { url, timeStart, timeEnd }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedR2, setExpandedR2] = useState({});
  const answerRef = useRef("");
  const streamCancelRef = useRef(null);
  const lastSentRef = useRef({ text: null, t: 0 });
  const reloadTimeoutRef = useRef(null);
  const chatEndRef = useRef(null);
  const statusStreamRef = useRef(null);
  const isUploadModeRef = useRef(false); // Track upload mode for sync check
  const uploadStartedRef = useRef(false); // Prevent duplicate upload calls
  const uploadCompletedRef = useRef(false); // Track upload completion to prevent re-trigger
  const isUploadFinishedRef = useRef(false); // Track if upload finished (for sync check)
  const lastVisualProgressRef = useRef(0); 

  // Upload related state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Smooth progress bar animation - gradual increase every few seconds
  const [smoothProgress, setSmoothProgress] = useState(0);
  const progressIntervalRef = useRef(null);
  const lastStatusChangeRef = useRef(Date.now());

  // Start gradual progress increase
  const startGradualProgress = useCallback((targetProgress) => {
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    // Set initial progress to current target
    setSmoothProgress(targetProgress);

    // Start interval to gradually increase progress every 3-5 seconds
    progressIntervalRef.current = setInterval(() => {
      setSmoothProgress(prev => {
        const increment = Math.random() * 2 + 1; // Random increment 1-3%
        const newProgress = Math.min(prev + increment, 99); // Cap at 99% until actually complete

        // Stop if we've reached a reasonable limit for this step
        if (newProgress >= targetProgress + 5) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          return targetProgress + 5; // Allow slight overshoot for visual effect
        }

        return newProgress;
      });
    }, 2000 + Math.random() * 3000); // Random interval 2-5 seconds
  }, []);

  const scrollToBottom = (smooth = true) => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
      } catch (e) {
        // Ignore scroll errors
      }
    }
  };

  // Detect old Safari iOS (<=16) - remark-gfm table parsing can crash/blank-screen on these versions.
  const isOldSafariIOS = (() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent;
    // Check if it's Safari (not Chrome, not Android)
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(ua);
    if (!isSafariBrowser) return false;

    // Extract iOS version from user agent
    // iOS Safari UA contains "Version/X.Y.Z" or "OS X_Y" patterns
    const iosVersionMatch = ua.match(/OS (\d+)_/);
    if (iosVersionMatch) {
      const majorVersion = parseInt(iosVersionMatch[1], 10);
      // Safari iOS 16 and below have issues with remark-gfm in some table-heavy/inline-table content.
      return majorVersion <= 16;
    }

    return false;
  })();

  // Markdown table rendering is handled by <MarkdownWithTables /> to keep this file lighter.

  const formatTime = (seconds) => {
    if (seconds == null || isNaN(seconds)) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Upload file to Azure and notify backend
  const startUpload = async (file, uploadUrl, uploadId, email) => {
    // Set flag immediately to prevent any duplicate calls
    uploadStartedRef.current = true;

    // Set global uploading flag
    localStorage.setItem('isUploading', 'true');

    setIsUploading(true);
    setUploadProgress(0);

    try {
      await UploadService.uploadToAzure(file, uploadUrl, uploadId, (percentage) => {
        // Map 0-100% upload -> 0-20% progress bar
        const progress = Math.round(percentage * 0.2);
        setUploadProgress(progress);
      });

      // Upload xong: notify backend
      console.log('[Upload] Calling uploadComplete API...');
      const result = await UploadService.uploadComplete(email, video.id, file.name, uploadId);
      console.log('[Upload] uploadComplete result:', result);

      // Reset upload mode flags
      isUploadModeRef.current = false;
      uploadStartedRef.current = false;
      uploadCompletedRef.current = true; // Mark upload as complete BEFORE calling callback

      // Clear sidebar placeholder since upload is complete
      if (onClearUploadPlaceholder) {
        onClearUploadPlaceholder();
      }

      // Remove global uploading flag
      localStorage.removeItem('isUploading');

      // Set smoothProgress from uploadProgress to continue smoothly (20%)
      // This ensures progress bar doesn't jump when SSE stream starts
      // setSmoothProgress(uploadProgress);

      // setIsUploading(false);
    } catch (error) {
      console.error('Upload failed:', error);
      isUploadModeRef.current = false;
      
      // Remove global uploading flag on error
      localStorage.removeItem('isUploading');
      uploadStartedRef.current = false;
      uploadCompletedRef.current = false; // Reset to allow retry
      setIsUploading(false);
      // Handle error - co the hien thi error message
    }
  };

  // Start SSE stream for video processing status
  const startVideoProcessing = (initialProgress = 0) => {
    if (!video?.id) return;

    if (statusStreamRef.current) {
      statusStreamRef.current.close();
      statusStreamRef.current = null;
    }

    statusStreamRef.current = VideoService.streamVideoStatus({
      videoId: video.id,

      onStatusUpdate: (data) => {
        setProcessingStatus({
          status: data.status,
          progress: data.progress,
          message: data.message,
          updatedAt: data.updated_at,
        });

        // Ensure progress never goes below upload completion point (20%)
        const minProgress = Math.max(initialProgress, 20);
        const targetProgress = Math.max(data.progress, minProgress);

        // Bat dau gradual progress increase
        startGradualProgress(targetProgress);
        lastStatusChangeRef.current = Date.now();
      },

      onDone: async () => {
        // Processing complete - reload full video data de get reports
        try {
          const response = await VideoService.getVideoById(video.id);
          const rr1 = Array.isArray(response.reports_1) ? response.reports_1 : (response.reports_1 ? [response.reports_1] : []);
          let rr2 = Array.isArray(response.reports_2) ? response.reports_2 : (response.reports_2 ? [response.reports_2] : []);
          if ((!rr2 || rr2.length === 0) && rr1 && rr1.length > 0) {
            rr2 = rr1.map((it) => ({
              phase_index: it.phase_index,
              time_start: it.time_start,
              time_end: it.time_end,
              insight: it.insight ?? it.phase_description ?? "",
              video_clip_url: it.video_clip_url,
            }));
          }
          setVideoData({
            id: response.id || video.id,
            title: response.original_filename || video.original_filename,
            status: response.status,
            uploadedAt: response.created_at,
            reports_1: rr1,
            reports_2: rr2,
            report3: Array.isArray(response.report3) ? response.report3 : (response.report3 ? [response.report3] : []),
          });
          setProcessingStatus(null);
        } catch (err) {
          console.error('Failed to reload video after processing:', err);
        }
      },

      onError: (error) => {
        console.error('Status stream error:', error);
        setProcessingStatus(null);
      },
    });
  };

  const handlePhasePreview = async (phase) => {
    console.log('🎬 handlePhasePreview called with phase:', {
      time_start: phase?.time_start,
      time_end: phase?.time_end,
      phase_index: phase?.phase_index,
      video_clip_url: phase?.video_clip_url,
    });

    if (!phase?.time_start && !phase?.time_end) {
      console.log('❌ No time_start or time_end, skipping preview');
      return;
    }
    if (!videoData?.id) {
      console.log('❌ No videoData.id, skipping preview');
      return;
    }

    setPreviewLoading(true);
    try {
      const checkUrl = async (url, timeout = 5000) => {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeout);
          const res = await fetch(url, { method: 'HEAD', mode: 'cors', signal: controller.signal });
          clearTimeout(id);
          return res.status === 200 || res.status === 206;
        } catch (e) {
          try {
            const controller2 = new AbortController();
            const id2 = setTimeout(() => controller2.abort(), timeout);
            const res2 = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, mode: 'cors', signal: controller2.signal });
            clearTimeout(id2);
            return res2.status === 206 || res2.status === 200;
          } catch (e2) {
            return false;
          }
        }
      };

      let url = null;
      let okPhaseUrl = false;

      // If a precomputed SAS url exists on the phase, prefer it after verifying
      if (phase?.video_clip_url) {
        const ok = await checkUrl(phase.video_clip_url);
        if (ok) {
          url = phase.video_clip_url;
          okPhaseUrl = true;
        }
      }

      // Fallback: ask backend for a download SAS URL
      if (!url) {
        try {
          const downloadUrl = await VideoService.getDownloadUrl(videoData.id);
          url = downloadUrl;
        } catch (err) {
          console.error('❌ Failed to get backend download URL', err);
        }
      }

      if (!url) {
        console.error('❌ No preview URL available for this phase');
        return;
      }

      const previewDataObj = {
        url,
        timeStart: Number(phase.time_start) || 0,
        timeEnd: phase.time_end != null ? Number(phase.time_end) : null,
        skipSeek: !!okPhaseUrl,
      };

      console.log('🎯 Setting preview data:', previewDataObj);
      setPreviewData(previewDataObj);
    } catch (err) {
      console.error("❌ Failed to load preview url", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Helper to calculate progress percentage from status
  const calculateProgressFromStatus = (status, currentUploadProgress = null) => {
    // Uu tien upload progress (0-20%)
    if (currentUploadProgress !== null && currentUploadProgress < 20) {
      return currentUploadProgress;
    }

    // Processing steps (20-100%)
    const statusMap = {
      NEW: 20,
      uploaded: 20,
      STEP_0_EXTRACT_FRAMES: 25,
      STEP_1_DETECT_PHASES: 30,
      STEP_2_EXTRACT_METRICS: 40,
      STEP_3_TRANSCRIBE_AUDIO: 50,
      STEP_4_IMAGE_CAPTION: 60,
      STEP_5_BUILD_PHASE_UNITS: 70,
      STEP_6_BUILD_PHASE_DESCRIPTION: 75,
      STEP_7_GROUPING: 80,
      STEP_8_UPDATE_BEST_PHASE: 85,
      STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES: 88,
      STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP: 90,
      STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS: 92,
      STEP_12_UPDATE_VIDEO_STRUCTURE_BEST: 94,
      STEP_13_BUILD_REPORTS: 96,
      STEP_14_SPLIT_VIDEO: 98,
      DONE: 100,
      ERROR: -1,
    };
    return statusMap[status] || 20;
  };

  // Helper to get user-friendly status message
  const getStatusMessage = (status, uploadIsUploading = false, uploadProgress = 0) => {
    // Hien thi upload message khi dang upload
    if (uploadIsUploading) {
      return `${window.__t('uploadingMessage') || 'アップロード中...'}: ${uploadProgress}%`;
    }

    const messages = {
      NEW: window.__t('statusNew'),
      uploaded: window.__t('statusUploaded'),
      STEP_0_EXTRACT_FRAMES: window.__t('statusStep0'),
      STEP_1_DETECT_PHASES: window.__t('statusStep1'),
      STEP_2_EXTRACT_METRICS: window.__t('statusStep2'),
      STEP_3_TRANSCRIBE_AUDIO: window.__t('statusStep3'),
      STEP_4_IMAGE_CAPTION: window.__t('statusStep4'),
      STEP_5_BUILD_PHASE_UNITS: window.__t('statusStep5'),
      STEP_6_BUILD_PHASE_DESCRIPTION: window.__t('statusStep6'),
      STEP_7_GROUPING: window.__t('statusStep7'),
      STEP_8_UPDATE_BEST_PHASE: window.__t('statusStep8'),
      STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES: window.__t('statusStep9'),
      STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP: window.__t('statusStep10'),
      STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS: window.__t('statusStep11'),
      STEP_12_UPDATE_VIDEO_STRUCTURE_BEST: window.__t('statusStep12'),
      STEP_13_BUILD_REPORTS: window.__t('statusStep13'),
      STEP_14_SPLIT_VIDEO: window.__t('statusStep14'),
      DONE: window.__t('statusDone'),
      ERROR: window.__t('statusError'),
    };
    return messages[status] || window.__t('statusProcessing');
  };

  const reloadHistory = async () => {
    const vid = video?.id || videoData?.id;
    if (!vid) return;
    try {
      const hist = await VideoService.getChatHistory(vid);
      if (Array.isArray(hist)) {
        setChatMessages(hist);
      } else if (hist && Array.isArray(hist.data)) {
        setChatMessages(hist.data);
      } else {
        setChatMessages([]);
      }
    } catch (err) {
      console.error("Failed to reload chat history:", err);
    }
  };

  const handleChatSend = (text) => {
    try {
      const vid = video?.id || videoData?.id;
      if (streamCancelRef.current) {
        return;
      }
      const hasReport = !!(videoData && Array.isArray(videoData.reports_1) && videoData.reports_1.length > 0);
      const statusDone = (videoData && (String(videoData.status || "").toUpperCase() === "DONE")) || false;
      if (!vid || !(hasReport || statusDone)) {
        try { } catch (e) { }
        return;
      }
      const now = Date.now();
      if (lastSentRef.current.text === text && now - lastSentRef.current.t < 1000) {
        return;
      }
      lastSentRef.current = { text, t: now };
      if (streamCancelRef.current) {
        try {
          if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
          else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
        } catch (e) { }
        streamCancelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      answerRef.current = "";

      const localId = `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      setChatMessages((prev) => [...prev, { id: localId, question: text, answer: "" }]);

      const streamHandle = VideoService.streamChat({
        videoId: video?.id || videoData?.id,
        messages: [{ role: "user", content: text }],
        onMessage: (chunk) => {
          try {
            let processed = chunk;
            try {
              processed = processed.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n");
              processed = processed.replace(/([.!?])\s+([A-ZÀ-ỸÂÊÔƠƯĂĐ])/g, "$1\n$2");
            } catch (e) { }

            answerRef.current += processed;
            setChatMessages((prev) =>
              prev.map((it) => (it.id === localId ? { ...it, answer: (it.answer || "") + processed } : it))
            );
          } catch (e) {
            console.error("onMessage processing error", e);
          }
        },
        onDone: () => {
          streamCancelRef.current = null;
          if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
          reloadTimeoutRef.current = setTimeout(() => {
            reloadHistory();
            reloadTimeoutRef.current = null;
          }, 500);
        },
        onError: (err) => {
          console.error("Chat stream error:", err);
          streamCancelRef.current = null;
        },
      });

      streamCancelRef.current = streamHandle;
    } catch (err) {
      console.error("handleChatSend error:", err);
    }
  };

  useEffect(() => {
    const fetchVideoDetails = async () => {
      if (!video || !video.id) {
        setVideoData(null);
        return;
      }

      // Neu co upload info, skip fetch vi dang trong qua trinh upload
      if (video.uploadFile) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await VideoService.getVideoById(video.id);
        const data = response || {};

        // normalize reports
        const r1 = Array.isArray(data.reports_1) ? data.reports_1 : (data.reports_1 ? [data.reports_1] : []);
        let r2 = Array.isArray(data.reports_2) ? data.reports_2 : (data.reports_2 ? [data.reports_2] : []);
        // if API doesn't provide reports_2, derive it from reports_1 (use insight if present, else fallback to phase_description)
        if ((!r2 || r2.length === 0) && r1 && r1.length > 0) {
          r2 = r1.map((it) => ({
            phase_index: it.phase_index,
            time_start: it.time_start,
            time_end: it.time_end,
            insight: it.insight ?? it.phase_description ?? "",
            video_clip_url: it.video_clip_url, // Include video_clip_url for preview
          }));
        }
        setVideoData({
          id: data.id || video.id,
          title: data.original_filename || video.original_filename || `${window.__t('videoTitleFallback')} ${video.id}`,
          status: data.status || video.status || "processing",
          uploadedAt: data.created_at || video.created_at || new Date().toISOString(),
          reports_1: r1,
          reports_2: r2,
          report3: Array.isArray(data.report3) ? data.report3 : (data.report3 ? [data.report3] : []),
        });

        // initialize collapsed state for report2 (closed by default)
        try {
          const map = {};
          const list = Array.isArray(r2) ? r2 : [];
          list.forEach((it, i) => {
            const key = it.phase_index ?? i;
            map[key] = false;
          });
          setExpandedR2(map);
        } catch (e) {
          setExpandedR2({});
        }

        // initialize collapsed state for report2 (closed by default)
        try {
          const map = {};
          const list = Array.isArray(r2) ? r2 : [];
          list.forEach((it, i) => {
            const key = it.phase_index ?? i;
            map[key] = false;
          });
          setExpandedR2(map);
        } catch (e) {
          setExpandedR2({});
        }
        // Set initial processing status if not done
        if (data.status && data.status !== 'DONE' && data.status !== 'ERROR') {
          setProcessingStatus({
            status: data.status,
            progress: calculateProgressFromStatus(data.status),
            message: getStatusMessage(data.status),
          });
        }

      } catch (err) {
        // If it's 403 Forbidden, interceptor will handle logout and open login modal
        // Don't show error message in this case
        if (err?.response?.status !== 403) {
          setError(window.__t('fetchError'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchVideoDetails();
  }, [video]);

  // Xu ly upload khi navigate tu MainContent
  useEffect(() => {
    console.log('[Upload] useEffect triggered, videoId:', video?.id);
    console.log('[Upload] video?.uploadFile:', !!video?.uploadFile);
    console.log('[Upload] video?.uploadUrl:', !!video?.uploadUrl);
    console.log('[Upload] uploadCompletedRef.current:', uploadCompletedRef.current);
    console.log('[Upload] isUploadFinishedRef.current:', isUploadFinishedRef.current);
    console.log('[Upload] !uploadStartedRef.current:', !uploadStartedRef.current);
    console.log('[Upload] videoData:', !!videoData);
    console.log('[Upload] processingStatus:', !!processingStatus);

    // Skip if upload already completed
    if (uploadCompletedRef.current || isUploadFinishedRef.current) {
      console.log('[Upload] Skipping - upload already completed');
      return;
    }

    // Skip if we already have video data (upload was already processed)
    if (videoData && processingStatus) {
      console.log('[Upload] Skipping - video already processed');
      return;
    }

    // Neu video prop co upload info (tu MainContent navigate)
    if (video?.uploadFile && video?.uploadUrl && !uploadStartedRef.current) {
      console.log('[Upload] All conditions passed, starting upload for video:', video.id);
      // Set upload mode flag synchronously before any other useEffect runs
      isUploadModeRef.current = true;
      console.log('[Upload] isUploadModeRef set to true');

      // Bat dau upload (uploadStartedRef will be set INSIDE startUpload)
      startUpload(video.uploadFile, video.uploadUrl, video.uploadId, video.userEmail);
    } else {
      console.log('[Upload] Conditions NOT passed, skipping');
      if (uploadStartedRef.current) {
        console.log('[Upload] Skipped because uploadStartedRef.current is true');
      }
      if (videoData) {
        console.log('[Upload] Skipped because videoData already exists');
      }
    }
  }, [video]);

  useEffect(() => {
    const onGlobalSubmit = (ev) => {
      try {
        const text = ev?.detail?.text;
        if (text && !streamCancelRef.current) handleChatSend(text);
      } catch (e) { }
    };
    window.addEventListener("videoInput:submitted", onGlobalSubmit);
    return () => {
      window.removeEventListener("videoInput:submitted", onGlobalSubmit);
      if (streamCancelRef.current) {
        try {
          if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
          else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
        } catch (e) { }
        streamCancelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    console.log('[VideoDetail] useEffect [video?.id] triggered, videoId:', video?.id, 'uploadCompletedRef:', uploadCompletedRef.current);

    // Clean up streams when video changes
    if (streamCancelRef.current) {
      try {
        if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
        else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
      } catch (e) { }
      streamCancelRef.current = null;
    }
    answerRef.current = "";
    lastSentRef.current = { text: null, t: 0 };
    lastStatusChangeRef.current = Date.now();

    // Reset upload states ONLY when switching to video WITHOUT uploadUrl
    // If video has uploadUrl, it means we're in upload mode and should keep upload UI
    if (!video?.uploadUrl) {
      console.log('[VideoDetail] Resetting upload states - no uploadUrl on video');
      setIsUploading(false);
      setUploadProgress(0);
    }

    // Skip reset if upload đã hoàn thành cho video hiện tại
    if (uploadCompletedRef.current) {
      console.log('[VideoDetail] Skipping reset - upload already completed');
      return;
    }

    // Skip reset nếu đang trong upload mode
    if (isUploadModeRef.current || uploadStartedRef.current) {
      console.log('[VideoDetail] Skipping reset - upload in progress for this video');
      return;
    }

    console.log('[VideoDetail] Resetting progress for new video (video id changed)');
    // Reset progress chỉ khi thực sự chuyển sang video khác
    setSmoothProgress(0);
    lastVisualProgressRef.current = 0;
    setProcessingStatus(null); // Clear progress bar when switching videos
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, [video?.id]);

  useEffect(() => {
    console.log('[ChatHistory] useEffect triggered, video?.id:', video?.id, 'isUploadModeRef:', isUploadModeRef.current);
    let cancelled = false;
    const vid = video?.id || videoData?.id;
    if (!vid) {
      setChatMessages([]);
      console.log('[ChatHistory] No video id, clearing messages');
      return;
    }

    // Skip loading chat history when we're in upload mode (use ref for sync check)
    if (isUploadModeRef.current) {
      console.log('[ChatHistory] Skipping - upload mode detected');
      return;
    }

    console.log('[ChatHistory] Loading chat history for vid:', vid);
    (async () => {
      try {
        setChatMessages([]);
        const hist = await VideoService.getChatHistory(vid);
        if (!cancelled) {
          if (Array.isArray(hist)) {
            setChatMessages(hist);
            setTimeout(() => scrollToBottom(false), 30);
          } else if (hist && Array.isArray(hist.data)) {
            setChatMessages(hist.data);
            setTimeout(() => scrollToBottom(false), 30);
          } else {
            setChatMessages([]);
            setTimeout(() => scrollToBottom(false), 30);
          }
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to load chat history:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [video]);

  useEffect(() => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      } catch (e) {
        // Ignore scroll errors
      }
    }
  }, [chatMessages]);

  // Stream status updates if video is processing
  useEffect(() => {
    // Only stream if video exists and is not done/error
    if (!video?.id || !videoData) return;
    if (videoData.status === 'DONE' || videoData.status === 'ERROR') return;

    // Close any existing stream
    if (statusStreamRef.current) {
      statusStreamRef.current.close();
      statusStreamRef.current = null;
    }

    // Start SSE stream
    statusStreamRef.current = VideoService.streamVideoStatus({
      videoId: video.id,

      onStatusUpdate: (data) => {
        setProcessingStatus({
          status: data.status,
          progress: data.progress,
          message: data.message,
          updatedAt: data.updated_at,
        });

        // Start gradual progress increase
        startGradualProgress(data.progress);
        lastStatusChangeRef.current = Date.now();
      },

      onDone: async () => {
        // Processing complete - reload full video data to get reports
        try {
          const response = await VideoService.getVideoById(video.id);
          const rr1 = Array.isArray(response.reports_1) ? response.reports_1 : (response.reports_1 ? [response.reports_1] : []);
          let rr2 = Array.isArray(response.reports_2) ? response.reports_2 : (response.reports_2 ? [response.reports_2] : []);
          if ((!rr2 || rr2.length === 0) && rr1 && rr1.length > 0) {
            rr2 = rr1.map((it) => ({
              phase_index: it.phase_index,
              time_start: it.time_start,
              time_end: it.time_end,
              insight: it.insight ?? it.phase_description ?? "",
              video_clip_url: it.video_clip_url, // Include video_clip_url for preview
            }));
          }
          setVideoData({
            id: response.id || video.id,
            title: response.original_filename || video.original_filename,
            status: response.status,
            uploadedAt: response.created_at,
            reports_1: rr1,
            reports_2: rr2,
            report3: Array.isArray(response.report3) ? response.report3 : (response.report3 ? [response.report3] : []),
          });
          setProcessingStatus(null);
        } catch (err) {
          console.error('Failed to reload video after processing:', err);
        }
      },

      onError: (error) => {
        console.error('Status stream error:', error);
        setProcessingStatus(null);
        // Could implement polling fallback here
      },
    });

    // Cleanup
    return () => {
      if (statusStreamRef.current) {
        statusStreamRef.current.close();
        statusStreamRef.current = null;
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [video?.id, videoData?.status]);

  // console.log(normalizeMarkdownTable(chatMessages[7].answer || ""));

  // Clear progress bar if video is already DONE or ERROR (handles race conditions)
  useEffect(() => {
    if (videoData?.status === 'DONE' || videoData?.status === 'ERROR') {
      setProcessingStatus(null);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
  }, [videoData?.status]);

  // Define all processing steps in order
  const processingSteps = [
    { key: 'UPLOADING', label: 'ファイルをアップロードしています...' },
    { key: 'STEP_0_EXTRACT_FRAMES', label: window.__t('statusStep0') || 'Extract Frames' },
    { key: 'STEP_1_DETECT_PHASES', label: window.__t('statusStep1') || 'Detect Phases' },
    { key: 'STEP_2_EXTRACT_METRICS', label: window.__t('statusStep2') || 'Extract Metrics' },
    { key: 'STEP_3_TRANSCRIBE_AUDIO', label: window.__t('statusStep3') || 'Transcribe Audio' },
    { key: 'STEP_4_IMAGE_CAPTION', label: window.__t('statusStep4') || 'Image Caption' },
    { key: 'STEP_5_BUILD_PHASE_UNITS', label: window.__t('statusStep5') || 'Build Phase Units' },
    { key: 'STEP_6_BUILD_PHASE_DESCRIPTION', label: window.__t('statusStep6') || 'Build Description' },
    { key: 'STEP_7_GROUPING', label: window.__t('statusStep7') || 'Grouping' },
    { key: 'STEP_8_UPDATE_BEST_PHASE', label: window.__t('statusStep8') || 'Update Best Phase' },
    { key: 'STEP_9_BUILD_VIDEO_STRUCTURE_FEATURES', label: window.__t('statusStep9') || 'Build Features' },
    { key: 'STEP_10_ASSIGN_VIDEO_STRUCTURE_GROUP', label: window.__t('statusStep10') || 'Assign Group' },
    { key: 'STEP_11_UPDATE_VIDEO_STRUCTURE_GROUP_STATS', label: window.__t('statusStep11') || 'Update Stats' },
    { key: 'STEP_12_UPDATE_VIDEO_STRUCTURE_BEST', label: window.__t('statusStep12') || 'Update Best' },
    { key: 'STEP_13_BUILD_REPORTS', label: window.__t('statusStep13') || 'Build Reports' },
    { key: 'STEP_14_SPLIT_VIDEO', label: window.__t('statusStep14') || 'Split Video' },
  ];

  const processingSteps2 = [
    { key: 'UPLOADING', label: 'ファイルをアップロードしています...' },
    { key: 'STEP_0_EXTRACT_FRAMES', label: window.__t('statusStep0') || 'Extract Frames' },
    { key: 'STEP_1_DETECT_PHASES', label: window.__t('statusStep1') || 'Detect Phases' },
    { key: 'STEP_2_EXTRACT_METRICS', label: window.__t('statusStep2') || 'Extract Metrics' },
    { key: 'STEP_3_TRANSCRIBE_AUDIO', label: window.__t('statusStep3') || 'Transcribe Audio' }
  ];

  // Get step status: 'completed', 'current', 'pending', or null (for upload phase)
  const getStepStatus = (stepKey, currentStatus) => {
    const currentIndex = processingSteps.findIndex(s => s.key === currentStatus);
    const stepIndex = processingSteps.findIndex(s => s.key === stepKey);
    if (stepIndex == 0) return 'completed'; // Always mark upload step as completed
    if (currentStatus === 'ERROR') return 'error';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    // if (currentStatus == 'uploaded') return 'completed';
    return 'pending';
  };

  const getStepStatus2 = (stepKey, currentStatus) => {
    const currentIndex = processingSteps2.findIndex(s => s.key === currentStatus);
    const stepIndex = processingSteps2.findIndex(s => s.key === stepKey);

    if (currentStatus === 'ERROR') return 'error';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'pending';
  };

  // Render step icon based on status
  const renderStepIcon = (status) => {
    if (status === 'completed') {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500/20 text-green-400">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }

    if (status === 'current') {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20">
          <svg className="w-4 h-4 text-purple-400 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-700/50 border border-gray-600">
        <div className="w-2 h-2 rounded-full bg-gray-500"></div>
      </div>
    );
  };

  // Get visible steps window (max 5 steps, current step in middle)
  const getVisibleSteps = (currentStatus) => {
    const currentIndex = processingSteps.findIndex(s => s.key === currentStatus);
    const totalSteps = processingSteps.length;

    // Always show 5 steps or less if near boundaries
    let startIndex = Math.max(0, currentIndex - 2); // Current step in middle (index 2)
    let endIndex = Math.min(totalSteps, startIndex + 5);

    // Adjust if we're near the end
    if (endIndex - startIndex < 5) {
      startIndex = Math.max(0, endIndex - 5);
    }

    return {
      steps: processingSteps.slice(startIndex, endIndex),
      startIndex,
      isFirst: startIndex === 0,
      isLast: endIndex === totalSteps,
    };
  };

  // Render processing status UI
  const renderProcessingStatus = () => {
    if (isUploading) {
      return (
        <div className="mt-4 p-4 rounded-lg bg-white/5">
          {/* Upload message */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold">
              {getStatusMessage(null, true, uploadProgress)}
            </span>
            <span className="text-sm text-gray-400">
              {uploadProgress}%
            </span>
          </div>

          {/* Upload step */}
          <div className="mb-4 space-y-2">
            {processingSteps2.map((step) => {
              const stepStatus = getStepStatus2(step.key, 'UPLOADING');
              const isActive = stepStatus === 'current';
              const isCompleted = stepStatus === 'completed';

              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 transition-all duration-300 ${
                    isActive ? 'opacity-100' : isCompleted ? 'opacity-60' : 'opacity-40'
                  }`}
                >
                  {renderStepIcon(stepStatus)}
                  <span className={`text-sm ${
                    isActive ? 'text-white font-medium' :
                    isCompleted ? 'text-gray-300' :
                    'text-gray-400'
                  }`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      );
    }

    if (!processingStatus) return null;

    const { status, message } = processingStatus;
    const isError = status === 'ERROR';

    const rawProgress = Number.isFinite(smoothProgress) ? smoothProgress : 0;
    const baseUploadProgress = Number.isFinite(uploadProgress) ? uploadProgress : 0;
    const effectiveProgress = Math.max(
      lastVisualProgressRef.current || 0,
      rawProgress,
      baseUploadProgress
    );
    lastVisualProgressRef.current = effectiveProgress;

    // Get visible steps window (max 5 visible, current step in middle)
    const { steps: visibleSteps, isFirst, isLast } = getVisibleSteps(status);

    return (
      <div className={`mt-4 p-6 rounded-lg ${isError ? 'bg-red-500/10 border border-red-500/50' : 'bg-white/5 border border-white/10'}`}>
        <div className="flex flex-col gap-2 text-center">
          <div className="inline-flex self-start items-center mx-auto rounded-[50px] h-[41px] px-4 border border-white/10">
            <div className="text-[16px] font-bold whitespace-nowrap text-white bg-clip-text">
              {videoData?.title || video.original_filename}
            </div>
          </div>
        </div>
        
        {/* Steps indicator - max 5 visible, current in middle */}
        <div className="mb-4 space-y-2">
          {/* Show ellipsis if not at start */}
          {!isFirst && (
            <div className="flex items-center gap-3 text-gray-500">
              <div className="flex items-center justify-center w-6">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-xs text-gray-500">...</span>
            </div>
          )}

          {/* Visible steps */}
          {visibleSteps.map((step) => {
            const stepStatus = getStepStatus(step.key, status);
            const isActive = stepStatus === 'current';
            const isCompleted = stepStatus === 'completed';

            return (
              <div
                key={step.key}
                className={`flex items-center gap-3 transition-all duration-300 ${
                  isActive ? 'opacity-100' : isCompleted ? 'opacity-60' : 'opacity-40'
                }`}
              >
                {renderStepIcon(stepStatus)}
                <span className={`text-sm ${
                  isActive ? 'text-white font-medium' :
                  isCompleted ? 'text-gray-300' :
                  'text-gray-400'
                }`}>
                  {step.label}
                </span>
              </div>
            );
          })}

          {/* Show ellipsis if not at end */}
          {!isLast && (
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
        {!isError && effectiveProgress >= 0 && (
          <>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${effectiveProgress}%` }}
              />
            </div>
            {/* Current status message */}
        <div className="flex items-center justify-between mb-4 mt-1">
          <span className="text-sm font-semibold">
            {message}
          </span>
          {!isError && (
            <span className="text-sm text-gray-400">
              {Math.round(effectiveProgress)}%
            </span>
          )}
        </div>

            <p className="text-sm text-gray-400 mt-5 text-center">
              {window.__t('progressCompleteMessage')}
            </p>
          </>
        )}

        {/* Error message */}
        {isError && (
          <p className="text-sm text-red-400 mt-2">
            {window.__t('errorAnalysisMessage')}
          </p>
        )}
      </div>
    );
  };

  if (!video) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gray-400 text-lg">{window.__t('noVideo')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error && !videoData) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-red-400 text-lg">{error}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden w-full h-full flex flex-col gap-6 p-0 md:overflow-auto lg:p-6">
      <style>{markdownTableStyles}</style>
      <h4 className="md:top-[5px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
        {window.__t('header').split('\n').map((line, idx, arr) => (
          <span key={idx}>
            {line}
            {idx < arr.length - 1 && <br className="block md:hidden" />}
          </span>
        ))}
      </h4>
      {/* Video Header */}
      <div className="flex flex-col overflow-hidden md:overflow-auto h-full">

        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto text-left md:mb-0">
          {/* Show processing status when video is being processed */}
          {renderProcessingStatus()}

          {/* Show thank you message and reports only when video is done */}
          {videoData?.status === 'DONE' && videoData?.reports_1 && videoData.reports_1.length > 0 && (
            <div className="rounded-lg font-[Cabin] font-semibold text-[18px] leading-[35px] tracking-[0]">
              <div className="mt-4">{window.__t('thankYou')}</div>
              <div className="mb-2">
                {window.__t('analysisDone').split('\n').map((line, idx, arr) => (
                  <span key={idx}>
                    {line}
                    {idx < arr.length - 1 && <br className="block md:hidden" />}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 font-semibold flex flex-col gap-3">
            {videoData?.status === 'DONE' && videoData?.reports_1 && videoData.reports_1.length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* Report 1: phase descriptions */}
                <div className="text-lg font-semibold mb-2">{window.__t('report1Title') || 'Report 1'}</div>
                {videoData.reports_1.map((it, index) => (
                  <div
                    key={`r1-${it.phase_index ?? index}`}
                    className={`grid grid-cols-1 md:grid-cols-[150px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md
                    `}
                  >
                    <div
                      className={`flex items-center gap-1 text-sm text-gray-400 font-mono whitespace-nowrap w-fit cursor-pointer hover:text-purple-400 ${previewLoading ? "opacity-60 pointer-events-none" : ""
                        }`}
                      onClick={() => handlePhasePreview(it)}
                      title={window.__t('clickToPreview')}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth="1.5"
                        stroke="currentColor"
                        className="size-6 mt-[-2px]"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                        />
                      </svg>


                      {it.time_start != null || it.time_end != null ? (
                        <>
                          {formatTime(it.time_start)}
                          {" – "}
                          {formatTime(it.time_end)}
                        </>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </div>

                    <div className="text-sm text-left text-gray-100">
                      <div className="markdown">
                        <MarkdownWithTables
                          markdown={it.phase_description || window.__t('noDescription')}
                          isOldSafariIOS={isOldSafariIOS}
                          keyPrefix={`r1-${it.phase_index ?? index}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Report 2: insights - prefer reports_2 if present, otherwise use reports_1.insight */}
                {(videoData.reports_2 || videoData.reports_1) && (
                  <div className="mt-2">
                    <div className="text-lg font-semibold mb-2">{window.__t('report2Title') || 'Report 2'}</div>
                    <div className="flex flex-col gap-3">
                      {(videoData.reports_2 || videoData.reports_1).map((it, idx) => {
                        const keyId = it.phase_index ?? idx;
                        const isOpen = !!expandedR2[keyId];
                        return (
                          <div
                            key={`r2-${keyId}`}
                            className={`grid grid-cols-1 md:grid-cols-[150px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md ${previewLoading ? "opacity-60 pointer-events-none" : ""}`}
                          >
                            <div
                              className={`flex items-center gap-1 text-sm text-gray-400 font-mono whitespace-nowrap w-fit cursor-pointer hover:text-purple-400 transition-colors ${previewLoading ? "opacity-60 pointer-events-none" : ""}`}
                              onClick={() => handlePhasePreview(it)}
                              title={window.__t('clickToPreview')}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth="1.5"
                                stroke="currentColor"
                                className="size-6 mt-[-2px]"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                                />
                              </svg>

                              {it.time_start != null || it.time_end != null ? (
                                <>
                                  {formatTime(it.time_start)}
                                  {" – "}
                                  {formatTime(it.time_end)}
                                </>
                              ) : (
                                <span className="text-gray-500">-</span>
                              )}
                            </div>

                            <div className="text-sm text-left text-gray-100 relative min-w-0">
                              <div className={`${isOpen ? '' : 'truncate'} pr-0 md:pr-10`}>
                                {isOpen ? (
                                  <div id={`r2-content-${keyId}`} className="markdown">
                                    <MarkdownWithTables
                                      markdown={it.insight || it.phase_description || window.__t('noInsight')}
                                      isOldSafariIOS={isOldSafariIOS}
                                      keyPrefix={`r2-${keyId}`}
                                    />
                                  </div>
                                ) : (
                                  <div className="truncate text-gray-200">
                                    <MarkdownWithTables
                                      markdown={(it.insight || it.phase_description || '').split('\n')[0] || <span className="text-gray-500">-</span>}
                                      isOldSafariIOS={isOldSafariIOS}
                                      keyPrefix={`r2-${keyId}`}
                                    />
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedR2((prev) => ({ ...prev, [keyId]: !prev[keyId] })); }}
                                className="absolute right-3 top-[-25px] -translate-y-1/2 text-gray-400 hover:text-purple-400 p-1 rounded z-10 cursor-pointer md:top-2.5"
                                aria-expanded={isOpen}
                                aria-controls={`r2-content-${keyId}`}
                                aria-label={isOpen ? window.__t('collapse') : window.__t('expand')}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Report 3: additional single-item report (title + content) */}
                {videoData?.report3 && Array.isArray(videoData.report3) && videoData.report3.length > 0 && (
                  <div className="mt-4">
                    <div className="text-lg font-semibold mb-2">{window.__t('report3Title') || 'Report 3'}</div>
                    {videoData.report3.map((r, i) => (
                      <div
                        key={`r3-${i}`}
                        className={`grid min-w-0 grid-cols-1 md:grid-cols-[100px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md
                        }`}
                      >
                        <p className="text-sm text-gray-400 font-mono whitespace-normal mt-0 break-words break-all md:mt-3">
                          {r.title ? r.title : <span className="text-gray-500">-</span>}
                        </p>

                        <div className="text-sm text-left text-gray-100">
                          <div className="markdown">
                            <MarkdownWithTables
                              markdown={r.content || ""}
                              isOldSafariIOS={isOldSafariIOS}
                              keyPrefix={`r3-${i}`}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="">
              </div>
            )}
            {chatMessages && chatMessages.length > 0 && (
              <div className="flex flex-col gap-4">
                {chatMessages.map((item) => (
                  <div key={item.id || `${item.question}-${item.created_at || ''}`} className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md">
                      <div className="text-xs text-gray-400 font-mono">{window.__t('userLabel')}</div>
                      <div className="min-w-0 text-sm text-gray-100 whitespace-pre-wrap break-words">{item.question}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md">
                      <div className="text-xs text-gray-400 font-mono">{window.__t('botLabel')}</div>
                      <div className="min-w-0 text-sm text-gray-100">
                        <div className="markdown">
                          <MarkdownWithTables
                            markdown={item.answer || ""}
                            isOldSafariIOS={isOldSafariIOS}
                            keyPrefix={`chat-${item.id || item.created_at || ""}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:block mt-4 pb-4">
          <ChatInput onSend={handleChatSend} disabled={!!streamCancelRef.current} />
        </div>
      </div>

      <VideoPreviewModal
        open={!!previewData}
        onClose={() => setPreviewData(null)}
        videoUrl={previewData?.url}
        timeStart={previewData?.timeStart}
        timeEnd={previewData?.timeEnd}
        skipSeek={previewData?.skipSeek}
      />
    </div>
  );
}

