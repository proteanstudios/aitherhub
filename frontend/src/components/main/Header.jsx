import { useEffect, useRef, useState } from "react";
import MenuIcon from "../../assets/icons/menu.png";
import MyAccount from "../../assets/icons/user-profile-icon-df.png";
import PasswordIcon from "../../assets/icons/password-icon.svg";
import Signout from "../../assets/icons/signout-icon-df.png";
import LoginModal from "../modals/LoginModal";
import RegisterModal from "../modals/RegisterModal";
import ForgotPasswordModal from "../modals/ForgotPasswordModal";
import AuthService from "../../base/services/userService";
import { BasicButton } from "../buttons";

export default function Header({
  onOpenSidebar,
  user: propUser,
  setUser: setPropUser,
}) {
  const [openLogin, setOpenLogin] = useState(false);
  const [openRegister, setOpenRegister] = useState(false);
  const [localUser, setLocalUser] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (propUser) return;
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      setLocalUser(JSON.parse(storedUser));
    }
  }, [propUser]);

  // Check URL query parameter to auto-open login modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('showLogin') === 'true') {
      setOpenLogin(true);
      // Remove query parameter from URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Listen for custom event to open login modal
  useEffect(() => {
    const handleOpenLoginModal = () => {
      // First, ensure user state is updated to reflect logout
      // Clear user from localStorage (already done by AuthService.logout)
      // Update local user state
      setLocalUser({ isLoggedIn: false });
      if (setPropUser) {
        setPropUser({ isLoggedIn: false });
      }
      // Then open login modal
      setOpenLogin(true);
    };
    window.addEventListener('openLoginModal', handleOpenLoginModal);
    return () => {
      window.removeEventListener('openLoginModal', handleOpenLoginModal);
    };
  }, [setPropUser]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const user = propUser ?? localUser;
  const setUser = setPropUser ?? setLocalUser;
  const [openForgotPassword, setOpenForgotPassword] = useState(false);

  return (
    <>
      <header className="h-[75px] px-[13px] py-[22px] md:px-5 flex items-center justify-between">
        <div className="flex items-center gap-[16px]">
          <img
            src={MenuIcon}
            alt="Menu"
            onClick={onOpenSidebar}
            className="block md:hidden w-[19px] h-[16px]"
          />
          <span className="text-xl font-semibold text-white">
            Liveboost AI
          </span>
        </div>

        {/* RIGHT SIDE */}
        <div
          className={`flex items-center gap-[10px] justify-center h-[35px] rounded-[50px] ${
            user?.isLoggedIn && "bg-white"
          }`}
        >
          {user?.isLoggedIn ? (
            <div className="relative px-2" ref={dropdownRef}>
              <span
                className="font-cabin text-[14px] text-black cursor-pointer select-none max-w-[160px] truncate inline-block align-middle"
                onClick={() => setOpenDropdown(!openDropdown)}
              >
                {user.email}
              </span>

              {openDropdown && (
                <div className="absolute right-0 top-[40px] w-[196px] bg-white border rounded-md shadow-md z-50">
                  <ul className="flex flex-col text-[16px] text-black">
                    <li className="text-sm text-gray-700 px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center gap-2">
                      <img
                        src={MyAccount}
                        alt="My Account"
                        className="w-[16px] h-[16px]"
                      />
{window.__t('myAccount')}
                    </li>

                    <li
                      className="text-sm text-gray-700 px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center gap-2"
                      onClick={() => {
                        setOpenDropdown(false);
                        setOpenForgotPassword(true);
                      }}
                    >
                      <img
                        src={PasswordIcon}
                        alt="Password"
                        className="w-[16px] h-[16px]"
                      />
{window.__t('changePassword')}
                    </li>

                    <li
                      className="text-sm px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center gap-2 text-red-500"
                      onClick={() => {
                        setOpenDropdown(false);
                        AuthService.logout();
                        setUser({ isLoggedIn: false });
                        window.location.reload();
                      }}
                    >
                      <img
                        src={Signout}
                        alt="Signout"
                        className="w-[16px] h-[16px]"
                      />
{window.__t('logout')}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              <BasicButton
                onClick={() => setOpenLogin(true)}
                variant="secondary"
              >
{window.__t('login')}
              </BasicButton>
              <BasicButton
                onClick={() => setOpenRegister(true)}
                variant="primary"
              >
{window.__t('register')}
              </BasicButton>
            </>
          )}
        </div>
      </header>

      <LoginModal
        open={openLogin}
        onClose={() => {
          setOpenLogin(false);
          const storedUser = localStorage.getItem("user");
          if (storedUser) setUser(JSON.parse(storedUser));
        }}
        onSwitchToRegister={() => {
          setOpenLogin(false);
          setOpenRegister(true);
        }}
      />

      <RegisterModal
        open={openRegister}
        onClose={() => {
          setOpenRegister(false);
          const storedUser = localStorage.getItem("user");
          if (storedUser) setUser(JSON.parse(storedUser));
        }}
        onSwitchToLogin={() => {
          setOpenRegister(false);
          setOpenLogin(true);
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
