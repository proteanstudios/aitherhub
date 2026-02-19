import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import MarkdownWithTables from "./markdown/MarkdownWithTables";
import ChatInput from "./ChatInput";
import VideoPreviewModal from "./modals/VideoPreviewModal";
import VideoService from "../base/services/videoService";
import "../assets/css/sidebar.css";
import AnalyticsSection from "./AnalyticsSection";
import ClipSection from "./ClipSection";

export default function VideoDetail({ videoData }) {
  const markdownTableStyles = `
  .markdown table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
  }
  .markdown th,
  .markdown td {
    border: 1px solid rgba(0,0,0,0.1);
    padding: 0.5rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }
  .markdown th {
    font-weight: 600;
    background: rgba(0,0,0,0.03);
  }
  .markdown tr:nth-child(even) td {
    background: rgba(0,0,0,0.02);
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
    color: rgba(0,0,0,0.7);
    opacity: 0.95;
    font-size: 0.95em;
  }
  .markdown hr {
    border: none;
    border-top: 1px solid rgba(0,0,0,0.1);
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
  const [loading] = useState(false);
  const [error] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [previewData, setPreviewData] = useState(null); // { url, timeStart, timeEnd, isClipPreview }
  const [, setPreviewLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const hasAnswerStartedRef = useRef(false);
  const answerRef = useRef("");
  const streamCancelRef = useRef(null);
  const lastSentRef = useRef({ text: null, t: 0 });
  const reloadTimeoutRef = useRef(null);
  const chatEndRef = useRef(null);

  const [reportCollapsed, setReportCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [expandedTimeline, setExpandedTimeline] = useState({});

  // Clip generation state: { [phaseIndex]: { status, clip_url, error } }
  const [clipStates, setClipStates] = useState({});
  const clipPollingRef = useRef({});

  // Load existing clip statuses when video loads
  useEffect(() => {
    if (!videoData?.id) return;
    (async () => {
      try {
        const res = await VideoService.listClips(videoData.id);
        if (res?.clips && res.clips.length > 0) {
          const states = {};
          for (const clip of res.clips) {
            states[clip.phase_index] = {
              status: clip.status,
              clip_url: clip.clip_url || null,
            };
          }
          setClipStates(states);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      // Cleanup polling on unmount
      Object.values(clipPollingRef.current).forEach(clearInterval);
    };
  }, [videoData?.id]);

  const handleClipGeneration = async (item, phaseIndex) => {
    if (!videoData?.id) return;
    const timeStart = Number(item.time_start);
    const timeEnd = Number(item.time_end);
    if (isNaN(timeStart) || isNaN(timeEnd)) return;

    // Set loading state
    setClipStates(prev => ({
      ...prev,
      [phaseIndex]: { status: 'requesting' },
    }));

    try {
      const res = await VideoService.requestClipGeneration(videoData.id, phaseIndex, timeStart, timeEnd);

      if (res.status === 'completed' && res.clip_url) {
        setClipStates(prev => ({
          ...prev,
          [phaseIndex]: { status: 'completed', clip_url: res.clip_url },
        }));
        return;
      }

      setClipStates(prev => ({
        ...prev,
        [phaseIndex]: { status: res.status || 'pending' },
      }));

      // Start polling for status
      if (clipPollingRef.current[phaseIndex]) {
        clearInterval(clipPollingRef.current[phaseIndex]);
      }
      clipPollingRef.current[phaseIndex] = setInterval(async () => {
        try {
          const statusRes = await VideoService.getClipStatus(videoData.id, phaseIndex);
          if (statusRes.status === 'completed' && statusRes.clip_url) {
            setClipStates(prev => ({
              ...prev,
              [phaseIndex]: { status: 'completed', clip_url: statusRes.clip_url },
            }));
            clearInterval(clipPollingRef.current[phaseIndex]);
            delete clipPollingRef.current[phaseIndex];
          } else if (statusRes.status === 'failed') {
            setClipStates(prev => ({
              ...prev,
              [phaseIndex]: { status: 'failed', error: statusRes.error_message },
            }));
            clearInterval(clipPollingRef.current[phaseIndex]);
            delete clipPollingRef.current[phaseIndex];
          }
        } catch (e) {
          // continue polling
        }
      }, 5000); // Poll every 5 seconds

    } catch (e) {
      setClipStates(prev => ({
        ...prev,
        [phaseIndex]: { status: 'failed', error: e.message },
      }));
    }
  };

  const scrollToBottom = (smooth = true) => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
      } catch {
        // Ignore scroll errors
        void 0;
      }
    }
  };

  // Detect old Safari iOS (<=16) - remark-gfm table parsing can crash/blank-screen on these versions.
  const isOldSafariIOS = (() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent;
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(ua);
    if (!isSafariBrowser) return false;
    const iosVersionMatch = ua.match(/OS (\d+)_/);
    if (iosVersionMatch) {
      const majorVersion = parseInt(iosVersionMatch[1], 10);
      return majorVersion <= 16;
    }
    return false;
  })();

  const formatTime = (seconds) => {
    if (seconds == null || isNaN(seconds)) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePhasePreview = async (phase) => {
    console.log('handlePhasePreview called with phase:', {
      time_start: phase?.time_start,
      time_end: phase?.time_end,
      phase_index: phase?.phase_index,
      video_clip_url: phase?.video_clip_url,
    });

    if (!phase?.time_start && !phase?.time_end) {
      return;
    }
    if (!videoData?.id) {
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
        } catch {
          try {
            const controller2 = new AbortController();
            const id2 = setTimeout(() => controller2.abort(), timeout);
            const res2 = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, mode: 'cors', signal: controller2.signal });
            clearTimeout(id2);
            return res2.status === 206 || res2.status === 200;
          } catch {
            return false;
          }
        }
      };

      let url = null;
      let okPhaseUrl = false;

      if (phase?.video_clip_url) {
        const ok = await checkUrl(phase.video_clip_url);
        if (ok) {
          url = phase.video_clip_url;
          okPhaseUrl = true;
        }
      }

      if (!url) {
        try {
          const downloadUrl = await VideoService.getDownloadUrl(videoData.id);
          url = downloadUrl;
        } catch (err) {
          console.error('Failed to get backend download URL', err);
        }
      }

      if (!url) {
        console.error('No preview URL available for this phase');
        return;
      }

      const previewDataObj = {
        url,
        timeStart: Number(phase.time_start) || 0,
        timeEnd: phase.time_end != null ? Number(phase.time_end) : null,
        isClipPreview: !!okPhaseUrl,
      };

      setPreviewData(previewDataObj);
    } catch (err) {
      console.error("Failed to load preview url", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const reloadHistory = async () => {
    const vid = videoData?.id;
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
      const vid = videoData?.id;
      if (streamCancelRef.current) {
        return;
      }
      const hasReport = !!(videoData && Array.isArray(videoData.reports_1) && videoData.reports_1.length > 0);
      const statusDone = (videoData && (String(videoData.status || "").toUpperCase() === "DONE")) || false;
      if (!vid || !(hasReport || statusDone)) {
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
        } catch {
          void 0;
        }
        streamCancelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      answerRef.current = "";
      hasAnswerStartedRef.current = false;

      const localId = `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      setChatMessages((prev) => [...prev, { id: localId, question: text, answer: "" }]);
      setIsThinking(true);

      const streamHandle = VideoService.streamChat({
        videoId: videoData?.id,
        messages: [{ role: "user", content: text }],
        onMessage: (chunk) => {
          try {
            if (!hasAnswerStartedRef.current) {
              hasAnswerStartedRef.current = true;
              setIsThinking(false);
            }
            let processed = chunk;
            try {
              processed = processed.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n");
              processed = processed.replace(/([.!?])\s+([A-ZÀ-ỸÂÊÔƠƯĂĐ])/g, "$1\n$2");
            } catch {
              void 0;
            }

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
          setIsThinking(false);
          if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
          reloadTimeoutRef.current = setTimeout(() => {
            reloadHistory();
            reloadTimeoutRef.current = null;
          }, 500);
        },
        onError: (err) => {
          console.error("Chat stream error:", err);
          streamCancelRef.current = null;
          setIsThinking(false);
        },
      });

      streamCancelRef.current = streamHandle;
    } catch (err) {
      console.error("handleChatSend error:", err);
      setIsThinking(false);
    }
  };

  useEffect(() => {
    const onGlobalSubmit = (ev) => {
      try {
        const text = ev?.detail?.text;
        if (text && !streamCancelRef.current) handleChatSend(text);
      } catch {
        void 0;
      }
    };
    window.addEventListener("videoInput:submitted", onGlobalSubmit);
    return () => {
      window.removeEventListener("videoInput:submitted", onGlobalSubmit);
      if (streamCancelRef.current) {
        try {
          if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
          else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
        } catch {
          void 0;
        }
        streamCancelRef.current = null;
      }
      setIsThinking(false);
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    console.log("Loading chat history for video:", videoData);
    let cancelled = false;
    const vid = videoData?.id;
    if (!vid) {
      setChatMessages([]);
      return;
    }

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
  }, [videoData]);

  useEffect(() => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      } catch {
        void 0;
      }
    }
  }, [chatMessages]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600"></div>
      </div>
    );
  }

  if (error && !videoData) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-red-500 text-lg">{error}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden w-full h-full flex flex-col gap-6 p-0 md:overflow-auto lg:p-6">
      <style>{markdownTableStyles}</style>
      {/* Video Header */}
      <div className="flex flex-col overflow-hidden md:overflow-auto h-full w-full mx-auto">
        <div className="flex flex-col gap-2 items-center">
          <div className="px-4 py-2 rounded-full border border-gray-200 bg-gray-50 text-gray-700 text-xs">
            {videoData?.original_filename}
          </div>
        </div>
        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto scrollbar-custom text-left px-0 md:px-4 md:mb-0">
          {/* Clip Section - show generated clips at the top */}
          <ClipSection videoData={videoData} clipStates={clipStates} reports1={videoData?.reports_1} />

          {/* Analytics Section - above report */}
          <AnalyticsSection reports1={videoData?.reports_1} videoData={videoData} />

          <div className="w-full mt-6 mx-auto">
            <div className="rounded-2xl bg-gray-50 border border-gray-200">
              <div onClick={() => setReportCollapsed((s) => !s)} className="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-100 transform transition-all duration-200">
                <div className="flex items-center gap-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-target w-5 h-5 text-gray-700"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                  <div>
                    <div className="text-gray-900 text-xl font-semibold">{'レポート：全体戦略'}</div>
                    <div className="text-gray-500 text-sm mt-1">{videoData?.created_at ? new Date(videoData.created_at).toLocaleString() : ''}</div>
                  </div>
                </div>

                <button
                  type="button"
                  aria-expanded={!reportCollapsed}
                  aria-label={reportCollapsed ? (window.__t ? window.__t('expand') : 'expand') : (window.__t ? window.__t('collapse') : 'collapse')}
                  className="text-gray-400 p-2 rounded focus:outline-none transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-6 h-6 transform transition-transform duration-200 ${!reportCollapsed ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {/* Inner panels: tag + summary + suggestion */}
              {!reportCollapsed && (
                <div className="px-5 flex flex-col gap-4">
                  {videoData?.report3 && Array.isArray(videoData.report3) && videoData.report3.length > 0 && videoData.report3.map((r, i) => (
                    <div key={`report3-${i}`} className="rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
                      <div className="flex items-start gap-4">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-600">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-flame w-3.5 h-3.5"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
                          <span>高インパクト</span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4">
                        <div className="flex items-start gap-4">
                          <div className="text-blue-500">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-text w-4 h-4 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-blue-600 font-medium text-xs">概要</div>
                            <div className="text-gray-700 mt-2 text-sm">
                              <div className="markdown">
                                <MarkdownWithTables
                                  markdown={r.title || window.__t('noDescription')}
                                  isOldSafariIOS={isOldSafariIOS}
                                  keyPrefix={`report3-title-${i}`}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-start gap-4">
                          <div className="text-green-500">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check w-4 h-4 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-green-600 font-medium text-xs">提案</div>
                            <div className="text-gray-700 mt-2 text-sm">
                              <div className="markdown">
                                <MarkdownWithTables
                                  markdown={r.content || window.__t('noDescription')}
                                  isOldSafariIOS={isOldSafariIOS}
                                  keyPrefix={`report3-content-${i}`}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Divider and Timeline Section */}
                  <div className="space-y-3 pt-2 border-t border-gray-200">
                    <div
                      className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-gray-100 transform transition-all duration-200"
                      onClick={() => setTimelineCollapsed((s) => !s)}
                    >
                      <div className="flex items-center gap-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock w-4 h-4 text-gray-400"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <div>
                          <div className="text-gray-600 text-base font-semibold">詳細分析（タイムライン）</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="text-gray-400 rounded focus:outline-none transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-6 h-6 transform transition-transform duration-200 cursor-pointer ${!timelineCollapsed ? 'rotate-180' : ''}`}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* Report Section */}
                    <div className="pb-4">
                      {!timelineCollapsed && videoData?.reports_1 && videoData.reports_1.map((item, index) => {
                        const itemKey = item.phase_index ?? index;
                        return (
                          <div key={`timeline-${itemKey}`}>
                            <div className="mt-4 rounded-xl bg-white border border-gray-200 shadow-sm mx-5">
                              <div
                                className={`flex items-start justify-between flex-col md:flex-row gap-4 px-4 py-3 border-l-4 border-orange-400 rounded-xl transition-colors cursor-pointer ${expandedTimeline[itemKey] ? 'bg-orange-50 hover:bg-orange-50' : 'hover:bg-gray-50'
                                  }`}
                                role="button"
                                tabIndex={0}
                                aria-expanded={!!expandedTimeline[itemKey]}
                                onClick={() => setExpandedTimeline((prev) => ({ ...prev, [itemKey]: !prev[itemKey] }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setExpandedTimeline((prev) => ({ ...prev, [itemKey]: !prev[itemKey] }));
                                  }
                                }}
                              >
                                <div className="w-full flex items-start justify-between gap-4">
                                  <div className="flex flex-1 min-w-0 items-start gap-3">
                                    <div
                                      className="flex items-start gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePhasePreview(item);
                                      }}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                        className="lucide lucide-play w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                      <div className="text-gray-700 text-sm font-semibold whitespace-nowrap">
                                        {item.time_start != null || item.time_end != null ? (
                                          <>
                                            {formatTime(item.time_start)}
                                            {" – "}
                                            {formatTime(item.time_end)}
                                          </>
                                        ) : (
                                          <span className="text-gray-400">-</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`hidden flex-1 min-w-0 text-gray-600 text-sm ${expandedTimeline[itemKey] ? 'md:block' : 'md:line-clamp-1'
                                        }`}
                                    >
                                      {item.phase_description || window.__t('noDescription')}
                                    </div>
                                  </div>
                                  <div className="flex items-start gap-2 text-orange-500 flex-shrink-0 mt-0.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-flame w-4 h-4"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                      stroke="currentColor" strokeWidth="1.5"
                                      className={`w-5 h-5 text-gray-400 transition-transform duration-200
                                  cursor-pointer 
                                  ${expandedTimeline[itemKey] ? 'rotate-180' : ''}`}
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                </div>
                                <div
                                  className={`md:hidden min-w-0 text-gray-600 text-sm ${!expandedTimeline[itemKey] ? 'line-clamp-1' : ''
                                    }`}
                                >
                                  {item.phase_description || window.__t('noDescription')}
                                </div>
                                {/* CSV Metrics Badges */}
                                {item.csv_metrics && (
                                  (() => {
                                    const m = item.csv_metrics;
                                    const hasAnyData = m.gmv > 0 || m.order_count > 0 || m.viewer_count > 0 || m.like_count > 0 || m.comment_count > 0 || m.new_followers > 0 || m.product_clicks > 0;
                                    if (!hasAnyData) return null;
                                    return (
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {m.gmv > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 border border-yellow-300">
                                            <span>{'\u00A5'}</span>{Math.round(m.gmv).toLocaleString()}
                                          </span>
                                        )}
                                        {m.order_count > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 border border-green-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                                            {m.order_count}件
                                          </span>
                                        )}
                                        {m.viewer_count > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                            {m.viewer_count.toLocaleString()}
                                          </span>
                                        )}
                                        {m.like_count > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-pink-100 text-pink-700 border border-pink-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                                            {m.like_count.toLocaleString()}
                                          </span>
                                        )}
                                        {m.comment_count > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                            {m.comment_count}
                                          </span>
                                        )}
                                        {m.new_followers > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-100 text-cyan-700 border border-cyan-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                                            +{m.new_followers}
                                          </span>
                                        )}
                                        {m.product_clicks > 0 && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 border border-orange-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                                            {m.product_clicks}クリック
                                          </span>
                                        )}
                                        {m.product_names && m.product_names.length > 0 && (
                                          m.product_names.map((name, idx) => (
                                            <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700 border border-indigo-300">
                                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                                              {name}
                                            </span>
                                          ))
                                        )}
                                      </div>
                                    );
                                  })()
                                )}
                              </div>
                            </div>
                            {/* Expanded content sections */}
                            {expandedTimeline[itemKey] && (
                              <div className="px-4 pb-4 mt-4 ml-15 flex flex-col gap-4 rounded-xl py-3 bg-gray-50 border border-gray-200 mr-5">
                                {/* 概要 (Overview) section */}
                                <div className="flex items-start gap-4">
                                  <div className="text-blue-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-text w-4 h-4 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-blue-600 font-medium text-xs">概要</div>
                                    <div className="text-gray-700 mt-2 text-sm">
                                      <div className="markdown">
                                        <MarkdownWithTables
                                          markdown={item.phase_description || window.__t('noDescription')}
                                          isOldSafariIOS={isOldSafariIOS}
                                          keyPrefix={`timeline-overview-${itemKey}`}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* 提案 (Suggestion) section */}
                                {item.insight && (
                                  <div className="flex items-start gap-4">
                                    <div className="text-green-500">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check w-4 h-4 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-green-600 font-medium text-xs">提案</div>
                                      <div className="text-gray-700 mt-2 text-sm">
                                        <div className="markdown">
                                          <MarkdownWithTables
                                            markdown={item.insight || window.__t('noInsight')}
                                            isOldSafariIOS={isOldSafariIOS}
                                            keyPrefix={`timeline-insight-${itemKey}`}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* TikTok Clip Generation Button */}
                                {item.time_start != null && item.time_end != null && (() => {
                                  const clipState = clipStates[itemKey];
                                  const isLoading = clipState?.status === 'requesting' || clipState?.status === 'pending' || clipState?.status === 'processing';
                                  const isCompleted = clipState?.status === 'completed' && clipState?.clip_url;
                                  const isFailed = clipState?.status === 'failed';

                                  return (
                                    <div className="flex items-center gap-3 pt-3 mt-3 border-t border-gray-200">
                                      <div className="text-purple-500">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
                                          <path d="M12 2v4"/><path d="m15.2 7.6 2.4-2.4"/><path d="M18 12h4"/><path d="m15.2 16.4 2.4 2.4"/><path d="M12 18v4"/><path d="m4.4 19.6 2.4-2.4"/><path d="M2 12h4"/><path d="m4.4 4.4 2.4 2.4"/>
                                        </svg>
                                      </div>
                                      {isCompleted ? (
                                        <a
                                          href={clipState.clip_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-medium hover:from-purple-600 hover:to-pink-600 transition-all shadow-sm"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                          </svg>
                                          切り抜きをダウンロード
                                        </a>
                                      ) : isLoading ? (
                                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium">
                                          <div className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-purple-500 animate-spin" />
                                          切り抜き生成中...
                                        </div>
                                      ) : (
                                        <>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleClipGeneration(item, itemKey);
                                            }}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-medium hover:from-purple-600 hover:to-pink-600 transition-all shadow-sm hover:shadow-md"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/>
                                            </svg>
                                            TikTok切り抜きを生成
                                          </button>
                                          {isFailed && (
                                            <span className="text-red-500 text-xs">生成に失敗しました。再試行してください。</span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                  </div>
                </div>
              )}

            </div>

          </div>
          {/* Questions and Answers Section */}
          <div className="space-y-3 pt-4 mt-4 border-t border-gray-200">
            <p className="text-gray-400 text-xs text-center">質問と回答</p>
            <div className="rounded-2xl p-4 max-w-[85%] bg-gray-50 border border-gray-200">
              <p className="text-gray-700 text-sm">
                この動画の解析が完了しました。全体的に良い構成ですが、いくつかの改善点が見つかりました。詳細について質問があれば、お聞きください。
              </p>
            </div>
            {/* Chat Section */}
            {chatMessages && chatMessages.length > 0 && (
              <div className="mt-6 flex flex-col gap-4">
                {chatMessages.map((item) => (
                  <div key={item.id || `${item.question}-${item.created_at || ''}`} className="flex flex-col gap-4">
                    <div className="w-[80%] mx-auto rounded-2xl bg-blue-600 px-6 py-4">
                      <p className="text-white text-sm font-medium">{item.question}</p>
                    </div>
                    {item.answer && (
                      <div className="w-[80%] rounded-2xl p-6 bg-gray-50 border border-gray-200">
                        <div className="text-gray-700 text-sm leading-relaxed">
                          <div className="markdown">
                            <MarkdownWithTables
                              markdown={item.answer || ""}
                              isOldSafariIOS={isOldSafariIOS}
                              keyPrefix={`chat-${item.id || item.created_at || ""}`}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isThinking && (
                  <div className="w-[80%] rounded-2xl p-4 bg-gray-50 border border-gray-200">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
                      <p className="text-gray-500 text-sm">{window.__t ? window.__t("aiThinking") : "AI is thinking..."}</p>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="w-full mx-auto hidden md:block mt-4 pb-4">
          <ChatInput onSend={handleChatSend} disabled={!!streamCancelRef.current} />
        </div>
      </div>

      <VideoPreviewModal
        open={!!previewData}
        onClose={() => setPreviewData(null)}
        videoUrl={previewData?.url}
        timeStart={previewData?.timeStart}
        timeEnd={previewData?.timeEnd}
        isClipPreview={previewData?.isClipPreview}
      />
    </div>
  );
}
