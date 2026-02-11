import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import MarkdownWithTables from "./markdown/MarkdownWithTables";
import ChatInput from "./ChatInput";
import VideoPreviewModal from "./modals/VideoPreviewModal";
import VideoService from "../base/services/videoService";
import "../assets/css/sidebar.css";

export default function VideoDetail({ videoData }) {
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
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [previewData, setPreviewData] = useState(null); // { url, timeStart, timeEnd }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [expandedR2, setExpandedR2] = useState({});
  const answerRef = useRef("");
  const streamCancelRef = useRef(null);
  const lastSentRef = useRef({ text: null, t: 0 });
  const reloadTimeoutRef = useRef(null);
  const chatEndRef = useRef(null);

  // Smooth progress bar animation - gradual increase every few seconds
  const [smoothProgress, setSmoothProgress] = useState(0);
  const progressIntervalRef = useRef(null);
  const lastStatusChangeRef = useRef(Date.now());
  const [reportCollapsed, setReportCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [expandedTimeline, setExpandedTimeline] = useState({});

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
      const vid = videoData?.id;
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
      setIsThinking(true);

      const streamHandle = VideoService.streamChat({
        videoId: videoData?.id,
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
      } catch (e) {
        // Ignore scroll errors
      }
    }
  }, [chatMessages]);

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
      {/* Video Header */}
      <div className="flex flex-col overflow-hidden md:overflow-auto h-full max-w-3xl mx-auto">
        <div className="flex flex-col gap-2 items-center">
          <div className="px-4 py-2 rounded-full border border-white/30 bg-white/10 text-white text-xs">
            {videoData?.original_filename}
          </div>
        </div>
        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto scrollbar-custom text-left px-4 md:mb-0">
          <div className="w-full max-w-4xl mt-6 mx-auto">
            <div className="rounded-2xl bg-white/10 border border-white/20">
              <div onClick={() => setReportCollapsed((s) => !s)} className="flex items-center justify-between p-5 cursor-pointer hover:bg-white/5 transform transition-all duration-200">
                <div className="flex items-center gap-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-target w-5 h-5 text-white"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                  <div>
                    <div className="text-white text-xl font-semibold">{'レポート：全体戦略'}</div>
                    <div className="text-white/80 text-sm mt-1">{videoData?.created_at ? new Date(videoData.created_at).toLocaleString() : ''}</div>
                  </div>
                </div>

                <button
                  type="button"
                  aria-expanded={!reportCollapsed}
                  aria-label={reportCollapsed ? (window.__t ? window.__t('expand') : 'expand') : (window.__t ? window.__t('collapse') : 'collapse')}
                  className="text-white/70 p-2 rounded focus:outline-none transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-6 h-6 transform transition-transform duration-200 ${!reportCollapsed ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {/* Inner panels: tag + summary + suggestion (matches screenshot) */}
              {!reportCollapsed && (
                <div className="px-5 flex flex-col gap-4">
                  {videoData?.report3 && Array.isArray(videoData.report3) && videoData.report3.length > 0 && videoData.report3.map((r, i) => (
                    <div key={`report3-${i}`} className="rounded-xl p-6 bg-white/10 border border-white/10">
                      <div className="flex items-start gap-4">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-orange-400/20 text-orange-400">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-flame w-3.5 h-3.5"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
                          <span>高インパクト</span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4">
                        <div className="flex items-start gap-4">
                          <div className="text-cyan-300">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-text w-4 h-4 text-blue-400 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-cyan-200 font-medium text-xs">概要</div>
                            <div className="text-white/80 mt-2 text-sm">
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
                          <div className="text-green-400">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check w-4 h-4 text-green-400 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-green-200 font-medium text-xs">提案</div>
                            <div className="text-white/80 mt-2 text-sm">
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
                  <div className="space-y-3 pt-2 border-t border-white/10">
                    <div
                      className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-white/5 transform transition-all duration-200"
                      onClick={() => setTimelineCollapsed((s) => !s)}
                    >
                      <div className="flex items-center gap-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock w-4 h-4 text-white/60"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <div>
                          <div className="text-white/70 text-base font-semibold">詳細分析（タイムライン）</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="text-white/70 rounded focus:outline-none transition-colors"
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
                            <div className="mt-4 rounded-xl bg-white/5 border border-white/10 mx-5">
                              <div
                                className={`flex items-start justify-between gap-4 px-4 py-3 border-l-4 border-orange-400/80 rounded-xl transition-colors cursor-pointer ${expandedTimeline[itemKey] ? 'bg-white/10 hover:bg-white/10' : 'hover:bg-white/5'
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
                                <div className="flex flex-1 min-w-0 items-start gap-3">
                                  <div
                                    className="flex items-start gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePhasePreview(item);
                                    }}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                      className="lucide lucide-play w-4 h-4 text-white/70 flex-shrink-0 mt-0.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                    <div className="text-white/80 text-sm font-semibold whitespace-nowrap">
                                      {item.time_start != null || item.time_end != null ? (
                                        <>
                                          {formatTime(item.time_start)}
                                          {" – "}
                                          {formatTime(item.time_end)}
                                        </>
                                      ) : (
                                        <span className="text-gray-500">-</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className={`flex-1 min-w-0 text-white/80 text-sm ${!expandedTimeline[itemKey] ? 'truncate' : ''}`}>
                                    {item.phase_description || window.__t('noDescription')}
                                  </div>
                                </div>
                                <div className="flex items-start gap-2 text-orange-400 flex-shrink-0 mt-0.5">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-flame w-4 h-4"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="1.5"
                                    className={`w-5 h-5 text-white/70 transition-transform duration-200
                                  cursor-pointer 
                                  ${expandedTimeline[itemKey] ? 'rotate-180' : ''}`}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            {/* Expanded content sections */}
                            {expandedTimeline[itemKey] && (
                              <div className="px-4 pb-4 mt-4 ml-15 flex flex-col gap-4 rounded-xl py-3 bg-white/10 mr-5">
                                {/* 概要 (Overview) section */}
                                <div className="flex items-start gap-4">
                                  <div className="text-cyan-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-text w-4 h-4 text-blue-400 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-cyan-200 font-medium text-xs">概要</div>
                                    <div className="text-white/80 mt-2 text-sm">
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
                                    <div className="text-green-400">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check w-4 h-4 text-green-400 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-green-200 font-medium text-xs">提案</div>
                                      <div className="text-white/80 mt-2 text-sm">
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
          <div className="space-y-3 pt-4 mt-4 border-t border-white/10">
            <p className="text-white/60 text-xs text-center">質問と回答</p>
            <div className="rounded-2xl p-4 max-w-[85%] bg-white/10 backdrop-blur-sm border border-white/30">
              <p className="text-white text-sm">
                この動画の解析が完了しました。全体的に良い構成ですが、いくつかの改善点が見つかりました。詳細について質問があれば、お聞きください。
              </p>
            </div>
            {/* Chat Section */}
            {chatMessages && chatMessages.length > 0 && (
              <div className="mt-6 flex flex-col gap-4">
                {chatMessages.map((item) => (
                  <div key={item.id || `${item.question}-${item.created_at || ''}`} className="flex flex-col gap-4">
                    <div className="w-[80%] mx-auto rounded-2xl bg-[#6F35FF]/60 px-6 py-4">
                      <p className="text-white/90 text-sm font-medium">{item.question}</p>
                    </div>
                    {item.answer && (
                      <div className="w-[80%] rounded-2xl p-6 bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-white/20">
                        <div className="text-white/80 text-sm leading-relaxed">
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
                  <div className="w-[80%] rounded-2xl p-4 bg-white/10 backdrop-blur-sm border border-white/20">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white/80 animate-spin" />
                      <p className="text-white/70 text-sm">{window.__t ? window.__t("aiThinking") : "AI is thinking..."}</p>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-4xl mx-auto hidden md:block mt-4 pb-4">
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

