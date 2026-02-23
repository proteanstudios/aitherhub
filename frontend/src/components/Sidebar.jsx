import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import logo from "../assets/logo/logo.svg";
import searchMobile from "../assets/icons/searchmobile.png";
import searchSp from "../assets/icons/searchSp.png";
import library from "../assets/icons/Library.png";

import "../assets/css/sidebar.css";
import ForgotPasswordModal from "./modals/ForgotPasswordModal";
import AuthService from "../base/services/userService";
import VideoService from "../base/services/videoService";

import { ChevronDown, LogOut, Settings, User, X, MoreHorizontal, Pencil, Trash2, Scissors, MessageSquareText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// Helper: check if a video is a live analysis
const isLiveVideo = (video) => {
  const name = (video?.original_filename || '').toLowerCase();
  return name.startsWith('tiktok_live_');
};

export default function Sidebar({ isOpen, onClose, user, onVideoSelect, onNewAnalysis, onShowFeedback, refreshKey, selectedVideo, showFeedback }) {
  const sidebarRef = useRef(null);
  const [openForgotPassword, setOpenForgotPassword] = useState(false);
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [menuOpenVideoId, setMenuOpenVideoId] = useState(null);
  const [renamingVideoId, setRenamingVideoId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmVideoId, setDeleteConfirmVideoId] = useState(null);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenVideoId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDeleteVideo = async (videoId) => {
    try {
      await VideoService.deleteVideo(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
      setDeleteConfirmVideoId(null);
      setMenuOpenVideoId(null);
      if (selectedVideoId === videoId) {
        setSelectedVideoId(null);
        navigate('/');
        if (onVideoSelect) onVideoSelect(null);
        if (onNewAnalysis) onNewAnalysis();
      }
    } catch (error) {
      console.error("Failed to delete video:", error);
      alert("動画の削除に失敗しました");
    }
  };

  const handleRenameVideo = async (videoId) => {
    const newName = renameValue.trim();
    if (!newName) return;
    try {
      await VideoService.renameVideo(videoId, newName);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, original_filename: newName } : v
        )
      );
      setRenamingVideoId(null);
      setRenameValue("");
      setMenuOpenVideoId(null);
    } catch (error) {
      console.error("Failed to rename video:", error);
      alert("名前の変更に失敗しました");
    }
  };

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
        // Deduplicate: keep only the latest video per original_filename
        const seen = new Map();
        const deduped = [];
        for (const v of (videoList || [])) {
          const key = v.original_filename || v.id;
          if (!seen.has(key)) {
            seen.set(key, true);
            deduped.push(v);
          }
        }
        setVideos(deduped);
      } catch (error) {
        console.error("Error fetching videos:", error);
        setVideos([]);
      } finally {
        setLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [effectiveUser?.isLoggedIn, effectiveUser?.id, effectiveUser?.email, refreshKey]);

  // Split videos into live and regular
  const { liveVideos, regularVideos } = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const filtered = query
      ? (videos || []).filter((video) => {
          const name = (video?.original_filename ?? "").toString().toLowerCase();
          const id = (video?.id ?? "").toString().toLowerCase();
          return name.includes(query) || id.includes(query);
        })
      : videos;

    const live = [];
    const regular = [];
    for (const v of filtered) {
      if (isLiveVideo(v)) {
        live.push(v);
      } else {
        regular.push(v);
      }
    }
    return { liveVideos: live, regularVideos: regular };
  }, [videos, searchValue]);

  const filteredVideos = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return videos;
    return (videos || []).filter((video) => {
      const name = (video?.original_filename ?? "").toString().toLowerCase();
      const id = (video?.id ?? "").toString().toLowerCase();
      return name.includes(query) || id.includes(query);
    });
  }, [videos, searchValue]);

  const navigate = useNavigate();

  const handleVideoClick = (video) => {
    setSelectedVideoId(video.id);
    navigate(`/video/${video.id}`);
    if (onVideoSelect) {
      onVideoSelect(video);
    }
    if (onClose) {
      onClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setShowBackButton(true);
      }, 300);

      return () => clearTimeout(timer);
    } else {
      setShowBackButton(false);
    }
  }, [isOpen]);

  // Extract username from live video filename
  const getLiveUsername = (video) => {
    const name = video?.original_filename || '';
    const match = name.match(/tiktok_live_(.+?)\.mp4$/);
    return match ? `@${match[1]}` : name;
  };

  // Render a single video item
  const renderVideoItem = (video, isLive = false) => (
    <div className={`group relative w-full min-h-10 flex items-center gap-2 font-semibold cursor-pointer text-black p-2 rounded-lg text-left transition-all duration-200 ease-out ${selectedVideoId === video.id
      ? "bg-purple-100 text-purple-700"
      : "hover:text-gray-400 hover:bg-gray-100"
      }`} key={video.id}
      onClick={() => { if (renamingVideoId !== video.id && deleteConfirmVideoId !== video.id) handleVideoClick(video); }}>
      
      {/* Icon: Live or Video */}
      {isLive ? (
        <div className="min-w-[16px] flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="min-w-[16px]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="min-w-[16px]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
      )}

      {renamingVideoId === video.id ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameVideo(video.id);
            if (e.key === "Escape") { setRenamingVideoId(null); setRenameValue(""); }
          }}
          onBlur={() => handleRenameVideo(video.id)}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-gray-700 bg-white border border-purple-300 rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-purple-400 w-full"
        />
      ) : deleteConfirmVideoId === video.id ? (
        <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-red-500">削除しますか？</span>
          <button onClick={() => handleDeleteVideo(video.id)} className="text-xs bg-red-500 text-white px-2 py-0.5 rounded hover:bg-red-600">削除</button>
          <button onClick={() => setDeleteConfirmVideoId(null)} className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded hover:bg-gray-300">取消</button>
        </div>
      ) : (
        <>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-[#6b7280] block truncate">
                {isLive ? getLiveUsername(video) : (video.original_filename || `${window.__t('videoTitleFallback')} ${video.id}`)}
              </span>
              {isLive && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white shrink-0 leading-none">
                  LIVE
                </span>
              )}
            </div>
            {!isLive && video.top_products && video.top_products.length > 0 && (
              <div className="flex items-center gap-1 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-emerald-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                <span className="text-[10px] text-emerald-600 truncate" title={video.top_products.join(' / ')}>
                  {video.top_products.map(p => p.length > 15 ? p.slice(0, 15) + '...' : p).join(' / ')}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {video.total_gmv != null && video.total_gmv > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-orange-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  {video.total_gmv >= 10000 ? `¥${(video.total_gmv / 10000).toFixed(1)}万` : `¥${Math.round(video.total_gmv).toLocaleString()}`}
                </span>
              )}
              {video.stream_duration != null && video.stream_duration > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {(() => { const h = Math.floor(video.stream_duration / 3600); const m = Math.floor((video.stream_duration % 3600) / 60); return h > 0 ? `${h}h${m.toString().padStart(2,'0')}m` : `${m}m`; })()}
                </span>
              )}
              {video.completed_clip_count > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-600">
                  <Scissors className="w-3 h-3" />
                  {video.completed_clip_count}
                </span>
              )}
              {video.memo_count > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                  <MessageSquareText className="w-3 h-3" />
                  {video.memo_count}
                </span>
              )}
            </div>
          </div>
          <div className="relative" ref={menuOpenVideoId === video.id ? menuRef : null}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpenVideoId(menuOpenVideoId === video.id ? null : video.id); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200"
            >
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </button>
            {menuOpenVideoId === video.id && (
              <div className="absolute right-0 top-8 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingVideoId(video.id); setRenameValue(video.original_filename || ""); setMenuOpenVideoId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Pencil className="w-3.5 h-3.5" /> 名前を変更
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmVideoId(video.id); setMenuOpenVideoId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> 削除
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

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
                navigate('/');
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
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={!showFeedback && !selectedVideo ? "#7c3aed" : "#213547"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pencil-icon lucide-pencil transition-colors duration-200 ease-out"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
              <span className={`text-sm transition-colors duration-200 ease-out ${!showFeedback && !selectedVideo ? "text-purple-700 font-medium" : "text-[#020817]"
                }`}>{window.__t('newAnalysis')}</span>
            </div>
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showFeedback ? "#7c3aed" : "#6b7280"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors duration-200 ease-out"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span className={`text-sm transition-colors duration-200 ease-out ${showFeedback ? "text-purple-700 font-medium" : "text-muted-foreground "
                }`}>{window.__t('feedback')}</span>
            </div>
          </div>
        </div>

        {/* ================= SP ================= */}
        <div className="hidden mt-[22px] px-4 shrink-0">
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

          {effectiveUser?.isLoggedIn && (
            <>
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-custom">
                {loadingVideos && videos.length === 0 ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                  </div>
                ) : (liveVideos.length > 0 || regularVideos.length > 0) ? (
                  <>
                    {/* ── Live Analysis Section ── */}
                    {liveVideos.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                          </span>
                          <span className="text-[#9E9E9E] text-sm font-medium">ライブ解析</span>
                          <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full font-bold">{liveVideos.length}</span>
                        </div>
                        <div className="flex flex-col items-start gap-1">
                          {liveVideos.map((video) => renderVideoItem(video, true))}
                        </div>
                      </div>
                    )}

                    {/* ── Video Analysis Section ── */}
                    {regularVideos.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
                          <span className="text-[#9E9E9E] text-sm">{window.__t('analysisHistory')}</span>
                        </div>
                        <div className="flex flex-col items-start gap-1">
                          {loadingVideos && (
                            <div className="w-full flex justify-center py-1">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                            </div>
                          )}
                          {regularVideos.map((video) => renderVideoItem(video, false))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center text-gray-400 text-sm py-4">
                    {videos.length > 0 && searchValue.trim()
                      ? (window.__t("noSearchResults") || "No results")
                      : window.__t("noVideos")}
                  </div>
                )}
              </div>

              {/* ===== Email pill (SP) ===== */}
              <div className="ml-[7px] mb-[25px] mt-auto md:hidden shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="w-[225px] h-[45px] rounded-[50px] border border-[#B5B5B5] flex items-center justify-center shadow cursor-pointer transition-colors hover:bg-gray-100 active:bg-gray-100"
                    >
                      <span className="font-bold text-sm max-w-[165px] truncate inline-block align-middle text-gray-700">
                        {effectiveUser?.email || ""}
                      </span>
                      <ChevronDown className="ml-1 w-4 h-4 text-gray-500" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[210px]">
                    <DropdownMenuLabel>{window.__t("myAccount")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onSelect={() => {
                        onClose?.();
                      }}
                    >
                      <User className="w-4 h-4" />
                      {window.__t("myAccount")}
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onSelect={() => {
                        setOpenForgotPassword(true);
                        // Close sidebar after opening modal to avoid unmount/blur race on mobile
                        setTimeout(() => onClose?.(), 0);
                      }}
                    >
                      <Settings className="w-4 h-4" />
                      {window.__t("changePassword")}
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      className="text-red-500 focus:text-red-600"
                      onSelect={() => {
                        onClose?.();
                        AuthService.logout();
                        window.location.reload();
                      }}
                    >
                      <LogOut className="w-4 h-4" />
                      {window.__t("signOut")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>
      </aside>
      <button
        onClick={onClose}
        style={{ fontSize: "24px", borderRadius: "50%" }}
        className={`md:hidden ml-[-10px] fixed top-[16px] right-[16px] z-70 w-[32px] h-[32px] flex items-center justify-center font-bold bg-white rounded-full shadow-lg transition-all duration-200 ease-out ${showBackButton ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 translate-x-2 pointer-events-none"}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" stroke="#4500FF" />
        </svg>

      </button>

      {/* ===== MODAL (must be outside dropdown content to avoid unmount when menu closes) ===== */}
      <ForgotPasswordModal open={openForgotPassword} onOpenChange={setOpenForgotPassword} />

    </>
  );
}
