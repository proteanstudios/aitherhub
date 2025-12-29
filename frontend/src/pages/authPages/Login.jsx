import React, { useState } from "react";
import { toast } from 'react-toastify';
import AuthService from '../../base/services/userService';

export default function Login({ onSuccess, onSwitchToRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error("Please fill in all required fields");
      return;
    }

    try {
      // Login and get JWT tokens (tokens are automatically stored by AuthService)
      await AuthService.login(email, password);
      
      // Get user info from JWT token
      const userInfo = await AuthService.getCurrentUser();

      // Store minimal user info in localStorage for quick display
      // Full user info can be retrieved from JWT token via /me endpoint
      const userData = {
        isLoggedIn: true,
        email: userInfo?.email || email,
      };
      localStorage.setItem("user", JSON.stringify(userData));

      toast.success("Login successful");
      if (onSuccess) onSuccess();
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Login failed';
      toast.error(detail);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6">
        <h2 className="pt-[50px] pb-[20px] font-cabin font-medium text-[30px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black md:text-[40px] md:leading-[30px] md:h-[30px]">
          ログイン
        </h2>

        <div className="flex flex-col top-[126px] items-start space-y-1 w-[340px] h-[250px] md:w-[400px]">
            <div className="flex flex-col items-start w-full mb-[20px]">
              <label className="font-cabin font-bold text-[14px] text-black mb-[7px]">
                  メールアドレス
              </label>
              <input
                  type="email"
                  placeholder="メールアドレス"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[40px] border border-black/20 rounded-[55px] px-4 outline-none focus:border-[#4500FF] opacity-100 text-black md:w-[400px] md:h-[40px] md:rounded-[55px] md:border md:opacity-100"
              />
          </div>

          <div className="flex flex-col items-start w-full mb-[30px]">
              <label className="font-cabin font-bold text-[14px] text-black mb-[7px]">
                  パスワード
              </label>
              <input
                  type="password"
                  placeholder="パスワード"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[40px] border border-black/20 rounded-[55px] px-4 outline-none focus:border-[#4500FF] opacity-100 text-black md:w-[400px] md:h-[40px] md:rounded-[55px] md:border md:opacity-100"
                  />
          </div>

          <div className="flex flex-col items-start w-full mb-[30px]">
            <div className="text-[9px] text-center text-gray-600 mb-[10px] md:mb-[15px]">
              <span className="">
                <a href="http://" target="_blank" rel="noopener noreferrer" style={{ color: "#000", textDecoration: "underline" }}>パスワードを再設定する</a>
              </span>
            </div>

            <div className="text-[9px] text-center text-gray-600">
                初めてご利用ですか?{" "}
                <span className="">
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      if (onSwitchToRegister) onSwitchToRegister();
                    }}
                    style={{ color: "#000", textDecoration: "underline", cursor: "pointer" }}
                  > 
                    新規登録はこちら 
                  </a>
                </span>
            </div>
          </div>
        </div>

        <button 
          onClick={handleLogin}
          style={{ fontSize: "20px" }}
          className="mb-[50px] bg-90 w-[250px] h-[50px] rounded-[55px] font-cabin font-semibold leading-[16px] text-white opacity-100 flex items-center justify-center bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
          ログイン
        </button>
    </div>
  );
}
