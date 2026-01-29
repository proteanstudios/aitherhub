import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import ForgotPassword from "../../pages/authPages/ForgotPassword";
import CloseSvg from "../../assets/icons/close.svg";

export default function ForgotPasswordModal({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/40 transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />

      <div className="fixed inset-0 z-50 flex justify-center">
        <div className="flex min-h-full items-start justify-center p-0">
          <DialogPanel
            transition
            className="relative mx-auto my-auto w-[92vw] max-w-[428px] rounded-xl md:mx-0 md:ml-[40px] md:w-[700px] md:h-[500px] md:max-w-none md:aspect-auto transform bg-white shadow-xl transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in data-closed:sm:translate-y-0 data-closed:sm:scale-95"
          >
            <button
              onClick={onClose}
              className="
                bg-white
                absolute right-0 top-[-70px]
                w-[56px] h-[56px]
                rounded-full
                overflow-hidden
                flex items-center justify-center
                z-10
                border-2 border-[#DDDDDD]
                cursor-pointer
                transition-transform duration-150 ease-out
                active:scale-[0.95]
                focus:outline-none focus-visible:outline-none
              "
            >
              <img
                src={CloseSvg}
                alt="Close"
                className="w-full h-full object-cover scale-50 pointer-events-none"
              />
            </button>

            <div className="p-6 w-full h-full bg-white rounded-[10px]">
              <ForgotPassword onSuccess={onClose} />
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
