import React, { useState } from "react";
import { toast } from "react-toastify";
import AuthService from "../../base/services/userService";
import { PrimaryButton, SecondaryButton } from "../../components/buttons";
import { VALIDATION_MESSAGES, SUCCESS_MESSAGES, mapServerErrorToJapanese } from "../../constants/authConstants";

export default function Register({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checkbox, setCheckbox] = useState(false);
  const [errors, setErrors] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    checkbox: ""
  });
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

  const handleRegister = async (e) => {
    if (e) {
      e.preventDefault();
    }

    setErrors({ email: "", password: "", confirmPassword: "", checkbox: "" });

    if (!email || !password || !confirmPassword) {
      const newErrors = {};
      if (!email) newErrors.email = VALIDATION_MESSAGES.EMAIL_REQUIRED;
      if (!password) newErrors.password = VALIDATION_MESSAGES.PASSWORD_REQUIRED;
      if (!confirmPassword) newErrors.confirmPassword = VALIDATION_MESSAGES.CONFIRM_PASSWORD_REQUIRED;
      setErrors(newErrors);
      return;
    }

    if (!validateEmail(email)) {
      setErrors({ email: VALIDATION_MESSAGES.EMAIL_INVALID_FORMAT });
      return;
    }

    if (password !== confirmPassword) {
      setErrors({ confirmPassword: VALIDATION_MESSAGES.PASSWORDS_NOT_MATCH });
      return;
    }

    if (password.length < 8) {
      setErrors({ password: VALIDATION_MESSAGES.PASSWORD_MIN_LENGTH });
      return;
    }

    if (!checkbox) {
      setErrors({ checkbox: VALIDATION_MESSAGES.CHECKBOX_REQUIRED });
      return;
    }

    setIsLoading(true);
    try {
      await AuthService.register(email, password);

      const userInfo = await AuthService.getCurrentUser();

      const userData = {
        isLoggedIn: true,
        email: userInfo?.email || email,
      };
      localStorage.setItem("user", JSON.stringify(userData));

      toast.success(SUCCESS_MESSAGES.REGISTER_SUCCESS);
      if (onSuccess) onSuccess();
    } catch (err) {
      setIsLoading(false);

      const detail = err?.response?.data?.detail || err?.message || "";
      const errorMessage = mapServerErrorToJapanese(detail, 'register');

      setErrors({ email: errorMessage });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isLoading) {
      handleRegister();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center justify-center space-y-6">
      <h2 className=" pt-[20px] pb-[20px] font-cabin font-medium text-[25px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black">
        {window.__t('register')}
      </h2>

      <div className="w-full space-y-4 md:space-y-0 md:grid md:grid-cols-[180px_1fr] md:gap-x-6 md:gap-y-6 text-left md:w-[500px]">
        <label className="font-cabin font-bold text-[14px] text-black">
          <span className=""> {window.__t('emailAddress')} </span>
          <span className="hidden md:block text-[#646464] text-[12px] font-normal">
            {" "}
            {window.__t('passwordMinLength')}
          </span>
        </label>

        <div className="flex flex-col">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
          />
          {errors.email && (
            <span className="text-red-500 text-[12px] mt-1">
              {errors.email}
            </span>
          )}
        </div>

        <label className="font-cabin font-bold text-[14px] text-black">
          {window.__t('password')}
          <span className="block text-[#646464] text-[12px] font-normal">
            ※半角英字8文字以上
          </span>
        </label>
        <div className="flex flex-col">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
            className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
          />
          {errors.password && (
            <span className="text-red-500 text-[12px] mt-1">
              {errors.password}
            </span>
          )}
        </div>

        <label className="font-cabin font-bold text-[14px] text-black">
          {window.__t('reenterPassword')}
          <span className="block text-[#646464] text-[12px] font-normal">
            ※半角英字8文字以上
          </span>
        </label>
        <div className="flex flex-col">
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearError("confirmPassword");
            }}
            className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
          />
          {errors.confirmPassword && (
            <span className="text-red-500 text-[12px] mt-1">
              {errors.confirmPassword}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-start w-full space-y-3 md:w-[350px]">
        <div className="text-sm text-center text-gray-600">
          <span className="text-[#4500FF] underline cursor-pointer">
            {window.__t('termsOfService')}
          </span>{" "}
          {window.__t('and')}
          <span className="text-[#4500FF] underline cursor-pointer">
            {window.__t('privacyPolicy')}
          </span>{" "}
          {window.__t('pleaseConfirm')}
        </div>

        <div className="flex flex-col items-start">
          <label className="flex items-center justify-start gap-2 text-sm text-black cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checkbox}
              onChange={(e) => {
                setCheckbox(e.target.checked);
                clearError("checkbox");
              }}
              className="sr-only"
            />

            {/* Custom checkbox */}
            <span
              className={`
                w-[23px] h-[23px]
                rounded-[6px]
                border flex items-center justify-center
                transition-all duration-150 ease-out
                ${checkbox ? "bg-[#7D01FF] border-[#7D01FF]" : "bg-transparent border-[#8F9393]"}
                active:scale-[0.92]
              `}
            >
              {/* Check icon */}
              <svg
                viewBox="0 0 24 24"
                className={`
                  w-[20px] h-[20px]
                  text-white
                  transition-all duration-150 ease-out
                  ${checkbox ? "opacity-100 scale-100" : "opacity-0 scale-75"}
                `}
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>

            <span>{window.__t('agree')}</span>
          </label>
          {errors.checkbox && (
            <span className="text-red-500 text-[12px] mt-1">
              {errors.checkbox}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 w-full mt-[5px] align-center md:justify-center md:gap-[30px] md:mt-0">
        <PrimaryButton
          type="submit"
          onClick={handleRegister}
          disabled={isLoading}
          rounded="rounded-[5px]"
        >
          {isLoading ? window.__t('registering') : window.__t('registerButton')}
        </PrimaryButton>

        <SecondaryButton
          type="button"
          onClick={() => {
            if (onSuccess) onSuccess();
          }}
        >
          キャンセル
        </SecondaryButton>
      </div>
    </form>
  );
}
