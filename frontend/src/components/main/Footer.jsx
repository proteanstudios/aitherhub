import AddIcon from "../../assets/icons/add.png";
import SendIcon from "../../assets/icons/send.png";
export default function Footer() {
  return (
    <footer className="relative h-12">
      <div className="w-full max-w-[1024px] mx-auto px-6 text-center">
        <div className="hidden md:inline text-[14px] leading-[35px] font-semibold font-cabin">
          動画をアップロードすることにより、Liveboost AIの利用規約とガイドラインに同意したものとみなされます。
        </div>

        <div className="md:hidden absolute left-[14px] right-[14px] bottom-[32px] flex items-center">
          <img src={AddIcon} alt="Add" className="w-[50px] h-[50px]" />
          <div className="relative ml-[14px] flex-1">
            <input type="text" placeholder="質問をしてみましょう" className="w-full h-[50px] pl-[16px] pr-[50px] rounded-[25px] border border-gray-300 bg-white focus:outline-none" />
            <img src={SendIcon} alt="Send" className="absolute right-[10px] top-1/2 -translate-y-1/2 w-[40px] h-[40px]" />
          </div>
        </div>
      </div>
    </footer>
  );
}
