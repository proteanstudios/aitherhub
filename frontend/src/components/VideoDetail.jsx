import { useEffect, useState, useRef } from "react";
import ChatInput from "./ChatInput";
import VideoService from "../base/services/videoService";
import "../assets/css/sidebar.css";

export default function VideoDetail({ video }) {
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const answerRef = useRef("");
  const streamCancelRef = useRef(null);
  const lastSentRef = useRef({ text: null, t: 0 });
  const reloadTimeoutRef = useRef(null);
  const chatEndRef = useRef(null);

  const scrollToBottom = (smooth = true) => {
    if (chatEndRef.current) {
      try {
        chatEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
      } catch (e) {}
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
      if (streamCancelRef.current) {
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
        if (text) handleChatSend(text);
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
      } catch (e) {}
    }
  }, [chatMessages]);

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
            <div className="mb-2">
              解析が完了しました！
              <br className="block md:hidden" />
              今後の配信をより成功させるために、
              <br className="block md:hidden" />
              次の提案をお伝えします。
            </div>
          </div>

          <div className="mt-4 font-semibold flex flex-col gap-3">
            {videoData?.reports_1 && videoData.reports_1.length > 0 ? (
              <div className="flex flex-col gap-3">
                {videoData.reports_1.map((it, index) => (
                <div
                  key={it.phase_index}
                  className={`grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3 items-start p-3 bg-white/5 rounded-md
                    ${index === videoData.reports_1.length - 1 ? "mb-[30px]" : ""}
                  `}
                >
                  <div className="text-sm text-gray-400 font-mono whitespace-nowrap">
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
            
                  <div className="text-sm text-left text-gray-100 whitespace-pre-wrap">
                    {it.insight || "(No insight)"}
                  </div>
                </div>
              ))}
            </div>
            ) : (
              <div className="text-[18px] leading-[35px] tracking-[0] text-gray-500">
                解析結果はまだありません
              </div>
            )}
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
                      <div className="min-w-0 text-sm text-gray-100 whitespace-pre-wrap break-words">{item.answer}</div>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:block mt-4 pb-4">
          <ChatInput onSend={handleChatSend} />
        </div>
      </div>
    </div>
  );
}

