import React, { useState } from "react";

export default function Register({ onSuccess }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [checkbox, setCheckbox] = useState(false);
    
    const handleRegister = () => {
        if (!email || !password || !confirmPassword) {
            alert("Vui lòng nhập đầy đủ thông tin");
            return;
        }

        if (password !== confirmPassword) {
            alert("Mật khẩu không khớp");
            return;
        }

        if (!checkbox) {
            alert("Vui lòng đồng ý điều khoản");
            return;
        }

        // FE mock: lưu user
        localStorage.setItem(
            "user",
            JSON.stringify({
            email,
            password,
            isLoggedIn: true,
            })
        );

        // Đóng modal đăng ký
        if (onSuccess) onSuccess();
        };

    return (
        <div className="flex flex-col items-center justify-center space-y-6">
            <h2 className=" pt-[20px] pb-[20px] font-cabin font-medium text-[25px] leading-[30px] h-[30px] text-center flex items-center justify-center text-black">
                新規登録
            </h2>

            <div className="w-full space-y-4 md:space-y-0 md:grid md:grid-cols-[180px_1fr] md:gap-x-6 md:gap-y-6 text-left md:w-[500px]">
                <label className="font-cabin font-bold text-[14px] text-black">
                <span className=""> メールアドレス </span>
                <span className="hidden md:block text-[#646464] text-[12px] font-normal"> ※半角英字8文字以上 </span>
                </label>
                
                <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-[40px] border #595757 rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />

                <label className="font-cabin font-bold text-[14px] text-black">
                パスワード
                <span className="block text-[#646464] text-[12px] font-normal">
                    ※半角英字8文字以上
                </span>
                </label>
                <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-[40px] border #595757 rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />

                <label className="font-cabin font-bold text-[14px] text-black">
                パスワードを再入力
                <span className="block text-[#646464] text-[12px] font-normal">
                    ※半角英字8文字以上
                </span>
                </label>
                <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-[40px] border #595757 rounded-[5px] px-4 outline-none focus:border-[#4500FF] text-black"
                />
            </div>

            <div className="flex flex-col items-start w-full space-y-3 md:w-[340px]">
                <div className="text-sm text-center text-gray-600">
                    <span className="text-[#4500FF] underline cursor-pointer">
                        利用規約
                    </span>{" "}
                    と<span className="text-[#4500FF] underline cursor-pointer">
                        プライバシーポリシー
                    </span>{" "}
                    をご確認ください。
                </div>

                <div className="text-sm md:ml-[10px] text-center text-gray-600">
                    <label className="flex items-center justify-center gap-2 text-sm text-black">
                        <input
                            type="checkbox"
                            checked={checkbox}
                            onChange={(e) => setCheckbox(e.target.checked)}
                            className="w-[20px] h-[20px]"
                        />
                        同意します
                    </label>
                </div>
                
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 w-full mt-[5px] align-center md:justify-center md:gap-[30px] md:mt-0">
                <button onClick={handleRegister}
                className="w-[250px] h-[50px] rounded-[5px] font-cabin font-semibold text-[20px] leading-[16px] text-white flex items-center justify-center bg-gradient-to-b from-[#4500FF] to-[#9B00FF]">
                    登録する
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
