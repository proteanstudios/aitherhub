import { useEffect, useRef, useState } from "react";

import logo from "../assets/logo/logo.svg";
import write from "../assets/icons/write.png";
import searchIcon from "../assets/icons/search.svg";
import searchMobile from "../assets/icons/searchmobile.png";
import textSearch from "../assets/icons/text.png";
import searchSp from "../assets/icons/searchSp.png";
import library from "../assets/icons/Library.png";

import MyAccount from "../assets/icons/user-profile-icon-df.png";
import PasswordIcon from "../assets/icons/password-icon.svg";
import Signout from "../assets/icons/signout-icon-df.png";

import "../assets/css/sidebar.css";
import ForgotPasswordModal from "./modals/ForgotPasswordModal";
import AuthService from "../base/services/userService";
import VideoService from "../base/services/videoService";

export default function Sidebar({ isOpen, onClose, user, onVideoSelect, onNewAnalysis, refreshKey }) {
  const sidebarRef = useRef(null);
  const dropdownRef = useRef(null);

  const [openDropdown, setOpenDropdown] = useState(false);
  const [openForgotPassword, setOpenForgotPassword] = useState(false);
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);

  // ===== SP search =====
  const [searchValue, setSearchValue] = useState("");
  const [isFocus, setIsFocus] = useState(false);
  const showPlaceholder = !isFocus && searchValue === "";
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
        className={`fixed md:static top-0 left-0 z-50
        w-[350px] md:w-[260px] h-screen bg-white
        flex flex-col 
        transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
        md:overflow-y-auto md:scrollbar-custom md:py-4 md:pl-4 md:pr-0`}
      >
        {/* ================= PC ================= */}
        <div className="hidden md:block space-y-3">
        <img src={logo} className="w-[37px] h-[35px]" />

          <div 
            onClick={() => {
              if (onNewAnalysis) {
                onNewAnalysis();
              }
            }}
            className="flex items-center mt-[28px] ml-[5px] gap-2 cursor-pointer hover:text-gray-400"
          >
            <img src={write} className="w-[30px] h-[30px]" />
            <span className="font-semibold">新しい解析</span>
          </div>

          <div className="flex items-center ml-[10px] gap-2 cursor-pointer hover:text-gray-400">
            <img src={searchIcon} className="w-[20px] h-[20px]" />
            <span className="font-semibold">チャットを検索</span>
          </div>
        </div>

        {/* ================= SP ================= */}
        <div className="md:hidden mt-[22px] px-4 flex-shrink-0">
          <div className="flex justify-between items-center mb-[20px]">
            <div className="relative w-[270px]">
              <div className="p-[1px] rounded-[5px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
                <input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onFocus={() => setIsFocus(true)}
                  onBlur={() => setIsFocus(false)}
                  className="w-full h-[40px] rounded-[5px] bg-white pl-[12px] pr-3 outline-none"
                />
              </div>

              {showPlaceholder && (
                <div className="pointer-events-none absolute inset-0 flex items-center gap-2 px-3 text-gray-400">
                  <img src={searchSp} className="w-4 h-4" />
                  <img src={textSearch} className="h-[14px]" />
                </div>
              )}
            </div>

            <img src={searchMobile} className="w-[32px]" />
          </div>

          <div className="bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
            <div className="bg-white">
              <div className="flex items-center mb-5 mt-1">
              <img src={logo} className="w-10 h-10 ml-2" />
                <span className="ml-2 font-semibold text-[24px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF] bg-clip-text text-transparent">
                  Liveboost AI
                </span>
              </div>

              <div className="flex items-center">
                <img src={library} className="w-[29px] h-[22px] ml-2" />
                <span className="ml-4 font-semibold text-[24px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF] bg-clip-text text-transparent">
                  ライブラリ
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ================= COMMON ================= */}
        <div className="mt-6 md:space-y-3 flex flex-col flex-1 min-h-0 pl-4 pr-0 md:px-0">
          <span className="block ml-[16px] text-[#9E9E9E] font-semibold text-left flex-shrink-0">解析履歴</span>

          {effectiveUser?.isLoggedIn && (
            <>
              <div className="flex-1 min-h-0 flex flex-col">
                {loadingVideos ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                  </div>
                ) : videos.length > 0 ? (
                  <div className="flex flex-col items-start gap-2 flex-1 min-h-0 overflow-y-auto scrollbar-custom">
                    {videos.map((video) => (
                      <span
                        key={video.id}
                        onClick={() => handleVideoClick(video)}
                        className={`block font-semibold cursor-pointer transition-colors px-4 py-2 rounded-lg w-full text-left ${
                          selectedVideoId === video.id
                            ? "bg-purple-100 text-purple-700"
                            : "hover:text-gray-400 hover:bg-gray-100"
                        }`}
                      >
                        {video.original_filename || `Video ${video.id}`}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 text-sm py-4">
                    ビデオがありません
                  </div>
                )}
              </div>

              {/* ===== Email pill (SP) ===== */}
              <div
                onClick={toggleDropdown}
                className="ml-[7px] w-[223px] h-[45px] mb-[25px] mt-auto
                md:hidden rounded-[50px] border border-[#B5B5B5]
                flex items-center justify-center shadow cursor-pointer flex-shrink-0"
              >
                <span className="font-bold text-[18px] max-w-[160px] truncate inline-block align-middle">
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
            bg-white rounded-[10px] border shadow-lg z-50"
          >
            <li 
              onClick={() => {
                setOpenDropdown(false);
                if (onClose) onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100 cursor-pointer"
            >
              <img src={MyAccount} className="w-4 h-4" />
              マイアカウント
            </li>

            <li
              onClick={() => {
                setOpenDropdown(false);
                setOpenForgotPassword(true);
                if (onClose) onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100 cursor-pointer"
            >
              <img src={PasswordIcon} className="w-4 h-4" />
              パスワード変更
            </li>

            <li 
              onClick={() => {
                setOpenDropdown(false);
                if (onClose) onClose();
                AuthService.logout();
                window.location.reload();
              }}
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100 cursor-pointer"
            >
              <img src={Signout} className="w-4 h-4" />
              サインアウト
            </li>
          </ul>
        )}
      </aside>
      <button
  onClick={onClose}
  style={{ fontSize: "24px", borderRadius: "50%" }}
  className={`md:hidden ml-[-10px] fixed top-[28px] left-[350px] z-[70] w-[32px] h-[32px] flex items-center justify-center font-bold bg-white rounded-full shadow-lg transition-all duration-200 ease-out ${showBackButton ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 translate-x-2 pointer-events-none"}`}
>
  &lt;
</button>


      {/* ===== MODAL ===== */}
      <ForgotPasswordModal
        open={openForgotPassword}
        onClose={() => setOpenForgotPassword(false)}
      />
    </>
  );
}
