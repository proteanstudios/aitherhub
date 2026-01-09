import { useEffect, useState } from "react";
import ChatInput from "./ChatInput";
import VideoService from "../base/services/videoService";

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
        
        const data = response?.data || response || {};
        
        setVideoData({
          id: data.id || video.id,
          title: data.original_filename || video.original_filename || `Video ${video.id}`,
          status: data.status || video.status || "processing",
          uploadedAt: data.created_at || video.created_at || new Date().toISOString(),
          description: data.description || video.description || {},
        });
      } catch (err) {
        console.error("Error fetching video details:", err);
        setError("動画の詳細を取得できませんでした");
        setVideoData({
          id: video.id,
          title: video.original_filename || `Video ${video.id}`,
          status: video.status || "processing",
          uploadedAt: video.created_at || new Date().toISOString(),
          description: video.description || {},
        });
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
        <div className="flex-1 overflow-y-auto text-left">
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
            <div className="text-[18px] leading-[35px] tracking-[0]">
              {videoData?.description?.title1 || video.description?.title1}
            </div>
            <div className="text-[18px] leading-[35px] tracking-[0]">
              {videoData?.description?.content1 || video.description?.content1}
            </div>
          </div>
        </div>

        <div className="hidden md:block mt-4 pb-4">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}

