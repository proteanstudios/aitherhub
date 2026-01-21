import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ChatInput from "./ChatInput";
import VideoPreviewModal from "./modals/VideoPreviewModal";
import VideoService from "../base/services/videoService";
import "../assets/css/sidebar.css";

export default function VideoDetail({ video }) {
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [previewData, setPreviewData] = useState(null); // { url, timeStart, timeEnd }
  const [previewLoading, setPreviewLoading] = useState(false);
  const answerRef = useRef("");
  const streamCancelRef = useRef(null);
  const lastSentRef = useRef({ text: null, t: 0 });
  const reloadTimeoutRef = useRef(null);
  const chatEndRef = useRef(null);
  const statusStreamRef = useRef(null);

  const scrollToBottom = (smooth = true) => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
      } catch (e) {
        // Ignore scroll errors
      }
    }
  };

  const handlePhasePreview = async (phase) => {
    if (!phase?.time_start && !phase?.time_end) return;
    if (!videoData?.id) return;
    setPreviewLoading(true);
    try {
      const url = await VideoService.getDownloadUrl(videoData.id);
      setPreviewData({
        url,
        timeStart: Number(phase.time_start) || 0,
        timeEnd: phase.time_end != null ? Number(phase.time_end) : null,
      });
    } catch (err) {
      console.error("Failed to load preview url", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Helper to calculate progress percentage from status
  const calculateProgressFromStatus = (status) => {
    const statusMap = {
      NEW: 0,
      uploaded: 0,
      STEP_0_EXTRACT_FRAMES: 10,
      STEP_1_DETECT_PHASES: 20,
      STEP_2_EXTRACT_METRICS: 30,
      STEP_3_TRANSCRIBE_AUDIO: 40,
      STEP_4_IMAGE_CAPTION: 50,
      STEP_5_BUILD_PHASE_UNITS: 60,
      STEP_6_BUILD_PHASE_DESCRIPTION: 70,
      STEP_7_GROUPING: 80,
      STEP_8_UPDATE_BEST_PHASE: 90,
      STEP_9_BUILD_REPORTS: 95,
      DONE: 100,
      ERROR: -1,
    };
    return statusMap[status] || 0;
  };

  // Helper to get user-friendly status message
  const getStatusMessage = (status) => {
    const messages = {
      NEW: "アップロード待ち",
      uploaded: "アップロード完了",
      STEP_0_EXTRACT_FRAMES: "フレーム抽出中...",
      STEP_1_DETECT_PHASES: "フェーズ検出中...",
      STEP_2_EXTRACT_METRICS: "メトリクス抽出中...",
      STEP_3_TRANSCRIBE_AUDIO: "音声書き起こし中...",
      STEP_4_IMAGE_CAPTION: "画像キャプション生成中...",
      STEP_5_BUILD_PHASE_UNITS: "フェーズユニット構築中...",
      STEP_6_BUILD_PHASE_DESCRIPTION: "フェーズ説明生成中...",
      STEP_7_GROUPING: "グルーピング中...",
      STEP_8_UPDATE_BEST_PHASE: "ベストフェーズ更新中...",
      STEP_9_BUILD_REPORTS: "レポート生成中...",
      DONE: "解析完了",
      ERROR: "エラーが発生しました",
    };
    return messages[status] || "処理中...";
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
        try {  } catch (e) {}
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
        } catch (e) {}
        streamCancelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      answerRef.current = "";

      const localId = `local-${Date.now()}-${Math.floor(Math.random()*1000)}`;
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
            } catch (e) {}

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

      setLoading(true);
      setError(null);

      try {
        const response = await VideoService.getVideoById(video.id);
        const data = response || {};

        setVideoData({
          id: data.id || video.id,
          title: data.original_filename || video.original_filename || `Video ${video.id}`,
          status: data.status || video.status || "processing",
          uploadedAt: data.created_at || video.created_at || new Date().toISOString(),
          reports_1: data.reports_1 || video.description || {},
        });

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
          setError("動画の詳細を取得できませんでした");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchVideoDetails();
  }, [video]);

  useEffect(() => {
    const onGlobalSubmit = (ev) => {
      try {
        const text = ev?.detail?.text;
        if (text && !streamCancelRef.current) handleChatSend(text);
      } catch (e) {}
    };
    window.addEventListener("videoInput:submitted", onGlobalSubmit);
    return () => {
      window.removeEventListener("videoInput:submitted", onGlobalSubmit);
      if (streamCancelRef.current) {
        try {
          if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
          else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
        } catch (e) {}
        streamCancelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (streamCancelRef.current) {
      try {
        if (typeof streamCancelRef.current.cancel === "function") streamCancelRef.current.cancel();
        else if (typeof streamCancelRef.current === "function") streamCancelRef.current();
      } catch (e) {}
      streamCancelRef.current = null;
    }
    answerRef.current = "";
    lastSentRef.current = { text: null, t: 0 };
  }, [video?.id]);

  useEffect(() => {
    let cancelled = false;
    const vid = video?.id || videoData?.id;
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
      },

      onDone: async () => {
        // Processing complete - reload full video data to get reports
        try {
          const response = await VideoService.getVideoById(video.id);
          setVideoData({
            id: response.id || video.id,
            title: response.original_filename || video.original_filename,
            status: response.status,
            uploadedAt: response.created_at,
            reports_1: response.reports_1 || [],
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
    };
  }, [video?.id, videoData?.status]);

  // Render processing status UI
  const renderProcessingStatus = () => {
    if (!processingStatus) return null;

    const { status, progress, message } = processingStatus;
    const isError = status === 'ERROR';

    return (
      <div className={`mt-4 p-4 rounded-lg ${isError ? 'bg-red-500/10 border border-red-500/50' : 'bg-white/5'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">
            {message}
          </span>
          {!isError && (
            <span className="text-sm text-gray-400">
              {progress}%
            </span>
          )}
        </div>

        {!isError && progress >= 0 && (
          <>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              解析が完了すると、自動的に結果が表示されます。
            </p>
          </>
        )}

        {isError && (
          <p className="text-sm text-red-400 mt-2">
            動画の解析中にエラーが発生しました。もう一度アップロードしてください。
          </p>
        )}
      </div>
    );
  };

  if (!video) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gray-400 text-lg">選択されたビデオがありません</p>
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
    <div className="w-full h-full flex flex-col gap-6 p-0 lg:p-6">
      <h4 className="md:top-[5px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
        あなたの配信、AIで最適化。<br className="block md:hidden" /> 売上アップの秘密がここに。
      </h4>
      {/* Video Header */}
      <div className="flex flex-col lg:ml-[65px] h-full">
        <div className="flex flex-col gap-2">
          <div className="inline-flex self-start items-center bg-white rounded-[50px] h-[41px] px-4">
            <div className="text-[14px] font-bold whitespace-nowrap bg-gradient-to-b from-[#542EBB] to-[#BA69EE] bg-clip-text text-transparent">
              {videoData?.title || video.original_filename}
            </div>
          </div>
        </div>

        {/* SCROLL AREA */}
        <div className="flex-1 overflow-y-auto scrollbar-custom text-left">
          <div className="rounded-lg font-[Cabin] font-semibold text-[18px] leading-[35px] tracking-[0]">
            <div className="mt-4">アップロードありがとうございます。</div>

            {/* Show processing status if video is being processed */}
            {processingStatus && renderProcessingStatus()}

            {/* Show completion message and results if done */}
            {videoData?.status === 'DONE' && (
              <div className="mb-2">
                解析が完了しました！
                <br className="block md:hidden" />
                今後の配信をより成功させるために、
                <br className="block md:hidden" />
                次の提案をお伝えします。
              </div>
            )}
          </div>

          <div className="mt-4 font-semibold flex flex-col gap-3">
            {videoData?.status === 'DONE' && videoData?.reports_1 && videoData.reports_1.length > 0 ? (
              <div className="flex flex-col gap-3">
                {videoData.reports_1.map((it, index) => (
                <div
                  key={it.phase_index}
                  className={`grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md
                    ${index === videoData.reports_1.length - 1 ? "mb-[30px]" : ""}
                  `}
                >
                  <div
                    className={`text-sm text-gray-400 font-mono whitespace-nowrap w-fit cursor-pointer hover:text-purple-400 transition-colors ${
                      previewLoading ? "opacity-60 pointer-events-none" : ""
                    }`}
                    onClick={() => handlePhasePreview(it)}
                    title="クリックしてプレビュー"
                  >
                    {it.time_start != null || it.time_end != null ? (
                      <>
                        {it.time_start != null ? it.time_start : ""}
                        {" : "}
                        {it.time_end != null ? it.time_end : ""}
                      </>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </div>
            
                  <div className="text-sm text-left text-gray-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {it.insight || "(No insight)"}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            ) : null}
            {chatMessages && chatMessages.length > 0 && (
              <div className="flex flex-col gap-4">
                {chatMessages.map((item) => (
                  <div key={item.id || `${item.question}-${item.created_at || ''}`} className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md">
                      <div className="text-xs text-gray-400 font-mono">User</div>
                      <div className="min-w-0 text-sm text-gray-100 whitespace-pre-wrap break-words">{item.question}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md">
                      <div className="text-xs text-gray-400 font-mono">Bot</div>
                      <div className="min-w-0 text-sm text-gray-100">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {item.answer || ""}
                        </ReactMarkdown>
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
      />
    </div>
  );
}

