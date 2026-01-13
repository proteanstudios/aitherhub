import ChatInput from "../ChatInput";

export default function Footer() {
  return (
    <footer className="relative h-12">
      <div className="w-full max-w-[1024px] mx-auto px-6 text-center">
        <div className="hidden md:inline text-[14px] leading-[35px] font-semibold font-cabin">
          動画をアップロードすることにより、Liveboost AIの利用規約とガイドラインに同意したものとみなされます。
        </div>

        <div className="md:hidden absolute left-[14px] right-[14px] bottom-[32px]">
          <ChatInput />
        </div>
      </div>
    </footer>
  );
}
