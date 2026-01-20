import { useState } from "react";
import AddIcon from "../assets/icons/add.png";
import SendIcon from "../assets/icons/send.png";

export default function ChatInput({ className = "", onSend }) {
  const [message, setMessage] = useState("");

  const handleSend = () => {
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
      handleSend();
    }
  };

  return (
    <div className={`flex items-center ${className}`}>
      <img src={AddIcon} alt="Add" className=" md:hidden w-[50px] h-[50px] cursor-pointer" />
      <div className="relative ml-[14px] flex-1">
          <img
          src={AddIcon}
          alt="Send"
          onClick={handleSend}
          className="hidden md:block absolute top-1/2 -translate-y-1/2 w-[40px] h-[40px] cursor-pointer hover:opacity-80 transition-opacity right-[10px] md:right-auto md:left-[10px]"
        />
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="質問をしてみましょう"
          className="text-[18px] leading-[40px] text-black w-full h-[50px] pl-[16px] md:pl-[60px] pr-[50px] rounded-[25px] border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <img
          src={SendIcon}
          alt="Send"
          onClick={handleSend}
          className="absolute right-[7px] top-1/2 -translate-y-1/2 w-[40px] h-[40px] cursor-pointer hover:opacity-80 transition-opacity"
        />
      </div>
    </div>
  );
}

