import { useEffect, useState } from "react";
import ChatInput from "./ChatInput";
import VideoService from "../base/services/videoService";
import "../assets/css/sidebar.css";

export default function VideoDetail({ video }) {
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [error, setError] = useState(null);

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
        
        const data = response || response || {};
        
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

          <div className="mt-4 font-semibold">
            {videoData?.reports_1 && videoData.reports_1.length > 0 ? (
              <div className="flex flex-col gap-3">
              {videoData.reports_1.map((it, index) => (
                <div
                  key={it.phase_index}
                  className={`grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4 items-start p-3 bg-white/5 rounded-md
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
          </div>
        </div>

        <div className="hidden md:block mt-4 pb-4">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}

