import { useEffect, useMemo, useRef, useState } from "react";

import logo from "../assets/logo/logo.svg";
import searchMobile from "../assets/icons/searchmobile.png";
import searchSp from "../assets/icons/searchSp.png";
import library from "../assets/icons/Library.png";

import MyAccount from "../assets/icons/user-profile-icon-df.png";
import PasswordIcon from "../assets/icons/password-icon.svg";
import Signout from "../assets/icons/signout-icon-df.png";

import "../assets/css/sidebar.css";
import ForgotPasswordModal from "./modals/ForgotPasswordModal";
import AuthService from "../base/services/userService";
import VideoService from "../base/services/videoService";

import { X } from "lucide-react";

export default function Sidebar({ isOpen, onClose, user, onVideoSelect, onNewAnalysis, onShowFeedback, refreshKey, selectedVideo, showFeedback }) {
  const sidebarRef = useRef(null);
  const dropdownRef = useRef(null);

  const [openDropdown, setOpenDropdown] = useState(false);
  const [openForgotPassword, setOpenForgotPassword] = useState(false);
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);

  // Sync selectedVideoId when video is selected from outside (e.g., after upload)
  useEffect(() => {
    if (selectedVideo?.id) {
      setSelectedVideoId(selectedVideo.id);
    }
  }, [selectedVideo?.id]);

  // ===== sidebar search (PC + SP) =====
  const [searchValue, setSearchValue] = useState("");
  const [showBackButton, setShowBackButton] = useState(false);

  // ===== user fallback =====
  const effectiveUser =
    user ??
    (() => {
      try {
        const s = localStorage.getItem("user");
        return s ? JSON.parse(s) : { isLoggedIn: false };
      } catch {
        return { isLoggedIn: false };
      }
    })();

  // ===== fetch videos =====
  useEffect(() => {
    const fetchVideos = async () => {
      if (!effectiveUser?.isLoggedIn) {
        setVideos([]);
        setSelectedVideoId(null);
        return;
      }

      // Use id if available, otherwise use email
      const userId = effectiveUser.id || effectiveUser.email;
      if (!userId) {
        setVideos([]);
        return;
      }

      setLoadingVideos(true);
      try {
        const videoList = await VideoService.getVideosByUser(userId);
        setVideos(videoList || []);
      } catch (error) {
        console.error("Error fetching videos:", error);
        setVideos([]);
      } finally {
        setLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [effectiveUser?.isLoggedIn, effectiveUser?.id, effectiveUser?.email, refreshKey]);

  const filteredVideos = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return videos;
    return (videos || []).filter((video) => {
      const name = (video?.original_filename ?? "").toString().toLowerCase();
      const id = (video?.id ?? "").toString().toLowerCase();
      return name.includes(query) || id.includes(query);
    });
  }, [videos, searchValue]);

  const handleVideoClick = (video) => {
    setSelectedVideoId(video.id);
    if (onVideoSelect) {
      onVideoSelect(video);
    }

    if (onClose) {
      onClose();
    }
  };

  // ===== dropdown click outside =====
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setShowBackButton(true);
      }, 300); // đúng duration sidebar

      return () => clearTimeout(timer);
    } else {
      setShowBackButton(false);
    }
  }, [isOpen]);

  const toggleDropdown = () => {
    setOpenDropdown((prev) => !prev);
  };

  return (
    <>
      {/* OVERLAY – mobile */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity
        ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* SIDEBAR */}
      <aside
        ref={sidebarRef}
        className={`fixed md:static top-0 left-0 z-50 py-4 pl-4 pr-0
        w-full md:min-w-[260px] md:w-[320px] bg-white md:h-screen
        bottom-0
        flex flex-col 
        transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
        md:overflow-y-auto md:scrollbar-custom`}
      >
        {/* ================= PC ================= */}
        <div className="block space-y-3 pr-4 ">
          <div className="flex items-center">
            <img src={logo} className="w-[37px] h-[35px]" />
            <span className="font-semibold text-[22px] ml-2 bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))] bg-clip-text text-transparent">
              Aitherhub
            </span>
          </div>
          <div className="mt-[28px]">
            <div
              onClick={() => {
                setSelectedVideoId(null);
                if (onVideoSelect) {
                  onVideoSelect(null);
                }
                if (onNewAnalysis) {
                  onNewAnalysis();
                }
              }}
              className={`flex items-center gap-2 p-2 px-4 border rounded-md cursor-pointer transition-all duration-200 ease-out ${!showFeedback && !selectedVideo
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 hover:bg-gray-100"
                }`}
            >
              {/* <img src={write} className="w-[30px] h-[30px]" /> */}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={!showFeedback && !selectedVideo ? "#7c3aed" : "#213547"} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil-icon lucide-pencil transition-colors duration-200 ease-out"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
              <span className={`text-sm transition-colors duration-200 ease-out ${!showFeedback && !selectedVideo ? "text-purple-700 font-medium" : "text-[#020817]"
                }`}>{window.__t('newAnalysis')}</span>
            </div>
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={window.__t('searchChat')}
                className="flex h-10 w-full rounded-md mt-2 border px-8 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm bg-muted/50 border-border"
              />
              {searchValue.trim() && (
                <X className="w-4 h-4 text-gray-500 hover:text-gray-700 cursor-pointer absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchValue("")} />
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (onShowFeedback) {
                  onShowFeedback();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (onShowFeedback) {
                    onShowFeedback();
                  }
                }
              }}
              className={`flex items-center gap-2 p-2 px-4 mt-2 rounded-md cursor-pointer transition-all duration-200 ease-out ${showFeedback
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 hover:bg-gray-100"
                }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showFeedback ? "#7c3aed" : "#6b7280"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-message-square-icon lucide-message-square transition-colors duration-200 ease-out"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /></svg>
              <span className={`text-sm transition-colors duration-200 ease-out ${showFeedback ? "text-purple-700 font-medium" : "text-muted-foreground "
                }`}>{window.__t('feedback')}</span>
            </div>
          </div>
        </div>

        {/* ================= SP ================= */}
        <div className="hidden mt-[22px] px-4 shrink-0">
          {/* <div className="flex justify-between items-center ml-[50px] mb-[20px] gap-2">
            <div className="relative w-full max-w-[270px]">
              <div className="relative p-px rounded-[5px] bg-linear-to-b from-[#4500FF] via-[#6A00FF] to-[#9B00FF]">
                <img src={searchSp} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  placeholder={window.__t("searchChat")}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="
                    w-full h-[40px] rounded-[5px] bg-white text-black pl-[35px] pr-3 outline-none

                    placeholder:text-[#9B00FF]
                    placeholder:font-bold
                    placeholder:text-[14px]

                    placeholder:transition-opacity
                    placeholder:duration-100
                    focus:placeholder:opacity-50
                  "
                />

              </div>
            </div>

            <img src={searchMobile} onClick={() => { setSelectedVideoId(null); if (onVideoSelect) onVideoSelect(null); if (onNewAnalysis) onNewAnalysis(); }} className="w-[32px] cursor-pointer" />
          </div> */}

          <div className="bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))]">
            <div className="bg-white">
              <div className="flex items-center mb-5 mt-1">
                <img src={logo} className="w-10 h-10 ml-2" />
                <span className="ml-2 font-semibold text-[24px] bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))] bg-clip-text text-transparent">
                  Aitherhub
                </span>
              </div>

              <div className="flex items-center">
                <img src={library} className="w-[29px] h-[22px] ml-2" />
                <span className="ml-4 font-semibold text-[24px] bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))] bg-clip-text text-transparent">
                  ライブラリ
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ================= COMMON ================= */}
        <div className="mt-6 md:space-y-3 flex flex-col flex-1 min-h-0 pl-4 pr-0 md:px-0">
          <span className="block text-[#9E9E9E] text-left shrink-0 text-sm">{window.__t('analysisHistory')}</span>

          {effectiveUser?.isLoggedIn && (
            <>
              <div className="flex-1 min-h-0 flex flex-col">
                {loadingVideos && videos.length === 0 ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                  </div>
                ) : filteredVideos.length > 0 ? (
                  <div className="flex flex-col items-start gap-2 flex-1 min-h-0 overflow-y-auto scrollbar-custom">
                    {loadingVideos && (
                      <div className="w-full flex justify-center py-1">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                      </div>
                    )}
                    {filteredVideos.map((video) => (
                      <div className={`w-full min-h-10 flex items-center gap-2 font-semibold cursor-pointer text-black p-2 rounded-lg text-left transition-all duration-200 ease-out ${selectedVideoId === video.id
                        ? "bg-purple-100 text-purple-700"
                        : "hover:text-gray-400 hover:bg-gray-100"
                        }`} key={video.id}
                        onClick={() => handleVideoClick(video)}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="min-w-[16px]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-video-icon lucide-video"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
                        <span
                          className={`text-sm font-medium text-[#6b7280] block truncate`}
                        >
                          {video.original_filename || `${window.__t('videoTitleFallback')} ${video.id}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 text-sm py-4">
                    {videos.length > 0 && searchValue.trim()
                      ? (window.__t("noSearchResults") || "No results")
                      : window.__t("noVideos")}
                  </div>
                )}
              </div>

              {/* ===== Email pill (SP) ===== */}
              <div
                onClick={toggleDropdown}
                className="ml-[7px] w-[225px] h-[45px] mb-[25px] mt-auto
                md:hidden rounded-[50px] border border-[#B5B5B5]
                flex items-center justify-center shadow cursor-pointer shrink-0"
              >
                <span className="font-bold text-sm max-w-[180px] truncate inline-block align-middle text-gray-700">
                  {effectiveUser.email}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ================= DROPDOWN ================= */}
        {openDropdown && (
          <ul
            ref={dropdownRef}
            className="absolute bottom-[80px] left-[30px] w-[210px]
            bg-white text-black rounded-[10px] border shadow-lg z-50 overflow-hidden"
          >
            <li
              onClick={() => {
                setOpenDropdown(false);
                if (onClose) onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer transition-all duration-200 ease-out text-gray-700"
            >
              <img src={MyAccount} className="w-4 h-4" />
              {window.__t('myAccount')}
            </li>

            <li
              onClick={() => {
                setOpenDropdown(false);
                setOpenForgotPassword(true);
                if (onClose) onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer transition-all duration-200 ease-out text-gray-700"
            >
              <img src={PasswordIcon} className="w-4 h-4" />
              {window.__t('changePassword')}
            </li>

            <li
              onClick={() => {
                setOpenDropdown(false);
                if (onClose) onClose();
                AuthService.logout();
                window.location.reload();
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer transition-all duration-200 ease-out text-gray-700"
            >
              <img src={Signout} className="w-4 h-4" />
              {window.__t('signOut')}
            </li>
          </ul>
        )}
      </aside>
      <button
        onClick={onClose}
        style={{ fontSize: "24px", borderRadius: "50%" }}
        className={`md:hidden ml-[-10px] fixed top-[16px] right-[16px] z-70 w-[32px] h-[32px] flex items-center justify-center font-bold bg-white rounded-full shadow-lg transition-all duration-200 ease-out ${showBackButton ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 translate-x-2 pointer-events-none"}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" stroke="#4500FF" />
        </svg>

      </button>


      {/* ===== MODAL ===== */}
      <ForgotPasswordModal
        open={openForgotPassword}
        onOpenChange={setOpenForgotPassword}
      />
    </>
  );
}
