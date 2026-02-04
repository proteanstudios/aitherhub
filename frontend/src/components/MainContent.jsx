import { Header, Body, Footer } from "./main";
import uploadIcon from "../assets/upload.png";
import { useState, useEffect, useRef } from "react";
import UploadService from "../base/services/uploadService";
import { toast } from "react-toastify";
import LoginModal from "./modals/LoginModal";

export default function MainContent({
  children,
  onOpenSidebar,
  user,
  setUser,
  onUploadSuccess,
  onVideoSelect,
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
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [resumeUploadId, setResumeUploadId] = useState(null);
  const prevIsLoggedInRef = useRef(isLoggedIn);
  const resumeFileInputRef = useRef(null);

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

      if (onUploadSuccess) {
        onUploadSuccess();
      }
      if (onVideoSelect) {
        onVideoSelect({ id: video_id });
      }
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
      const video_id = await UploadService.uploadFile(
        selectedFile,
        user.email,
        (percentage) => {
          setProgress(percentage);
        }
      );

      setMessageType("success");
      toast.success(window.__t('uploadSuccessMessage'));
      setSelectedFile(null);
      setResumeUploadId(null);

      // Navigate to video detail after successful upload
      if (onUploadSuccess) {
        onUploadSuccess();
      }
      if (onVideoSelect) {
        onVideoSelect({ id: video_id });
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
      setMessage("");
      setProgress(0);
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
        {children ?? (
          <>
            <div className="w-full">
              <h4 className="w-full text-[26px] leading-[40px] font-semibold font-cabin text-center">
                {window.__t('header').split('\n').map((line, idx, arr) => (
                  <span key={idx}>
                    {line}
                    {idx < arr.length - 1 && <br className="block md:hidden" />}
                  </span>
                ))}
              </h4>
            </div>
            <div className="w-full mt-[70px] md:mt-[115px] [@media(max-height:650px)]:mt-[20px]">
              <h4 className="w-full mb-[22px] text-[28px] leading-[40px] font-semibold font-cabin text-center">
                {window.__t('uploadText').split('\n').map((line, idx, arr) => (
                  <span key={idx}>
                    {line}
                    {idx < arr.length - 1 && <br className="block md:hidden" />}
                  </span>
                ))}
              </h4>
              <div
                className="w-[300px] h-[250px] mx-auto md:w-[400px] md:h-[300px] border-5 border-gray-300 rounded-[20px] flex flex-col items-center justify-center text-center gap-4"
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
                      {window.__t('cancelButton')}
                    </button>
                  </>
                ) : selectedFile ? (
                  <>
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
                        className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-[30px] leading-[28px] font-semibold"
                      >
                        {window.__t('uploadButton')}
                      </button>
                      <button
                        onClick={handleCancel}
                        className="w-[143px] h-[41px] bg-gray-300 text-gray-700 rounded-[30px] text-sm"
                      >
                        {window.__t('cancelButton')}
                      </button>
                    </div>
                  </>
                ) : resumeUploadId ? (
                  <>
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
                        className="w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-[30px] leading-[28px] font-semibold"
                      >
                        {window.__t('resumeButton') || 'Resume'}
                      </button>
                      <button
                        onClick={handleSkipResume}
                        disabled={uploading || processingResume}
                        className="w-[143px] h-[41px] bg-gray-300 text-gray-700 rounded-[30px] text-sm"
                      >
                        {window.__t('skipButton') || 'Skip'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <img
                      src={uploadIcon}
                      alt="upload"
                      className="w-[135px] h-[135px]"
                    />
                    <h5 className="hidden md:inline text-[20px] leading-[35px] font-semibold font-cabin text-center h-[35px]">
                      {window.__t('dragDropText')}
                    </h5>
                    <label
                      className="
                        w-[143px] h-[41px]
                        flex items-center justify-center
                        bg-white text-[#7D01FF]
                        border border-[#7D01FF]
                        rounded-[30px]
                        text-[14px] leading-[28px]
                        font-semibold
                        cursor-pointer
                        transition-transform duration-150 ease-out
                        active:scale-[0.96]
                        select-none
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
