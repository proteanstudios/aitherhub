import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useEffect, useRef } from "react";
import CloseSvg from "../../assets/icons/close.svg";

/**
 * Modal video preview that seeks to a specific start time.
 */
export default function VideoPreviewModal({ open, onClose, videoUrl, timeStart = 0, timeEnd = null }) {
  const videoRef = useRef(null);

  // Seek to start time when URL changes or modal opens
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl || !open) return;
    const handleLoaded = () => {
      try {
        if (timeStart !== null && timeStart !== undefined) {
          vid.currentTime = timeStart;
        }
        vid.play().catch(() => {});
      } catch (e) {
        // ignore seek errors
      }
    };
    // if metadata already loaded (reopen modal), seek immediately
    if (vid.readyState >= 1) {
      handleLoaded();
    }
    vid.addEventListener("loadedmetadata", handleLoaded);
    return () => vid.removeEventListener("loadedmetadata", handleLoaded);
  }, [videoUrl, timeStart, open]);

  const handleTimeUpdate = (e) => {
    if (!timeEnd) return;
    try {
      if (e.currentTarget.currentTime >= timeEnd) {
        e.currentTarget.currentTime = timeEnd;
        e.currentTarget.pause();
      }
    } catch (err) {
      // ignore
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 transition-opacity" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <DialogPanel className="relative w-full max-w-5xl rounded-xl overflow-hidden bg-black shadow-2xl">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 w-10 h-10 rounded-full bg-white/80 hover:bg-white transition flex items-center justify-center"
          >
            <img src={CloseSvg} alt="Close" className="w-4 h-4" />
          </button>
          {videoUrl ? (
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full bg-black aspect-video"
              onTimeUpdate={handleTimeUpdate}
            />
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

