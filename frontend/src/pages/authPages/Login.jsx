import React, { useState } from "react";
import { toast } from "../../hooks/use-toast";
import AuthService from "../../base/services/userService";
import { Button } from "../../components/ui/Button";
import { VALIDATION_MESSAGES, SUCCESS_MESSAGES, mapServerErrorToJapanese } from "../../constants/authConstants";

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
    // Regex handles: no whitespace, no multiple @, no period immediately after @
    const emailRegex = /^[^\s@]+@[^.]+(\.[^\s@]+)+$/;
    return emailRegex.test(email);
  };

  const handleLogin = async (e) => {
    if (e) {
      e.preventDefault();
    }

    setErrors({ email: "", password: "" });


    if (!email || !password) {
      const newErrors = {};
      if (!email) newErrors.email = VALIDATION_MESSAGES.EMAIL_REQUIRED;
      if (!password) newErrors.password = VALIDATION_MESSAGES.PASSWORD_REQUIRED;
      setErrors(newErrors);
      return;
    }


    if (!validateEmail(email)) {
      setErrors({ email: VALIDATION_MESSAGES.EMAIL_INVALID_FORMAT });
      return;
    }

    setIsLoading(true);
    try {
      await AuthService.login(email, password);

      const userInfo = await AuthService.getCurrentUser();

      const me = userInfo?.data || {};

      const userData = {
        isLoggedIn: true,
        id: me.id,
        email: me.email || email,
        name: me.name,
        role: me.role,
      };
      localStorage.setItem("user", JSON.stringify(userData));

      toast.success(SUCCESS_MESSAGES.LOGIN_SUCCESS);
      if (onSuccess) onSuccess();
    } catch (err) {
      setIsLoading(false);

      // Handle error detail - it can be a string or an array from FastAPI
      let detail = err?.response?.data?.detail || err?.message || "";

      // If detail is an array (FastAPI validation error), extract the message
      if (Array.isArray(detail) && detail.length > 0) {
        detail = detail[0]?.msg || detail[0]?.message || JSON.stringify(detail);
      }

      // Check if it's an email validation error and show it inline
      const lowerDetail = detail.toLowerCase();
      if (lowerDetail.includes("email") && (lowerDetail.includes("not valid") || lowerDetail.includes("invalid") || lowerDetail.includes("invalid"))) {
        setErrors({ email: VALIDATION_MESSAGES.EMAIL_INVALID_FORMAT });
        toast.error(VALIDATION_MESSAGES.EMAIL_INVALID_FORMAT);
        return;
      }

      const errorMessage = mapServerErrorToJapanese(detail, 'login');
      toast.error(errorMessage);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isLoading) {
      handleLogin();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center justify-center space-y-6">
      <h2 className="pt-[25px] pb-[20px] font-cabin font-medium text-[30px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black md:pt-[50px] md:text-[40px] md:leading-[30px] md:h-[30px]">
        {window.__t('login')}
      </h2>

      <div className="flex flex-col max-w-full top-[126px] items-start space-y-1 w-full h-[250px] md:w-[400px]">
        <div className="flex flex-col items-start w-full mb-[20px]">
          <label className="font-cabin font-bold text-[14px] text-black mb-[7px]">
            {window.__t('emailAddress')}
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
            {window.__t('password')}
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
                {window.__t('resetPassword')}
              </a>
            </span>
          </div>

          <div className="text-[9px] text-center text-gray-600">
            {window.__t('firstTimeUser')}
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
                {window.__t('registerHere')}
              </a>
            </span>
          </div>
        </div>
      </div>

      {/* <PrimaryButton
        type="submit"
        onClick={handleLogin}
        disabled={isLoading}
        className="mb-[25px] md:mb-[50px]"
      >
        {isLoading ? window.__t('loggingIn') : window.__t('login')}
      </PrimaryButton> */}
      <Button className="min-w-[125px]" onClick={handleLogin}
        disabled={isLoading}>{isLoading ? window.__t('loggingIn') : window.__t('login')}</Button>
    </form>
  );
}
