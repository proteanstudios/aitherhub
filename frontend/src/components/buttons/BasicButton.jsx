import { useState } from "react";

export default function BasicButton({
  children,
  onClick,
  disabled = false,
  className = "",
  type = "button",
  variant = "primary", // "primary" or "secondary"
  width = "w-[90px]",
  height = "h-[35px]",
}) {
  const isPrimary = variant === "primary";
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
      style={{ touchAction: 'manipulation' }}
      className={`
        bg-90 ${width} ${height} 
        flex items-center justify-center 
        text-sm font-bold
        border border-[#4500FF]
        transition-all duration-300 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed
        focus:outline-none focus-visible:outline-none
        cursor-pointer
        ${
          isPrimary
            ? `bg-[#4500FF] hover:bg-white hover:text-[#4500FF] ${isActive ? "bg-white text-[#4500FF]" : "text-white"}`
            : `bg-white hover:bg-[#4500FF] hover:text-white ${isActive ? "bg-[#4500FF] text-white" : "text-[#4500FF]"}`
        }
        ${className}
      `}
    >
      {children}
    </button>
  );
}
