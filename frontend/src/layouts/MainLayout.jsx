import Sidebar from "../components/Sidebar";
import MainContent from '../components/MainContent';
import VideoDetail from '../components/VideoDetail';
import { useState, useCallback, useMemo } from "react";

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

  const sidebarProps = useMemo(() => ({
    isOpen: openSidebar,
    onClose: handleCloseSidebar,
    user,
    onVideoSelect: handleVideoSelect,
    onNewAnalysis: handleNewAnalysis,
  }), [openSidebar, handleCloseSidebar, user, handleVideoSelect, handleNewAnalysis]);

  const mainContentProps = useMemo(() => ({
    onOpenSidebar: handleOpenSidebar,
    user,
    setUser: handleUserChange,
  }), [handleOpenSidebar, user, handleUserChange]);

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full flex">

        <aside className="hidden xl:block w-1/5 bg-white text-black">
          <Sidebar {...sidebarProps} />
        </aside>
        
        <div className="xl:hidden">
          <Sidebar {...sidebarProps} />
        </div>
        
        <main className="w-full md:w-4/5 bg-gradient-to-b from-[#4500FF] to-[#9B00FF] text-white">
          <MainContent {...mainContentProps}>
            {selectedVideo && <VideoDetail video={selectedVideo} />}
          </MainContent>
        </main>
      </div>
    </div>
  );
}
