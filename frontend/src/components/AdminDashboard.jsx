import { useState, useEffect } from "react";
import axios from "axios";

const ADMIN_ID = "aither";
const ADMIN_PASS = "hub";
const SESSION_KEY = "aitherhub_admin_auth";

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check session on mount
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "true") {
      setAuthenticated(true);
    }
  }, []);

  // Fetch data after authentication
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const baseURL = import.meta.env.VITE_API_BASE_URL;
        const res = await axios.get(`${baseURL}/api/v1/admin/dashboard-public`, {
          headers: { "X-Admin-Key": `${ADMIN_ID}:${ADMIN_PASS}` },
        });
        if (!cancelled) setStats(res.data);
      } catch (err) {
        if (!cancelled) setError("データの取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (loginId === ADMIN_ID && loginPass === ADMIN_PASS) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setAuthenticated(true);
      setLoginError("");
    } else {
      setLoginError("IDまたはパスワードが正しくありません");
    }
  };

  // ── Login Screen ──
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-800">Aitherhub Admin</h1>
            <p className="text-sm text-gray-400 mt-1">管理者ログイン</p>
          </div>
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">ID</label>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">パスワード</label>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
              />
            </div>
            {loginError && (
              <p className="text-red-500 text-xs mb-3">{loginError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg transition-colors"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-500 text-lg">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const { data_volume, video_types, user_scale } = stats;

  // ── Dashboard ──
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-800">
            Aitherhub マスターダッシュボード
          </h1>
          <button
            onClick={() => {
              sessionStorage.removeItem(SESSION_KEY);
              setAuthenticated(false);
              setStats(null);
            }}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ログアウト
          </button>
        </div>

        {/* データ量 (AI資産量) */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📊</span>
            <h2 className="text-lg font-semibold text-gray-700">データ量</h2>
            <span className="text-xs text-gray-400 ml-1">AI資産量</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="総動画数" value={data_volume.total_videos} unit="本" color="orange" />
            <StatCard label="解析済" value={data_volume.analyzed_videos} unit="本" color="green" />
            <StatCard label="解析待ち" value={data_volume.pending_videos} unit="本" color="yellow" />
            <StatCard label="総動画時間" value={data_volume.total_duration_display} color="blue" />
          </div>
        </section>

        {/* 動画タイプ (データ構造) */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🎬</span>
            <h2 className="text-lg font-semibold text-gray-700">動画タイプ</h2>
            <span className="text-xs text-gray-400 ml-1">データ構造</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="画面収録数" value={video_types.screen_recording_count} unit="本" color="purple" />
            <StatCard label="クリーン動画数" value={video_types.clean_video_count} unit="本" color="indigo" />
            <StatCard label="最新アップ日" value={formatDate(video_types.latest_upload)} color="gray" small />
          </div>
        </section>

        {/* 会員規模 (母数) */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">👥</span>
            <h2 className="text-lg font-semibold text-gray-700">会員規模</h2>
            <span className="text-xs text-gray-400 ml-1">母数</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="総ユーザー" value={user_scale.total_users} unit="人" color="orange" />
            <StatCard label="配信者数" value={user_scale.total_streamers} unit="人" color="red" />
            <StatCard label="今月アップ人数" value={user_scale.this_month_uploaders} unit="人" color="teal" />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, color = "gray", small = false }) {
  const colorMap = {
    orange: "border-orange-300 bg-orange-50",
    green: "border-green-300 bg-green-50",
    yellow: "border-yellow-300 bg-yellow-50",
    blue: "border-blue-300 bg-blue-50",
    purple: "border-purple-300 bg-purple-50",
    indigo: "border-indigo-300 bg-indigo-50",
    red: "border-red-300 bg-red-50",
    teal: "border-teal-300 bg-teal-50",
    gray: "border-gray-300 bg-gray-50",
  };
  const textColorMap = {
    orange: "text-orange-600",
    green: "text-green-600",
    yellow: "text-yellow-600",
    blue: "text-blue-600",
    purple: "text-purple-600",
    indigo: "text-indigo-600",
    red: "text-red-600",
    teal: "text-teal-600",
    gray: "text-gray-600",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.gray} transition-all duration-200 hover:shadow-md`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`${small ? "text-lg" : "text-2xl"} font-bold ${textColorMap[color] || textColorMap.gray}`}>
        {value}
        {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}
