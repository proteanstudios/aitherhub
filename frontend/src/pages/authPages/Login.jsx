import React, { useState } from "react";
import { toast } from "react-toastify";
import AuthService from "../../base/services/userService";
import { PrimaryButton } from "../../components/buttons";

export default function Login({ onSuccess, onSwitchToRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({ email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);

  const clearError = (field) => {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleLogin = async () => {
    // Reset errors
    setErrors({ email: "", password: "" });

    // Validate
    if (!email || !password) {
      const newErrors = {};
      if (!email) newErrors.email = "メールアドレスを入力してください";
      if (!password) newErrors.password = "パスワードを入力してください";
      setErrors(newErrors);
      return;
    }

    // Validate email format
    if (!validateEmail(email)) {
      setErrors({ email: "メールアドレスの形式が正しくありません" });
      return;
    }

    setIsLoading(true);
    try {
      // Login and get JWT tokens (tokens are automatically stored by AuthService)
      await AuthService.login(email, password);

      // Get user info from /auth/me
      const userInfo = await AuthService.getCurrentUser();

      // userInfo shape: { success: true, data: { id, email, ... } }
      const me = userInfo?.data || {};

      // Store user info in localStorage so FE can read id/email immediately
      const userData = {
        isLoggedIn: true,
        id: me.id,
        email: me.email || email,
        name: me.name,
        role: me.role,
      };
      localStorage.setItem("user", JSON.stringify(userData));

      toast.success("ログインに成功しました");
      if (onSuccess) onSuccess();
      // Button stays disabled on success (modal will close or redirect)
    } catch (err) {
      // Only enable button again on failure
      setIsLoading(false);
      
      const detail =
        err?.response?.data?.detail || err?.message || "ログインに失敗しました";
      
      // Try to map common error messages to Japanese
      let errorMessage = detail;
      if (detail.toLowerCase().includes("invalid") || detail.toLowerCase().includes("incorrect")) {
        errorMessage = "メールアドレスまたはパスワードが正しくありません";
      } else if (detail.toLowerCase().includes("not found") || detail.toLowerCase().includes("user")) {
        errorMessage = "ユーザーが見つかりません";
      } else if (detail.toLowerCase().includes("unauthorized")) {
        errorMessage = "認証に失敗しました";
      }

      setErrors({ password: errorMessage });
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6">
      <h2 className="pt-[50px] pb-[20px] font-cabin font-medium text-[30px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black md:text-[40px] md:leading-[30px] md:h-[30px]">
        ログイン
      </h2>

      <div className="flex flex-col max-w-full top-[126px] items-start space-y-1 w-[340px] h-[250px] md:w-[400px]">
        <div className="flex flex-col items-start w-full mb-[20px]">
          <label className="font-cabin font-bold text-[14px] text-black mb-[7px]">
            メールアドレス
          </label>
          <input
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            className="w-full h-[40px] border border-black/20 rounded-[55px] px-4 outline-none focus:border-[#4500FF] opacity-100 text-black md:w-[400px] md:h-[40px] md:rounded-[55px] md:border md:opacity-100"
          />
          {errors.email && (
            <span className="text-red-500 text-[12px] mt-1 ml-2">
              {errors.email}
            </span>
          )}
        </div>

        <div className="flex flex-col items-start w-full mb-[30px]">
          <label className="font-cabin font-bold text-[14px] text-black mb-[7px]">
            パスワード
          </label>
          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
            className="w-full h-[40px] border border-black/20 rounded-[55px] px-4 outline-none focus:border-[#4500FF] opacity-100 text-black md:w-[400px] md:h-[40px] md:rounded-[55px] md:border md:opacity-100"
          />
          {errors.password && (
            <span className="text-red-500 text-[12px] mt-1 ml-2">
              {errors.password}
            </span>
          )}
        </div>

        <div className="flex flex-col items-start w-full mb-[30px]">
          <div className="text-[9px] text-center text-gray-600 mb-[10px] md:mb-[15px]">
            <span className="">
              <a
                href="http://"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#000", textDecoration: "underline" }}
              >
                パスワードを再設定する
              </a>
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
                style={{
                  color: "#000",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                新規登録はこちら
              </a>
            </span>
          </div>
        </div>
      </div>

      <PrimaryButton 
        onClick={handleLogin} 
        disabled={isLoading}
        className="mb-[50px]"
      >
        {isLoading ? "ログイン中..." : "ログイン"}
      </PrimaryButton>
    </div>
  );
}
