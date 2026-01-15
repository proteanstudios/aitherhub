import React, { useState } from "react";
import { toast } from 'react-toastify';
import AuthService from '../../base/services/userService';
import { PrimaryButton, SecondaryButton } from '../../components/buttons';
import { VALIDATION_MESSAGES, SUCCESS_MESSAGES, mapServerErrorToJapanese } from '../../constants/authConstants';

export default function ForgotPassword({ onSuccess }) {
    const [email, setEmail] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState({ 
        email: "", 
        currentPassword: "", 
        password: "", 
        confirmPassword: "" 
    });

    const clearError = (field) => {
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: "" }));
        }
    };

    const validateEmail = (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };
    
    const handleForgotPassword = async (e) => {
        if (e) {
            e.preventDefault();
        }
        // Reset errors
        setErrors({ email: "", currentPassword: "", password: "", confirmPassword: "" });

        // Validation
        if (!email || !currentPassword || !password || !confirmPassword) {
            const newErrors = {};
            if (!email) newErrors.email = VALIDATION_MESSAGES.EMAIL_REQUIRED;
            if (!currentPassword) newErrors.currentPassword = VALIDATION_MESSAGES.CURRENT_PASSWORD_REQUIRED;
            if (!password) newErrors.password = VALIDATION_MESSAGES.NEW_PASSWORD_REQUIRED;
            if (!confirmPassword) newErrors.confirmPassword = VALIDATION_MESSAGES.NEW_CONFIRM_PASSWORD_REQUIRED;
            setErrors(newErrors);
            return;
        }

        // Validate email format
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

        setIsLoading(true);
        try {
            await AuthService.changePassword(currentPassword, password, confirmPassword);
            toast.success(SUCCESS_MESSAGES.PASSWORD_CHANGE_SUCCESS);
            if (onSuccess) onSuccess();
            // Button stays disabled on success (modal will close or redirect)
        } catch (err) {
            // Only enable button again on failure
            setIsLoading(false);
            
            const detail = err?.response?.data?.detail || err?.message || "";
            const errorMessage = mapServerErrorToJapanese(detail, 'changePassword');

            setErrors({ currentPassword: errorMessage });
            toast.error(errorMessage);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!isLoading) {
            handleForgotPassword();
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col items-center justify-center space-y-6">
            <h2 className="hidden md:block pt-[50px] pb-[20px] font-cabin font-medium text-[25px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black">
                パスワードを変更
            </h2>

            <div className="w-full space-y-4 md:space-y-0 md:grid md:grid-cols-[180px_1fr] md:gap-x-6 md:gap-y-6 text-left md:w-[500px]">
                {/* ===== EMAIL ===== */}
                <label className="font-cabin font-bold text-[14px] text-black">
                    <span className="md:hidden">メールアドレス</span>
                    <span className="hidden md:block">アカウントID</span>
                    <span className="hidden md:block text-[#646464] text-[12px] font-normal">
                        ※半角英字8文字以上
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
                
                {/* ===== CURRENT PASSWORD ===== */}
                <label className="hidden md:block font-cabin font-bold text-[14px] text-black">
                    <span className="hidden md:block">現在のパスワード</span>
                    <span className="block text-[#646464] text-[12px] font-normal">
                        ※半角英字8文字以上
                    </span>
                </label>
                <div className="flex flex-col">
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => {
                            setCurrentPassword(e.target.value);
                            clearError("currentPassword");
                        }}
                        className="hidden md:block w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                    />
                    {errors.currentPassword && (
                        <span className="hidden md:block text-red-500 text-[12px] mt-1">
                            {errors.currentPassword}
                        </span>
                    )}
                </div>

                {/* ===== NEW PASSWORD ===== */}
                <label className="font-cabin font-bold text-[14px] text-black">
                    <span className="md:hidden">パスワード</span>
                    <span className="hidden md:block">新しいパスワード</span>
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

                {/* ===== CONFIRM PASSWORD ===== */}
                <label className="font-cabin font-bold text-[14px] text-black">
                    <span className="md:hidden">パスワードを再入力</span>
                    <span className="hidden md:block">新しいパスワードを再入力</span>
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

            {/* ===== BUTTONS ===== */}
            <div className="flex flex-col md:flex-row items-center gap-4 w-full mt-6 align-center md:justify-center md:gap-[30px] md:mt-0">
                <PrimaryButton
                    type="submit"
                    onClick={handleForgotPassword}
                    disabled={isLoading}
                    rounded="rounded-[5px]"
                    width="w-[250px] md:w-[230px]"
                >
                    {isLoading ? "処理中..." : "変更する"}
                </PrimaryButton>

                <SecondaryButton
                    type="button"
                    onClick={() => { if (onSuccess) onSuccess(); }}
                >
                    キャンセル
                </SecondaryButton>
            </div>
        </form>
    );
}
