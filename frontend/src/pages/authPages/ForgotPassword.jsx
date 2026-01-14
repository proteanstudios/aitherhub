import React, { useState } from "react";
import { toast } from 'react-toastify';
import AuthService from '../../base/services/userService';

export default function ForgotPassword({ onSuccess }) {
    const [email, setEmail] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    
    const handleForgotPassword = async () => {
        // Validation
        if (!currentPassword || !password || !confirmPassword) {
            toast.error("Please fill in all required fields");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("New password and confirm password do not match");
            return;
        }

        if (password.length < 8) {
            toast.error("Password must be at least 8 characters long");
            return;
        }

        setIsLoading(true);
        try {
            await AuthService.changePassword(currentPassword, password, confirmPassword);
            toast.success("Password changed successfully");
            if (onSuccess) onSuccess();
        } catch (err) {
            const detail = err?.response?.data?.detail || err?.message || 'Failed to change password';
            toast.error(detail);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center space-y-6">
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
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />
                
                {/* ===== CURRENT PASSWORD ===== */}
                <label className="hidden md:block font-cabin font-bold text-[14px] text-black">
                    <span className="hidden md:block">現在のパスワード</span>
                    <span className="block text-[#646464] text-[12px] font-normal">
                        ※半角英字8文字以上
                    </span>
                </label>
                <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="hidden md:block w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />

                {/* ===== NEW PASSWORD ===== */}
                <label className="font-cabin font-bold text-[14px] text-black">
                    <span className="md:hidden">パスワード</span>
                    <span className="hidden md:block">新しいパスワード</span>
                    <span className="block text-[#646464] text-[12px] font-normal">
                        ※半角英字8文字以上
                    </span>
                </label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />

                {/* ===== CONFIRM PASSWORD ===== */}
                <label className="font-cabin font-bold text-[14px] text-black">
                    <span className="md:hidden">パスワードを再入力</span>
                    <span className="hidden md:block">新しいパスワードを再入力</span>
                    <span className="block text-[#646464] text-[12px] font-normal">
                        ※半角英字8文字以上
                    </span>
                </label>
                <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-[40px] border border-[#595757] rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />
            </div>

            {/* ===== BUTTONS ===== */}
            <div className="flex flex-col md:flex-row items-center gap-4 w-full mt-6 align-center md:justify-center md:gap-[30px] md:mt-0">
                <button
                    onClick={handleForgotPassword}
                    disabled={isLoading}
                    className="w-[250px] md:w-[230px] h-[50px] rounded-[5px] text-[20px] leading-[16px] text-white flex items-center justify-center bg-gradient-to-b from-[#4500FF] to-[#9B00FF] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span className="font-cabin font-semibold text-[20px] text-white">
                    {isLoading ? "処理中..." : "変更する"}
                    </span>
                </button>

                <button
                    onClick={() => { if (onSuccess) onSuccess(); }}
                    style={{
                        padding: "2px",
                        borderRadius: "5px",
                        background: "linear-gradient(to bottom, #4500FF, #9B00FF)",
                    }}
                >
                    <span className="flex w-[246px] md:w-[230px] h-[44px] items-center justify-center rounded-[0px] bg-white group-hover:bg-transparent transition">
                        <span className="font-cabin font-semibold text-[20px] bg-gradient-to-b from-[#4500FF] to-[#9B00FF] bg-clip-text text-transparent group-hover:text-white">
                            キャンセル
                        </span>
                    </span>
                </button>
            </div>
        </div>
    );
}
