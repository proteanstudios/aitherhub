import { Header, Body, Footer } from "./main";
import uploadIcon from "../assets/upload.png";

export default function MainContent({ children, onOpenSidebar, user, setUser }) {
  return (
    <div className="flex flex-col h-screen">
      <Header onOpenSidebar={onOpenSidebar} user={user} setUser={setUser} />

      <Body>
        {children ?? (
          <>
            <div className="relative w-full">
                <h4 className="absolute top-[11px] md:top-[5px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
                    あなたの配信、AIで最適化。<br className="block md:hidden" /> 売上アップの秘密がここに。
                </h4>

                <h4 className="absolute top-[125px] md:top-[157px] w-full text-[26px] leading-[35px] font-semibold font-cabin text-center">
                    動画ファイルを<br className="block md:hidden" /> アップロードして<br className="block md:hidden" /> 解析を開始
                </h4>
            </div>
            <div className="relative w-full">
                <div className="absolute top-[273px] md:top-[218px] left-1/2 -translate-x-1/2 w-[300px] h-[250px] md:w-[400px] md:h-[300px] border-5 border-gray-300 rounded-[20px] flex flex-col items-center justify-center text-center gap-4">
                    <img src={uploadIcon} alt="upload" className="w-[135px] h-[135px]" />
                    <h5 className="hidden md:inline text-[20px] leading-[35px] font-semibold font-cabin text-center h-[35px]">
                        動画ファイルをドラッグ＆ドロップ
                    </h5>
                    <button className="bg-90 w-[143px] h-[41px] flex items-center justify-center bg-white text-[#7D01FF] border border-[#7D01FF] rounded-[30px] leading-[28px]">
                    ファイルを選択
                    </button>
                </div>
            </div>
          </>
        )}
      </Body>

      <Footer />
    </div>
  );
}
