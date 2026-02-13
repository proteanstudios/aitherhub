import { useEffect, useRef, useState } from "react";
import CloseSvg from "../../assets/icons/close.svg";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogClose } from "../ui/dialog";

export default function VideoPreviewModal({
  open,
  onClose,
  videoUrl,
  timeStart = 0,
  skipSeek = false,
  isClipPreview = false
}) {
  const videoRef = useRef(null);
  const hasSetupRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [bufferedProgress, setBufferedProgress] = useState(0);
  const [showCustomLoading, setShowCustomLoading] = useState(true);
  const prevOpenRef = useRef(false);
  const prevVideoUrlRef = useRef(null);

  const resetUiState = () => {
    setIsLoading(true);
    setBufferedProgress(0);
    setShowCustomLoading(true); // Always show custom loading initially
    hasSetupRef.current = false;
  };

  // Reset states when modal closes or URL changes
  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    const prevVideoUrl = prevVideoUrlRef.current;

    // Reset when modal closes or video URL changes
    if ((!open && prevOpen) || (videoUrl !== prevVideoUrl)) {
      queueMicrotask(() => {
        resetUiState();
      });
    }

    prevOpenRef.current = open;
    prevVideoUrlRef.current = videoUrl;
  }, [open, videoUrl]);

  // Setup seek/play when modal opens or URL changes
  useEffect(() => {
    // Skip if modal closed or no video
    if (!open || !videoUrl) {
      return;
    }

    const setupVideoPlay = () => {
      const vid = videoRef.current;
      if (!vid || hasSetupRef.current) {
        return;
      }

      hasSetupRef.current = true;
      let hasSeeked = false;

      const seekAndPlay = async () => {
        try {
          // Show custom loading when starting seek/play process
          setShowCustomLoading(true);
          setIsLoading(true);

          const shouldSkipSeek = isClipPreview || skipSeek;
          const shouldSeek = !shouldSkipSeek && !hasSeeked && Math.abs(vid.currentTime - timeStart) > 0.5;
          if (shouldSeek && timeStart !== null && timeStart !== undefined) {
            vid.currentTime = timeStart;
            hasSeeked = true;
          } else if (shouldSkipSeek) {
            hasSeeked = true;
          }

          // Try autoplay; if blocked, keep native controls so user can start playback.
          try {
            await vid.play();
            // Keep custom loading for a moment to show success, then hide
            setIsLoading(false);
            setTimeout(() => setShowCustomLoading(false), 500);
          } catch {
            // Autoplay can be blocked by browser policy. Let user click native play.
            setIsLoading(false);
            setShowCustomLoading(false);
          }
        } catch (e) {
          console.error("Error seeking/playing video preview:", e);
          setIsLoading(false);
          setShowCustomLoading(false);
        }
      };

      const handleCanPlay = () => {
        if (!hasSeeked) {
          seekAndPlay();
        }
      };

      const handleLoadedMetadata = () => {
        // If video is already ready to play, seek immediately
        if (vid.readyState >= 3) { // HAVE_FUTURE_DATA or higher
          seekAndPlay();
        } else {
          // wait for canplay
        }
      };

      // Add event listeners
      vid.addEventListener("loadedmetadata", handleLoadedMetadata);
      vid.addEventListener("canplay", handleCanPlay);

      // Check current state
      if (vid.readyState >= 3) {
        seekAndPlay();
      } else if (vid.readyState >= 1) {
        // Metadata loaded but not ready to play yet
        handleLoadedMetadata();
      } else {
        // wait for events
      }

      return () => {
        vid.removeEventListener("loadedmetadata", handleLoadedMetadata);
        vid.removeEventListener("canplay", handleCanPlay);
      };
    };

    // Try to setup immediately if video element exists
    const cleanup = setupVideoPlay();

    // If setup failed (video element not ready), try again after a short delay
    if (!hasSetupRef.current) {
      const timeoutId = setTimeout(() => {
        if (open && videoUrl && !hasSetupRef.current) {
          setupVideoPlay();
        }
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        if (cleanup) cleanup();
      };
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, [videoUrl, open, isClipPreview, skipSeek, timeStart]);

  const handleProgress = () => {
    const video = videoRef.current;
    if (!video || video.duration === 0) return;

    // Calculate buffered progress within the current source duration
    const currentTime = video.currentTime;

    // Find the buffered range that covers current position
    let bufferedEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (currentTime >= start && currentTime <= end) {
        bufferedEnd = end;
        break;
      }
    }

    // Calculate progress in full clip duration (0-100%)
    const progress = Math.max(0, Math.min(100, (bufferedEnd / video.duration) * 100));

    setBufferedProgress(progress);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose?.() : null)}>
      <DialogContent
        overlayClassName="bg-black/60"
        hideClose
        className="w-[95vw] max-w-5xl p-0 bg-black border border-white/10 overflow-hidden"
      >
        <DialogTitle className="sr-only">Video preview</DialogTitle>
        <DialogDescription className="sr-only">Video preview dialog</DialogDescription>

        <DialogClose asChild>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 w-10 h-10 rounded-full bg-white/80 hover:bg-white transition flex items-center justify-center cursor-pointer"
          >
            <img src={CloseSvg} alt="Close" className="w-4 h-4" />
          </button>
        </DialogClose>

        {videoUrl ? (
          <div className="relative w-full h-full bg-black aspect-video">
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              playsInline
              poster="" // Disable default poster/loading
              className="w-full h-full"
              style={{ backgroundColor: "black" }} // Prevent flash of white
              onProgress={handleProgress}
              onError={(e) => console.error("Video error:", e)}
            />

            {/* Loading Overlay */}
            {isLoading && showCustomLoading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-white text-sm">動画を準備中...</p>
                    {bufferedProgress > 0 && (
                      <div className="w-48 bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${bufferedProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="w-full aspect-video flex items-center justify-center text-white/80">
            プレビューを読み込み中...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

