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
      <h4 className="md:top-[5px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
        {window.__t('header').split('\n').map((line, idx, arr) => (
          <span key={idx}>
            {line}
            {idx < arr.length - 1 && <br className="block md:hidden" />}
          </span>
        ))}
      </h4>
      {/* Video Header */}
      <div className="flex flex-col overflow-hidden md:overflow-auto lg:ml-[65px] h-full">
        <div className="flex flex-col gap-2">
          <div className="inline-flex self-start items-center bg-white rounded-[50px] h-[41px] px-4">
            <div className="text-[14px] font-bold whitespace-nowrap bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))] text-transparent bg-clip-text">
              {videoData?.original_filename}
            </div>
          </div>
        </div>

        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto scrollbar-custom text-left md:mb-0">
          {/* Show processing status when video is being processed */}
          {/* {renderProcessingStatus()} */}

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
              <div className="text-[18px] leading-[35px] tracking-[0] text-gray-500">
                {window.__t('noReports')}
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

