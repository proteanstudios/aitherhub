import { useEffect, useState } from "react";
import MenuIcon from "../../assets/icons/menu.png";
import LoginModal from "../modals/LoginModal";
import RegisterModal from "../modals/RegisterModal";
import ForgotPasswordModal from "../modals/ForgotPasswordModal";

export default function Header({ onOpenSidebar, user: propUser, setUser: setPropUser }) {
  const [openLogin, setOpenLogin] = useState(false);
  const [openRegister, setOpenRegister] = useState(false);
  const [localUser, setLocalUser] = useState(null);

  // If parent doesn't provide user, load from localStorage into local state
  useEffect(() => {
    if (propUser) return;
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      setLocalUser(JSON.parse(storedUser));
    }
  }, [propUser]);

  const user = propUser ?? localUser;
  const setUser = setPropUser ?? setLocalUser;
  const [openForgotPassword, setOpenForgotPassword] = useState(false);

  return (
    <>
      <header className="h-[75px] px-[13px] py-[22px] md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-[16px]">
          <img
            src={MenuIcon}
            alt="Menu"
            onClick={onOpenSidebar}
            className="block md:hidden w-[19px] h-[16px]"
          />
          <span className="font-cabin font-semibold text-[20px]">
            Liveboost AI
          </span>
        </div>

        {/* RIGHT SIDE */}
        <div className={`flex items-center gap-[10px] justify-center w-[200px] h-[35px] rounded-[50px] ${user?.isLoggedIn && "bg-white" }`} >
          {user?.isLoggedIn ? (
            <span
              className="font-cabin text-[14px] text-black cursor-pointer"
              onClick={() => setOpenForgotPassword(true)}
            >
              {user.email}
            </span>
          ) : (
            // ❌ Chưa login → hiện button
            <>
              <button
                onClick={() => setOpenLogin(true)}
                className="bg-90 w-[90px] h-[35px] flex items-center justify-center bg-white text-[#4500FF] border border-[#4500FF]"
              >
                ログイン
              </button>
              <button
                onClick={() => setOpenRegister(true)}
                style={{ backgroundColor: "#4500FF" }}
                className="bg-90 w-[90px] h-[35px] flex items-center justify-center text-white"
              >
                新規登録
              </button>
            </>
          )}
        </div>
      </header>

      <LoginModal
        open={openLogin}
        onClose={() => {
          setOpenLogin(false);
          // cập nhật lại user sau login
          const storedUser = localStorage.getItem("user");
          if (storedUser) setUser(JSON.parse(storedUser));
        }}
      />

      <RegisterModal
        open={openRegister}
        onClose={() => {
          setOpenRegister(false);
          // cập nhật lại user sau register
          const storedUser = localStorage.getItem("user");
          if (storedUser) setUser(JSON.parse(storedUser));
        }}
      />

      <ForgotPasswordModal
        open={openForgotPassword}
        onClose={() => {
          setOpenForgotPassword(false);
          // refresh user state after password change/cancel
          const storedUser = localStorage.getItem("user");
          if (storedUser) setUser(JSON.parse(storedUser));
        }}
      />
    </>
  );
}
