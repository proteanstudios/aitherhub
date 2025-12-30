import { Header, Body, Footer } from "./main";
import uploadIcon from "../assets/upload.png";
import { useState } from "react";
import UploadService from "../base/services/uploadService";
import { toast } from "react-toastify";

export default function MainContent({ children, onOpenSidebar, user, setUser }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setMessageType("error");
      setMessage("Please select a valid video file");
      return;
    }

    setSelectedFile(file);
    setMessage("");
    setProgress(0);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file first");
      return;
    }

    setUploading(true);
    setMessage("");
    setProgress(0);

    try {
      const video_id = await UploadService.uploadFile(selectedFile, (percentage) => {
        setProgress(percentage);
      });

      setMessageType("success");
      setMessage(`✅ Upload complete! ID: ${video_id}`);
      toast.success("Video uploaded successfully");
      setSelectedFile(null);
    } catch (error) {
      const errorMsg = error?.message || "Upload failed";
      setMessageType("error");
      setMessage(`❌ ${errorMsg}`);
      toast.error(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setUploading(false);
    setProgress(0);
    setMessage("");
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (!file.type.startsWith("video/")) {
        setMessageType("error");
        setMessage("Please select a valid video file");
        return;
      }
      setSelectedFile(file);
      setMessage("");
      setProgress(0);
    }
  };
  return (
    <div className="flex flex-col h-screen">
      <Header onOpenSidebar={onOpenSidebar} user={user} setUser={setUser} />

      <Body>
        {children ?? (
          <>
            <div className="relative w-full">
                <h4 className="absolute top-[11px] md:top-[5px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
                    あなたの配信、AIで最適化。<br className="block md:hidden" /> 売上アップの秘密がここに。
                </h4>

                <h4 className="absolute top-[125px] md:top-[157px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
                    動画ファイルを<br className="block md:hidden" /> アップロードして<br className="block md:hidden" /> 解析を開始
                </h4>
            </div>
            <div className="relative w-full">
                <div 
                  className="absolute top-[273px] md:top-[218px] left-1/2 -translate-x-1/2 w-[300px] h-[250px] md:w-[400px] md:h-[300px] border-5 border-gray-300 rounded-[20px] flex flex-col items-center justify-center text-center gap-4 transition-colors"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {uploading ? (
                    <>
                      <div className="w-full px-4">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-purple-600 h-2 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                        <p className="text-sm font-medium mt-2">{progress}%</p>
                      </div>
                      <button
                        onClick={handleCancel}
                        className="w-[143px] h-[41px] bg-white text-gray-600 border border-gray-300 rounded-[30px] text-sm"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : selectedFile ? (
                    <>
                      <div className="text-4xl">🎬</div>
                      <div>
                        <p className="text-sm font-semibold">{selectedFile.name}</p>
                        <p className="text-xs text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleUpload}
                          className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-[30px] leading-[28px] font-semibold"
                        >
                          アップロード
                        </button>
                        <button
                          onClick={handleCancel}
                          className="w-[143px] h-[41px] bg-gray-300 text-gray-700 rounded-[30px] text-sm"
                        >
                          キャンセル
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <img src={uploadIcon} alt="upload" className="w-[135px] h-[135px]" />
                      <h5 className="hidden md:inline text-[20px] leading-[35px] font-semibold font-cabin text-center h-[35px]">
                        動画ファイルをドラッグ＆ドロップ
                      </h5>
                      <label className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-[30px] leading-[28px] cursor-pointer font-semibold">
                        ファイルを選択
                        <input
                          type="file"
                          accept="video/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>
                    </>
                  )}
                  {message && (
                    <p className={`text-xs text-center ${messageType === "success" ? "text-green-600" : "text-red-600"}`}>
                      {message}
                    </p>
                  )}
                </div>
            </div>
          </>
        )}
      </Body>

      <Footer />
    </div>
  );
}
