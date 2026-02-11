import { useState } from "react";
import AddIcon from "../assets/icons/add.png";
import SendIcon from "../assets/icons/send.png";

export default function ChatInput({ className = "", onSend, disabled = false }) {
  const [message, setMessage] = useState("");

  const handleSend = () => {
    if (disabled) return;
    const text = message.trim();
    if (text) {
      try {
        try {
          if (typeof onSend === "function") {
            onSend(text);
          } else {
            try {
              window.dispatchEvent(new CustomEvent("videoInput:submitted", { detail: { text } }));
            } catch (evErr) {
              console.error("ChatInput: failed to dispatch global event", evErr);
            }
          }
        } catch (innerErr) {
          console.error("ChatInput: onSend threw", innerErr);
          throw innerErr;
        }
      } catch (err) {}
      setMessage("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!disabled) handleSend();
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img src={AddIcon} alt="Add" className=" md:hidden w-[50px] h-[50px] cursor-pointer" />
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        placeholder={window.__t('askQuestionPlaceholder')}
        className="text-[18px] leading-[40px] text-white/90 flex-1 h-[50px] pl-[16px] md:pl-[20px] rounded-[12px] border border-white/20 bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
      />
      <button
        type="button"
        onClick={() => { if (!disabled) handleSend(); }}
        disabled={disabled}
        className={`flex items-center justify-center w-[50px] h-[50px] rounded-[12px] flex-shrink-0 transition-all ${disabled ? 'opacity-40 cursor-not-allowed bg-white/40' : 'cursor-pointer bg-white hover:bg-white/90'}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-6 h-6 ${disabled ? 'text-white/40' : 'text-black'}`}
        >
          <path d="M22 2L11 13"></path>
          <path d="M22 2l-7 20-5-9-9-5 20-7z"></path>
        </svg>
      </button>
    </div>
  );
}

