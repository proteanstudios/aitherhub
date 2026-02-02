import { useState } from "react";

export default function SecondaryButton({
  children,
  onClick,
  disabled = false,
  className = "",
  type = "button",
  rounded = "rounded-[5px]",
  width = "w-[246px] md:w-[230px]",
  height = "h-[44px]",
}) {
  const [isActive, setIsActive] = useState(false);

  const handleTouchStart = (e) => {
    if (disabled) return;
    setIsActive(true);
  };

  const handleTouchEnd = (e) => {
    setIsActive(false);
  };

  const handleMouseDown = () => {
    if (disabled) return;
    setIsActive(true);
  };

  const handleMouseUp = () => {
    setIsActive(false);
  };

  const handleMouseLeave = () => {
    setIsActive(false);
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{
        padding: "2px",
        background: "linear-gradient(to bottom, #4500FF, #9B00FF)",
        touchAction: 'manipulation'
      }}
      className={`
        group relative
        overflow-hidden
        transition-all duration-300 ease-out
        active:scale-[0.97]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        focus:outline-none focus-visible:outline-none
        cursor-pointer
        ${rounded}
        ${className}
      `}
    >
      <span
        className={`
          flex ${width} ${height} items-center justify-center 
          rounded-[0px] 
          transition-all duration-300 ease-out
          ${isActive ? "bg-transparent" : "bg-white"}
          group-hover:bg-transparent
        `}
      >
        <span className={`font-cabin font-semibold text-[20px] bg-[linear-gradient(180deg,rgba(69,0,255,1),rgba(155,0,255,1))] bg-clip-text text-transparent group-hover:text-white text-black duration-300 ease-out ${isActive ? "text-white" : ""}`}>
          {children}
        </span>
      </span>
    </button>
  );
}
