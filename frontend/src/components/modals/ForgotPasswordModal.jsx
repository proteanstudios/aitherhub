import ForgotPassword from "../../pages/authPages/ForgotPassword";
import CloseSvg from "../../assets/icons/close.svg";

export default function ForgotPasswordModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div className="relative mt-[123px] mb-[100px] mx-auto w-[92vw] max-w-[428px] aspect-[428/569] rounded-xl md:mt-[133px] md:mb-0 md:mx-0 md:w-[700px] md:h-[569px] md:max-w-none md:aspect-auto  md:opacity-100">       
        <button
          onClick={onClose}
          className="bg-90 absolute right-0 top-0 w-[56px] h-[56px] rounded-full overflow-hidden flex items-center justify-center"
        >
          <img src={CloseSvg} alt="Close" className="w-full h-full object-cover scale-70" />
        </button>

        <div className="p-6 w-full mt-[69px] bg-white rounded-[10px]">
          <ForgotPassword onSuccess={onClose} />
        </div>
      </div>
    </div>
  );
}
