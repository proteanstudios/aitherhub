import ChatInput from "../ChatInput";

export default function Footer({ showChatInput = false }) {
  return (
    <footer className="">
      <div className="w-full p-[14px] max-w-[1024px] mx-auto md:px-6 text-center">
        <div className="hidden md:inline text-white/50 text-xs font-cabin">
          動画をアップロードすることにより、Aitherhubの利用規約とガイドラインに同意したものとみなされます。
        </div>

        {showChatInput && (
          <div className="w-full md:hidden pb-[32px] pt-[10px]">
            <ChatInput />
          </div>
        )}
      </div>
    </footer>
  );
}
