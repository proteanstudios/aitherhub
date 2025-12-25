import { useRef, useState } from "react";
import logo from "../assets/logo/logo.png";
import write from "../assets/icons/write.png";
import searchIcon from "../assets/icons/search.png";
import searchMobile from "../assets/icons/searchmobile.png";
import textSearch from "../assets/icons/text.png";
import searchSp from "../assets/icons/searchSp.png";
import library from "../assets/icons/Library.png";
// import ChangePasswordModal from "./modals/ChangePasswordModal";
import ForgotPasswordModal from "./modals/ForgotPasswordModal";


export default function Sidebar({ isOpen, onClose, user }) {
  const sidebarRef = useRef(null);

  // ✅ state cho SP input
  const [searchValue, setSearchValue] = useState("");
  const [isFocus, setIsFocus] = useState(false);
  // `user` may be passed as a prop from MainLayout; fall back to localStorage if not
  const effectiveUser = user ?? (() => {
    try {
      const s = localStorage.getItem("user");
      return s ? JSON.parse(s) : { isLoggedIn: false };
    } catch (e) {
      return { isLoggedIn: false };
    }
  })();
  // const [openChangePassword, setOpenChangePassword] = useState(false);
  const [openForgotPassword, setOpenForgotPassword] = useState(false);
  const showPlaceholder = !isFocus && searchValue === "";

  return (
    <>
      {/* OVERLAY – chỉ mobile */}
      <div
        onClick={onClose}
        className={`
          fixed inset-0 bg-black/40 z-40
          md:hidden
          transition-opacity
          ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
      />

      {/* SIDEBAR */}
      <aside
        ref={sidebarRef}
        className={`
          fixed md:static top-0 left-0 z-50
          w-[350px] md:w-[260px]
          h-screen
          bg-white p-4
          overflow-y-auto scrollbar-custom
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
        `}
      >
        {/* ===== PC ONLY ===== */}
        <div className="hidden md:block mt-[0px] space-y-3">
          <img src={logo} alt="logo" className="w-10 h-10" />
          <div className="flex items-center md:mt-[50px] md:ml-[10px] gap-2 cursor-pointer hover:text-gray-400">
            <img src={write} className="w-6 h-6" />
            <span className="font-semibold leading-[35px]">新しい解析</span>
          </div>
          <div className="flex items-center md:ml-[10px] gap-2 cursor-pointer hover:text-gray-400">
            <img src={searchIcon} className="w-4 h-4" />
            <span className="font-semibold leading-[35px]">チャットを検索</span>
          </div>
        </div>

        {/* ===== SP ONLY ===== */}
        <div className="md:hidden mt-[6px]">
          <div className="flex justify-between items-center mb-[20px]">
            <div className="relative w-[270px]">
              <div className="p-[1px] rounded-[5px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onFocus={() => setIsFocus(true)}
                  onBlur={() => setIsFocus(false)}
                  className="w-full h-[40px] rounded-[5px] bg-white pl-[12px] pr-3 outline-none relative z-10"
                />
              </div>

              {showPlaceholder && (
                <div className="pointer-events-none absolute inset-0 flex items-center gap-[6px] px-[12px] text-gray-400 z-20">
                  <img src={searchSp} alt="searchSp" className="w-[16px] h-[16px]" />
                  <img src={textSearch} alt="textSearch" className="h-[14px]" />
                </div>
              )}
            </div>

            <img src={searchMobile} alt="searchMobile" className="w-[32px] h-[24.24px]" />
          </div>
            <div className="bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
              {/* INNER – nền trắng */}
              <div className="bg-white">
                <div className="flex items-center mb-[20px] mt-[2px]">
                  <img src={logo} alt="logo" className="w-10 h-10 ml-[7px]" />
                  <span className="ml-2 font-cabin font-semibold text-[24px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF] bg-clip-text text-transparent">
                    Liveboost AI
                  </span>
                </div>

                <div className="flex items-center">
                  <img src={library} alt="library" className="w-[29px] h-[22.53px] ml-[7px]" />
                  <span
                    className=" ml-[17px] font-cabin font-semibold text-[24px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF] bg-clip-text text-transparent">
                    ライブラリ
                  </span>
                </div>
              </div>
            </div>
        </div>
        {/* ===== COMMON ===== */}
        <div className="mt-[20px] space-y-3 text-left">
          <div className="md:ml-[10px]">
            <span className="block w-[104px] h-[35px] font-cabin font-semibold text-[16px] leading-[35px] text-[#9E9E9E]">
              解析履歴
            </span>
          </div>

          {effectiveUser?.isLoggedIn && (
            <div className="space-y-1 h-full reactive">
              <div className="cursor-pointer hover:text-gray-400">
                <span className="block font-cabin font-semibold text-[16px] leading-[45px] text-black">
                  動画abcの分析結果
                </span>
              </div>
              <div
                onClick={() => {
                  // close sidebar (mobile) and open Forgot Password modal
                  onClose?.();
                  setOpenForgotPassword(true);
                }}
                className="absolute bottom-[25px] ml-[7px] w-[223px] h-[45px] md:hidden rounded-[50px] border border-[#B5B5B5] opacity-100 flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.3)]"
              >
                <span className="font-cabin font-bold text-[18px] leading-[28px] text-center align-middle text-black">
                  {effectiveUser?.email}
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
        {/* Forgot password modal (opened from mobile email button) */}
        <ForgotPasswordModal open={openForgotPassword} onClose={() => setOpenForgotPassword(false)} />
    </>
  );
}
