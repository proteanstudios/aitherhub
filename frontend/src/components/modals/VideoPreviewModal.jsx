import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useEffect, useRef, useState } from "react";
import CloseSvg from "../../assets/icons/close.svg";

/**
 * Modal video preview that seeks to a specific start time.
 */
export default function VideoPreviewModal({ open, onClose, videoUrl, timeStart = 0, timeEnd = null, skipSeek = false }) {
  const videoRef = useRef(null);
  const hasSetupRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [bufferedProgress, setBufferedProgress] = useState(0);
  const [showCustomLoading, setShowCustomLoading] = useState(true);
  const prevOpenRef = useRef(false);
  const prevVideoUrlRef = useRef(null);

  // Reset states when modal closes or URL changes
  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    const prevVideoUrl = prevVideoUrlRef.current;

    // Reset when modal closes or video URL changes
    if ((!open && prevOpen) || (videoUrl !== prevVideoUrl)) {
      console.log('🔄 Resetting states');
      setIsLoading(true); // eslint-disable-line
      setPlayBlocked(false);
      setBufferedProgress(0);
      setShowCustomLoading(true); // Always show custom loading initially
      hasSetupRef.current = false;
    }

    prevOpenRef.current = open;
    prevVideoUrlRef.current = videoUrl;
  }, [open, videoUrl]);

  // Seek to start time when modal opens or URL changes
  useEffect(() => {
    console.log('🎬 VideoPreviewModal useEffect triggered:', {
      open,
      videoUrl: !!videoUrl,
      timeStart,
      timeEnd,
      videoRef: !!videoRef.current,
      currentTime: videoRef.current?.currentTime
    });

    // Skip if modal closed or no video
    if (!open || !videoUrl) {
      return;
    }

    const setupVideoSeekAndPlay = () => {
      const vid = videoRef.current;
      if (!vid || hasSetupRef.current) {
        console.log('⏳ Video not ready or already setup:', {
          videoRef: !!vid,
          hasSetup: hasSetupRef.current
        });
        return;
      }

      console.log('🎬 Setting up seek/play logic');
      hasSetupRef.current = true;

      let hasSeeked = false;

      const seekAndPlay = async () => {
        try {
          // Show custom loading when starting seek/play process
          setShowCustomLoading(true);
          setIsLoading(true);

          const shouldSeek = !skipSeek && !hasSeeked && Math.abs(vid.currentTime - timeStart) > 0.5;
          if (shouldSeek && timeStart !== null && timeStart !== undefined) {
            vid.currentTime = timeStart;
            hasSeeked = true;
          } else if (skipSeek) {
            hasSeeked = true;
          } else {
            console.log('⏭️ Skipping seek - already at correct position or already seeked');
          }

          // Try to play, handle promise rejection (autoPlay blocked)
          try {
            await vid.play();
            setPlayBlocked(false);
            setIsLoading(false);
            // Keep custom loading for a moment to show success, then hide
            setTimeout(() => setShowCustomLoading(false), 500);
          } catch (error) {
            console.log('❌ AutoPlay blocked:', error.message);
            setPlayBlocked(true);
            setIsLoading(false);
            // Keep custom loading to show play button
            // Don't hide it automatically since user needs to interact
          }
        } catch (e) {
          console.error('❌ Error seeking video:', e);
          setIsLoading(false);
          setShowCustomLoading(false);
        }
      };

      const handleCanPlay = () => {
        console.log('🎬 handleCanPlay triggered, readyState:', vid.readyState);
        // Only seek if we haven't seeked yet
        if (!hasSeeked) {
          seekAndPlay();
        } else {
          console.log('⏭️ Skipping seek in handleCanPlay - already seeked');
        }
      };

      const handleLoadedMetadata = () => {
        console.log('📋 handleLoadedMetadata triggered, readyState:', vid.readyState);
        // If video is already ready to play, seek immediately
        if (vid.readyState >= 3) { // HAVE_FUTURE_DATA or higher
          console.log('📋 Video ready to play, calling seekAndPlay');
          seekAndPlay();
        } else {
          console.log('📋 Video not ready yet, waiting for canplay');
        }
      };

      // Add event listeners
      console.log('👂 Adding event listeners');
      vid.addEventListener("loadedmetadata", handleLoadedMetadata);
      vid.addEventListener("canplay", handleCanPlay);

      // Check current state
      console.log('🔍 Checking current video state - readyState:', vid.readyState);
      if (vid.readyState >= 3) {
        console.log('🔍 Video already ready, seeking immediately');
        seekAndPlay();
      } else if (vid.readyState >= 1) {
        console.log('🔍 Metadata loaded, checking if can seek');
        // Metadata loaded but not ready to play yet
        handleLoadedMetadata();
      } else {
        console.log('🔍 Video not loaded yet, waiting for events');
      }

      return () => {
        console.log('🧹 Cleaning up event listeners');
        vid.removeEventListener("loadedmetadata", handleLoadedMetadata);
        vid.removeEventListener("canplay", handleCanPlay);
      };
    };

    // Try to setup immediately if video element exists
    const cleanup = setupVideoSeekAndPlay();

    // If setup failed (video element not ready), try again after a short delay
    if (!hasSetupRef.current) {
      const timeoutId = setTimeout(() => {
        if (open && videoUrl && !hasSetupRef.current) {
          console.log('🔄 Retrying setup after delay');
          setupVideoSeekAndPlay();
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
  }, [videoUrl, timeStart, timeEnd, open]);

  const handleTimeUpdate = (e) => {
    if (!timeEnd) return;
    try {
      if (e.currentTarget.currentTime >= timeEnd) {
        e.currentTarget.currentTime = timeEnd;
        e.currentTarget.pause();
      }
    } catch {
      // ignore
    }
  };

  const handleManualPlay = async () => {
    if (!videoRef.current) return;

    try {
      setIsLoading(true);
      await videoRef.current.play();
      setPlayBlocked(false);
      setIsLoading(false);
      // Hide custom loading after successful manual play
      setTimeout(() => setShowCustomLoading(false), 500);
    } catch (error) {
      console.error('Manual play failed:', error);
      setPlayBlocked(true);
      setIsLoading(false);
    }
  };

  const handleProgress = () => {
    const video = videoRef.current;
    if (!video || video.duration === 0) return;

    // Calculate buffered progress within preview range
    const currentTime = video.currentTime;
    const previewStart = timeStart || 0;
    const previewEnd = timeEnd || video.duration;

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

    // Calculate progress within preview range (0-100%)
    const previewDuration = previewEnd - previewStart;
    const bufferedInPreview = Math.min(bufferedEnd, previewEnd) - previewStart;
    const progress = Math.max(0, Math.min(100, (bufferedInPreview / previewDuration) * 100));

    setBufferedProgress(progress);
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 transition-opacity" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <DialogPanel className="relative w-full max-w-5xl rounded-xl overflow-hidden bg-black shadow-2xl">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 w-10 h-10 rounded-full bg-white/80 hover:bg-white transition flex items-center justify-center cursor-pointer"
          >
            <img src={CloseSvg} alt="Close" className="w-4 h-4" />
          </button>
          {videoUrl ? (
            <div className="relative w-full h-full bg-black aspect-video">
              <video
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                controls={!playBlocked && !showCustomLoading && !isLoading}
                autoPlay
                muted
                playsInline
                poster="" // Disable default poster/loading
                className="w-full h-full"
                style={{ backgroundColor: 'black' }} // Prevent flash of white
                onTimeUpdate={handleTimeUpdate}
                onProgress={handleProgress}
                onLoadStart={() => console.log('🎬 Video onLoadStart')}
                onLoadedData={() => console.log('🎬 Video onLoadedData')}
                onCanPlay={() => console.log('🎬 Video onCanPlay')}
                onCanPlayThrough={() => console.log('🎬 Video onCanPlayThrough')}
                onPlay={() => console.log('▶️ Video started playing')}
                onPause={() => console.log('⏸️ Video paused')}
                onError={(e) => console.error('❌ Video error:', e)}
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

              {/* Play Blocked Overlay */}
              {playBlocked && !isLoading && (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="text-white text-center">
                      <p className="text-lg mb-2">再生するにはクリックしてください</p>
                      <p className="text-sm text-gray-300">ブラウザの自動再生ポリシーにより停止されました</p>
                    </div>
                    <button
                      onClick={handleManualPlay}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                      <span>▶️</span>
                      再生する
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-white/80">
              プレビューを読み込み中...
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

