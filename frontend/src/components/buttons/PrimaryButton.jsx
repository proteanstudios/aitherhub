import { useState } from "react";

export default function PrimaryButton({
    children,
    onClick,
    disabled = false,
    className = "",
    type = "button",
    rounded = "rounded-[55px]",
    width = "w-[250px]",
    height = "h-[50px]",
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
        style={{ touchAction: 'manipulation' }}
        className={`
          group relative ${width} ${height} max-w-full
          ${rounded}
          font-cabin font-semibold text-[20px] leading-[16px]
          flex items-center justify-center
          border-2 border-[#4500FF]
          overflow-hidden
          transition-all duration-300 ease-out
          hover:text-[#4500FF]
          active:scale-[0.97]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
          focus:outline-none focus-visible:outline-none
          cursor-pointer
          ${isActive ? "text-[#4500FF]" : "text-white"}
          ${className}
        `}
      >
        {/* Gradient background */}
        <span
          className={`
            absolute inset-0
            bg-gradient-to-b from-[#4500FF] to-[#9B00FF]
            transition-opacity duration-300 ease-out
            group-hover:opacity-0
            ${disabled ? "opacity-50" : ""}
            ${isActive ? "opacity-0" : ""}
          `}
        />
  
        {/* Content */}
        <span className="relative z-10 pointer-events-none">
          {children}
        </span>
      </button>
    );
  }
  