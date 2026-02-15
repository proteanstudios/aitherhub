import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import BaseApiService from "../../base/api/BaseApiService";
import { URL_CONSTANTS } from "../../base/api/endpoints/constant";

const api = new BaseApiService(import.meta.env.VITE_API_BASE_URL || "");

export default function LCJLinkingModal({ trigger, open, onOpenChange }) {
  const [linkStatus, setLinkStatus] = useState(null);
  const [liverEmail, setLiverEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fetching, setFetching] = useState(true);

  // 2ステップフロー: verify → confirm → link
  const [step, setStep] = useState("input"); // "input" | "confirm" | "done"
  const [verifiedLiver, setVerifiedLiver] = useState(null);

  const t = window.__t || ((k) => k);

  // 連携状態を取得
  const fetchLinkStatus = async () => {
    setFetching(true);
    try {
      const data = await api.get(URL_CONSTANTS.LCJ_LINK_STATUS);
      setLinkStatus(data);
    } catch (err) {
      console.error("Failed to fetch LCJ link status:", err);
      setLinkStatus({ linked: false });
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchLinkStatus();
      setError("");
      setSuccess("");
      setLiverEmail("");
      setStep("input");
      setVerifiedLiver(null);
    }
  }, [open]);

  // ステップ1: メールアドレスでライバーを検索
  const handleVerify = async () => {
    if (!liverEmail.trim()) {
      setError(t("lcjEnterEmail"));
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const data = await api.post(URL_CONSTANTS.LCJ_VERIFY_LIVER, {
        email: liverEmail.trim(),
      });
      if (data.found) {
        setVerifiedLiver(data);
        setStep("confirm");
      } else {
        setError(t("lcjLiverNotFound"));
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail || t("lcjLiverNotFound"));
    } finally {
      setLoading(false);
    }
  };

  // ステップ2: 確認して連携を確定
  const handleConfirmLink = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.post(URL_CONSTANTS.LCJ_LINK, {
        liver_email: liverEmail.trim(),
      });
      setSuccess(t("lcjLinkSuccess"));
      setLinkStatus({
        linked: true,
        liver_email: liverEmail.trim(),
        liver_name: data.liver_name,
        linked_at: new Date().toISOString(),
      });
      setStep("done");
      setLiverEmail("");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail || t("lcjLinkError"));
    } finally {
      setLoading(false);
    }
  };

  // 連携解除
  const handleUnlink = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await api.post(URL_CONSTANTS.LCJ_UNLINK);
      setSuccess(t("lcjUnlinkSuccess"));
      setLinkStatus({ linked: false });
      setStep("input");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail || t("lcjLinkError"));
    } finally {
      setLoading(false);
    }
  };

  // 戻るボタン
  const handleBack = () => {
    setStep("input");
    setVerifiedLiver(null);
    setError("");
  };

  const handleOpenChange =
    onOpenChange ?? ((nextOpen) => (!nextOpen ? null : null));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="w-[92vw] max-w-[428px] md:w-[500px] md:max-w-none p-0 bg-white">
        <DialogTitle className="sr-only">{t("lcjLinking")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("lcjLinkDescription")}
        </DialogDescription>

        <div className="p-6 w-full">
          {/* ヘッダー */}
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {t("lcjLinking")}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {t("lcjLinkDescription")}
          </p>

          {fetching ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : linkStatus?.linked ? (
            /* === 連携済み表示 === */
            <div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-green-700">
                    {t("lcjLinked")}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">
                      {t("lcjLiverName")}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {linkStatus.liver_name || "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">
                      {t("lcjLiverEmail")}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {linkStatus.liver_email || "-"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleUnlink}
                disabled={loading}
                className="w-full py-2 px-4 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {loading ? t("lcjLinking_processing") : t("lcjUnlinkButton")}
              </button>
            </div>
          ) : step === "confirm" && verifiedLiver ? (
            /* === ステップ2: ライバー確認画面 === */
            <div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-purple-700 font-medium mb-3">
                  {t("lcjConfirmLiver")}
                </p>
                <div className="bg-white rounded-lg p-4 border border-purple-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-600 font-semibold text-lg">
                        {(verifiedLiver.name || "?").charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="text-base font-semibold text-gray-900">
                        {verifiedLiver.name}
                      </p>
                      <p className="text-sm text-gray-500">{liverEmail}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  disabled={loading}
                  className="flex-1 py-2 px-4 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {t("lcjBack")}
                </button>
                <button
                  onClick={handleConfirmLink}
                  disabled={loading}
                  className="flex-1 py-2 px-4 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  {loading ? t("lcjLinking_processing") : t("lcjConfirmLink")}
                </button>
              </div>
            </div>
          ) : (
            /* === ステップ1: メールアドレス入力 === */
            <div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                  <span className="text-sm font-medium text-gray-500">
                    {t("lcjNotLinked")}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("lcjLiverEmail")}
                </label>
                <input
                  type="email"
                  value={liverEmail}
                  onChange={(e) => setLiverEmail(e.target.value)}
                  placeholder={t("lcjEnterEmail")}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleVerify();
                  }}
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={loading || !liverEmail.trim()}
                className="w-full py-2 px-4 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t("lcjLinking_processing") : t("lcjSearchLiver")}
              </button>
            </div>
          )}

          {/* エラー・成功メッセージ */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          {success && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-600">{success}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
