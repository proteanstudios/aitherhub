import Sidebar from "../components/Sidebar";
import MainContent from '../components/MainContent';
import VideoDetail from '../components/VideoDetail';
import { useState } from "react";
import Dashboard from "../pages/Dashboard";

export default function MainLayout() {
  const [openSidebar, setOpenSidebar] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [user, setUser] = useState(() => {
    try {
      const s = localStorage.getItem("user");
      return s ? JSON.parse(s) : { isLoggedIn: false };
    } catch (e) {
      return { isLoggedIn: false };
    }
  });

  const handleVideoSelect = (video) => {
    setSelectedVideo(video);
  };

  const handleUserChange = (newUser) => {
    setUser(newUser);
    if (!newUser?.isLoggedIn) {
      setSelectedVideo(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-[1280px] flex">
        <aside className="hidden xl:block w-1/5 bg-white text-black">
          <Sidebar 
            isOpen={openSidebar} 
            onClose={() => setOpenSidebar(false)} 
            user={user}
            onVideoSelect={handleVideoSelect}
          />
        </aside>
        <div className="xl:hidden">
          <Sidebar 
            isOpen={openSidebar} 
            onClose={() => setOpenSidebar(false)} 
            user={user}
            onVideoSelect={handleVideoSelect}
          />
        </div>
        <main className="w-full md:w-4/5 bg-gradient-to-b from-[#4500FF] to-[#9B00FF] text-white">
          <MainContent 
            onOpenSidebar={() => setOpenSidebar(true)} 
            user={user} 
            setUser={handleUserChange}
          >
            {selectedVideo && <VideoDetail video={selectedVideo} />}
          </MainContent>
        </main>
      </div>
    </div>
  );
}
