import { Header, Body, Footer } from "./main";
import uploadIcon from "../assets/upload.png";
import { useState, useEffect, useRef } from "react";
import UploadService from "../base/services/uploadService";
import VideoService from "../base/services/videoService";
import { toast } from "react-toastify";
import LoginModal from "./modals/LoginModal";
import ProcessingSteps from "./ProcessingSteps";
import VideoDetail from "./VideoDetail";

export default function MainContent({
  children,
  onOpenSidebar,
  user,
  setUser,
  onUploadSuccess,
  selectedVideoId,
}) {
  const isLoggedIn = Boolean(
    user &&
    (user.token ||
      user.accessToken ||
      user.id ||
      user.email ||
      user.username ||
      user.isAuthenticated ||
      user.isLoggedIn)
  );
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [processingResume, setProcessingResume] = useState(false);
  const [checkingResume, setCheckingResume] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedVideoId, setUploadedVideoId] = useState(null);
  const [videoData, setVideoData] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [resumeUploadId, setResumeUploadId] = useState(null);
  const prevIsLoggedInRef = useRef(isLoggedIn);
  const resumeFileInputRef = useRef(null);

  // Clear resume upload file name on page reload
  useEffect(() => {
    localStorage.removeItem('resumeUploadFileName');
  }, []);

  useEffect(() => {
    console.log("[MainContent] user", user);
    console.log("[MainContent] isLoggedIn", isLoggedIn);
  }, [user, isLoggedIn]);

  // If token expires and user logs in again via modal, clear old upload result message.
  useEffect(() => {
    const prev = prevIsLoggedInRef.current;
    // Logged in -> logged out: clear uploader state so stale file/message doesn't remain.
    if (prev && !isLoggedIn) {
      setSelectedFile(null);
      setUploading(false);
      setProgress(0);
      setUploadedVideoId(null);
      setVideoData(null);
      setMessage("");
      setMessageType("");
    }
    if (!prev && isLoggedIn) {
      setMessage("");
      setMessageType("");
    }
    prevIsLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  const checkForResumableUpload = async () => {
    if (!user?.id) return;
    setCheckingResume(true);
    try {
      const result = await UploadService.checkUploadResume(user.id);
      if (result?.upload_resume && result?.upload_id) {
        setResumeUploadId(result.upload_id);
      } else {
        setResumeUploadId(null);
      }
    } catch (error) {
      console.error("Failed to check upload resume:", error);
      setResumeUploadId(null);
    } finally {
      setCheckingResume(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn && user?.id) {
      checkForResumableUpload();
    } else {
      setResumeUploadId(null);
    }
  }, [isLoggedIn, user?.id]);

  const handleFileSelect = (e) => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setMessageType("error");
      setMessage(window.__t('selectValidVideoError'));
      return;
    }

    setSelectedFile(file);
    setResumeUploadId(null);
    setUploadedVideoId(null);
    setVideoData(null);
    setMessage("");
    setProgress(0);
  };

  const handleResumeUpload = async () => {
    if (!resumeUploadId || processingResume) return;
    // Prevent multiple clicks while opening picker
    setProcessingResume(true);
    try {
      // Trigger file input click to open file picker
      resumeFileInputRef.current?.click();
    } finally {
      // keep processingResume true until user selects file; clear after small delay
      // (the real processing state is handled in handleResumeFileSelect)
      setTimeout(() => setProcessingResume(false), 300);
    }
  };

  const handleSkipResume = async () => {
    if (!resumeUploadId || !user?.id || processingResume) return;
    setProcessingResume(true);
    try {
      // Clear upload record from backend
      await UploadService.clearUserUploads(user.id);

      // Clear upload metadata from IndexedDB
      await UploadService.clearUploadMetadata(resumeUploadId);

      // Clear UI state
      setResumeUploadId(null);

      toast.info(window.__t('uploadResumeCleared') || 'Upload resume cleared');
    } catch (error) {
      console.error('Failed to clear resume:', error);
      // Still clear UI state even if backend call fails
      setResumeUploadId(null);
    } finally {
      setProcessingResume(false);
    }
  };

  const handleResumeFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !resumeUploadId || uploading || processingResume) return;

    setProcessingResume(true);
    setUploading(true);
    setMessage("");
    setProgress(0);

    try {
      localStorage.setItem('resumeUploadFileName', file.name);
      // Get metadata from IndexedDB
      const metadata = await UploadService.getUploadMetadata(resumeUploadId);
      if (!metadata) {
        throw new Error('Upload metadata not found. Please start a new upload.');
      }

      // Validate that the selected file is the same as the original file
      if (file.name !== metadata.fileName) {
        throw new Error(`選択したファイルが一致しません。再度ファイルを選択してください。`);
      }

      if (file.size !== metadata.fileSize) {
        throw new Error(`選択したファイルが一致しません。再度ファイルを選択してください。`);
      }

      const blockIds = metadata.blockIds || [];
      const uploadedBlockIds = metadata.uploadedBlocks || [];
      const maxUploadedIndex = uploadedBlockIds.length > 0
        ? Math.max(...uploadedBlockIds.map(id => {
          // Decode base64 block ID to get original index
          const decoded = atob(id);
          return parseInt(decoded, 10);
        }))
        : -1;
      const startFrom = maxUploadedIndex + 1;

      // Resume upload from where it left off
      await UploadService.uploadToAzure(
        file,
        metadata.uploadUrl,
        resumeUploadId,
        (percentage) => {
          setProgress(percentage);
        },
        startFrom // Pass startFrom index to resume from
      );

      // Use the video_id from metadata (created during initial upload)
      const video_id = metadata.videoId;
      if (!video_id) {
        throw new Error('Video ID not found in metadata. Please start a new upload.');
      }

      // Notify backend of completion
      await UploadService.uploadComplete(
        user.email,
        video_id,
        file.name,
        resumeUploadId
      );

      // Clear upload metadata from IndexedDB
      await UploadService.clearUploadMetadata(resumeUploadId);

      setMessageType("success");
      toast.success(window.__t('uploadSuccessMessage'));
      setSelectedFile(null);
      setResumeUploadId(null);

      // Set uploaded video ID to start processing tracking
      setUploadedVideoId(video_id);

      // Trigger refresh sidebar
      if (onUploadSuccess) {
        onUploadSuccess();
      }
      localStorage.removeItem('resumeUploadFileName');
    } catch (error) {
      const errorMsg = error?.message || window.__t('uploadFailedMessage');
      toast.error(errorMsg);
    } finally {
      setUploading(false);
      setProcessingResume(false);
      // Reset file input
      if (resumeFileInputRef.current) {
        resumeFileInputRef.current.value = '';
      }
    }
  };

  const handleUpload = async () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    if (!selectedFile) {
      toast.error(window.__t('selectFileFirstError'));
      return;
    }

    if (uploading) return;

    setUploading(true);
    setMessage("");
    setProgress(0);
    
    try {
      localStorage.setItem('resumeUploadFileName', selectedFile.name);
      const video_id = await UploadService.uploadFile(
        selectedFile,
        user.email,
        (percentage) => {
          setProgress(percentage);
        }
      );
      localStorage.removeItem('resumeUploadFileName');
      setMessageType("success");
      toast.success(window.__t('uploadSuccessMessage'));
      setSelectedFile(null);
      setResumeUploadId(null);

      // Set uploaded video ID to start processing tracking
      setUploadedVideoId(video_id);

      // Trigger refresh sidebar
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (error) {
      const errorMsg = error?.message || window.__t('uploadFailedMessage');
      toast.error(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setUploading(false);
    setProgress(0);
    setUploadedVideoId(null);
    setVideoData(null);
    setMessage("");
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (!file.type.startsWith("video/")) {
        setMessageType("error");
        setMessage(window.__t('selectValidVideoError'));
        return;
      }
      setSelectedFile(file);
      setUploadedVideoId(null);
      setVideoData(null);
      setMessage("");
      setProgress(0);
    }
  };

  // Clear uploadedVideoId when selectedVideoId is set (from sidebar selection)
  // This ensures only ONE ProcessingSteps is rendered
  useEffect(() => {
    if (selectedVideoId) {
      console.log("[MainContent] Clearing uploadedVideoId due to selectedVideoId:", selectedVideoId);
      setUploadedVideoId(null);
      setSelectedFile(null);
      setProgress(0);
      setUploading(false);
    }
  }, [selectedVideoId]);

  // Fetch video details when uploadedVideoId OR selectedVideoId changes
  useEffect(() => {
    const videoId = uploadedVideoId || selectedVideoId;
    console.log("[MainContent] Fetching video details for:", videoId);
    
    if (!videoId) {
      setVideoData(null);
      setLoadingVideo(false);
      
      // Check if there's a pending upload in localStorage
      const resumeFileName = localStorage.getItem('resumeUploadFileName');
      if (resumeFileName) {
        // Restore upload UI state for pending upload
        setUploading(true);
        setSelectedFile({ name: resumeFileName }); // Set file name for UI display
      }
      return;
    }

    setLoadingVideo(true);
    const fetchVideoDetails = async () => {
      try {
        const response = await VideoService.getVideoById(videoId);
        const data = response || {};
        // normalize reports
        const r1 = Array.isArray(data.reports_1) ? data.reports_1 : (data.reports_1 ? [data.reports_1] : []);
        let r2 = Array.isArray(data.reports_2) ? data.reports_2 : (data.reports_2 ? [data.reports_2] : []);
        if ((!r2 || r2.length === 0) && r1 && r1.length > 0) {
          r2 = r1.map((it) => ({
            phase_index: it.phase_index,
            time_start: it.time_start,
            time_end: it.time_end,
            insight: it.insight ?? it.phase_description ?? "",
            video_clip_url: it.video_clip_url,
          }));
        }
        const newVideoData = {
          id: data.id || videoId,
          original_filename: data.original_filename,
          status: data.status,
          created_at: data.created_at,
          reports_1: r1,
          reports_2: r2,
          report3: Array.isArray(data.report3) ? data.report3 : (data.report3 ? [data.report3] : []),
        };
        console.log("[MainContent] Setting videoData:", newVideoData);
        setVideoData(newVideoData);
      } catch (err) {
        console.error('Failed to fetch video details:', err);
      } finally {
        setLoadingVideo(false);
      }
    };

    fetchVideoDetails();
  }, [uploadedVideoId, selectedVideoId]);

  // Handle processing complete - reload video data
  const handleProcessingComplete = async () => {
    const videoId = uploadedVideoId || selectedVideoId;
    if (!videoId) return;
    try {
      const response = await VideoService.getVideoById(videoId);
      const data = response || {};
      const r1 = Array.isArray(data.reports_1) ? data.reports_1 : (data.reports_1 ? [data.reports_1] : []);
      let r2 = Array.isArray(data.reports_2) ? data.reports_2 : (data.reports_2 ? [data.reports_2] : []);
      if ((!r2 || r2.length === 0) && r1 && r1.length > 0) {
        r2 = r1.map((it) => ({
          phase_index: it.phase_index,
          time_start: it.time_start,
          time_end: it.time_end,
          insight: it.insight ?? it.phase_description ?? "",
          video_clip_url: it.video_clip_url,
        }));
      }
      setVideoData({
        id: data.id || videoId,
        original_filename: data.original_filename,
        status: data.status,
        created_at: data.created_at,
        reports_1: r1,
        reports_2: r2,
        report3: Array.isArray(data.report3) ? data.report3 : (data.report3 ? [data.report3] : []),
      });
    } catch (err) {
      console.error('Failed to reload video after processing:', err);
    }
  };
  return (
    <div className="flex flex-col h-screen">
      <Header onOpenSidebar={onOpenSidebar} user={user} setUser={setUser} />

      <LoginModal
        open={showLoginModal}
        onClose={() => {
          setShowLoginModal(false);
          try {
            const storedUser = localStorage.getItem("user");
            if (storedUser && setUser) {
              setUser(JSON.parse(storedUser));
            }
          } catch {
            // ignore JSON/localStorage errors
          }
        }}
        onSwitchToRegister={() => setShowLoginModal(false)}
      />

      <Body>
        {videoData ? (
          videoData.status === 'DONE' ? (
            console.log("[MainContent] Rendering VideoDetail for videoData:", videoData) ||
            <VideoDetail videoData={videoData} />
          ) : (
            <div className="w-full flex flex-col items-center justify-center">
              <div className="rounded-2xl p-8 border transition-all duration-200 border-white/30 bg-white/5 backdrop-blur-sm hover:border-white/50 hover:bg-white/10">
                <ProcessingSteps
                  videoId={uploadedVideoId || selectedVideoId}
                  initialStatus={videoData.status}
                  videoTitle={videoData.original_filename}
                  onProcessingComplete={handleProcessingComplete}
                />
              </div>
            </div>
          )
        ) : loadingVideo ? (
          <div className="w-full flex flex-col items-center justify-center">
            <div className="rounded-2xl p-8 border transition-all duration-200 border-white/30 bg-white/5 backdrop-blur-sm">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                <p className="text-white text-sm">読み込み中...</p>
              </div>
            </div>
          </div>
        ) : children ?? (
          <>
            <div className="w-full flex flex-col items-center justify-center">
              <div className="w-full">
                <h4 className="w-full text-center">
                  {window.__t('header').split('\n').map((line, idx, arr) => (
                    <span key={idx} className="text-white/90 italic text-lg">
                      {line}
                      {idx < arr.length - 1 && <br className="block md:hidden" />}
                    </span>
                  ))}
                </h4>
              </div>
              <div className="w-full mt-[20px] [@media(max-height:650px)]:mt-[20px]">
                <h4 className="w-full mb-[22px] text-center">
                  {window.__t('uploadText').split('\n').map((line, idx, arr) => (
                    <span key={idx} className="text-white text-2xl !font-bold font-cabin">
                      {line}
                      {idx < arr.length - 1 && <br className="block md:hidden" />}
                    </span>
                  ))}
                </h4>
                <div className="w-full max-w-md mx-auto">
                  <div
                    className="rounded-2xl p-8 border transition-all duration-200 border-white/30 bg-white/5 backdrop-blur-sm hover:border-white/50 hover:bg-white/10"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    {uploading || uploadedVideoId ? (
                      <>
                        <div className="flex flex-col items-center text-center space-y-6">
                          <ProcessingSteps
                            videoId={uploadedVideoId}
                            initialStatus={uploading ? "UPLOADING" : "NEW"}
                            videoTitle={selectedFile?.name}
                            externalProgress={uploading ? progress : undefined}
                            onProcessingComplete={handleProcessingComplete}
                          />
                        </div>
                      </>
                    ) : selectedFile ? (
                      <>
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="text-4xl">🎬</div>
                          <div>
                            <p className="text-sm font-semibold">
                              {selectedFile.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleUpload}
                              disabled={uploading}
                              className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-md leading-[28px] cursor-pointer hover:bg-gray-100"
                            >
                              {window.__t('uploadButton')}
                            </button>
                            <button
                              onClick={handleCancel}
                              className="w-[143px] h-[41px] bg-gray-300 text-gray-700 rounded-md text-sm cursor-pointer hover:bg-gray-100"
                            >
                              {window.__t('cancelButton')}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : resumeUploadId ? (
                      <>
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="text-4xl">⏸️</div>
                          <div>
                            <p className="text-sm font-semibold">
                              {window.__t('resumeUploadTitle') || 'Resumable Upload Found'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {window.__t('resumeUploadDesc') || 'You have an incomplete upload. Continue uploading?'}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleResumeUpload}
                              disabled={uploading || processingResume}
                              className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-md leading-[28px] hover:bg-gray-100"
                            >
                              {window.__t('resumeButton') || 'Resume'}
                            </button>
                            <button
                              onClick={handleSkipResume}
                              disabled={uploading || processingResume}
                              className="w-[143px] h-[41px] bg-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-100"
                            >
                              {window.__t('skipButton') || 'Skip'}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5e29ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-upload-icon lucide-upload w-8 h-8 text-primary"><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>
                          </div>
                          <h5 className="hidden md:inline text-white text-lg font-cabin text-center">
                            {window.__t('dragDropText')}
                          </h5>
                          <label
                            className="
                        w-[143px] h-[41px]
                        flex items-center justify-center
                        bg-white text-[#7D01FF]
                        border border-[#7D01FF]
                        rounded-md
                        text-[14px] leading-[28px]
                        font-extralight
                        cursor-pointer
                        transition-transform duration-150 ease-out
                        active:scale-[0.96]
                        select-none
                        hover:bg-gray-100
                      "
                            onMouseDown={(e) => {
                              if (!isLoggedIn || checkingResume) {
                                e.preventDefault();
                                if (!isLoggedIn) setShowLoginModal(true);
                              }
                            }}
                          >
                            {window.__t('selectFileText')}
                            <input
                              type="file"
                              accept="video/*"
                              disabled={!isLoggedIn || checkingResume}
                              onMouseDown={(e) => {
                                if (!isLoggedIn || checkingResume) {
                                  e.preventDefault();
                                }
                              }}
                              onClick={(e) => {
                                if (!isLoggedIn || checkingResume) {
                                  e.preventDefault();
                                }
                              }}
                              onChange={handleFileSelect}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </>
                    )}
                    {message && (
                      <p
                        className={`text-xs text-center ${messageType === "success"
                          ? "text-green-600"
                          : "text-red-600"
                          }`}
                      >
                        {message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        {/* Hidden file input for resume functionality */}
        <input
          ref={resumeFileInputRef}
          type="file"
          accept="video/*"
          onChange={handleResumeFileSelect}
          className="hidden"
        />
      </Body>

      <div className={children ? "md:hidden" : ""}>
        <Footer />
      </div>
    </div>
  );
}
