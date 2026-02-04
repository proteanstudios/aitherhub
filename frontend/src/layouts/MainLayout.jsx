import Sidebar from "../components/Sidebar";
import MainContent from '../components/MainContent';
import VideoDetail from '../components/VideoDetail';
import { useState, useCallback, useMemo, useEffect } from "react";

const getUserFromStorage = () => {
  try {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : { isLoggedIn: false };
  } catch {
    return { isLoggedIn: false };
  }
};

export default function MainLayout() {
  const [openSidebar, setOpenSidebar] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [user, setUser] = useState(getUserFromStorage);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let scrollY;
    if (openSidebar) {
      scrollY = window.scrollY;

      Object.assign(document.body.style, {
        position: "fixed",
        top: `-${scrollY}px`,
        left: "0",
        right: "0",
        width: "100%",
        overflow: "hidden",
      });

      return () => {
        Object.assign(document.body.style, {
          position: "",
          top: "",
          left: "",
          right: "",
          width: "",
          overflow: "",
        });
        window.scrollTo(0, scrollY);
      };
    }
  }, [openSidebar]);
  const handleVideoSelect = useCallback((video) => {
    setSelectedVideo(video);
  }, []);

  const handleUserChange = useCallback((newUser) => {
    setUser(newUser);
    if (!newUser?.isLoggedIn) {
      setSelectedVideo(null);
    }
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setOpenSidebar(false);
  }, []);

  const handleOpenSidebar = useCallback(() => {
    setOpenSidebar(true);
  }, []);

  const handleNewAnalysis = useCallback(() => {
    setSelectedVideo(null);
    setOpenSidebar(false);
  }, []);

  const handleUploadSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const sidebarProps = useMemo(() => ({
    isOpen: openSidebar,
    onClose: handleCloseSidebar,
    user,
    onVideoSelect: handleVideoSelect,
    onNewAnalysis: handleNewAnalysis,
    refreshKey,
    selectedVideo,
  }), [openSidebar, handleCloseSidebar, user, handleVideoSelect, handleNewAnalysis, refreshKey, selectedVideo]);

  const mainContentProps = useMemo(() => ({
    onOpenSidebar: handleOpenSidebar,
    user,
    setUser: handleUserChange,
    onUploadSuccess: handleUploadSuccess,
    onVideoSelect: handleVideoSelect,
  }), [handleOpenSidebar, user, handleUserChange, handleUploadSuccess, handleVideoSelect]);

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full flex">

        <aside className="hidden xl:block w-1/5 bg-white text-black">
          <Sidebar {...sidebarProps} />
        </aside>
        
        <div className="xl:hidden">
          <Sidebar {...sidebarProps} />
        </div>
        
        <main className="w-full md:w-4/5 bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))]
 text-white">
          <MainContent {...mainContentProps}>
            {selectedVideo && <VideoDetail video={selectedVideo} />}
          </MainContent>
        </main>
      </div>
    </div>
  );
}
