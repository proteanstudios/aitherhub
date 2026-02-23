import React, { useState, useEffect, useRef, useCallback } from 'react';
import VideoService from '../base/services/videoService';

// ─── Metric Card ───────────────────────────────────────────
const MetricCard = ({ label, value, trend, icon, color = 'purple' }) => {
  const colorMap = {
    purple: 'from-purple-500 to-purple-600',
    red: 'from-red-500 to-red-600',
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    orange: 'from-orange-500 to-orange-600',
    pink: 'from-pink-500 to-pink-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${colorMap[color]} flex items-center justify-center`}>
          <span className="text-white text-sm">{icon}</span>
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {trend !== undefined && (
        <div className={`text-xs mt-1 ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
};

// ─── AI Advice Card ────────────────────────────────────────
const AdviceCard = ({ advice, isNew }) => {
  const priorityColors = {
    high: 'border-l-red-500 bg-red-50',
    medium: 'border-l-orange-500 bg-orange-50',
    low: 'border-l-blue-500 bg-blue-50',
  };

  const priorityIcons = {
    high: '🔥',
    medium: '⚡',
    low: '💡',
  };

  const priority = advice.urgency || advice.priority || 'medium';

  return (
    <div className={`border-l-4 ${priorityColors[priority]} rounded-r-lg p-4 mb-3 transition-all duration-500 ${isNew ? 'animate-pulse ring-2 ring-purple-300' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{priorityIcons[priority]}</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{advice.message}</p>
          {advice.action && (
            <p className="text-xs text-gray-600 mt-1 italic">→ {advice.action}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            {new Date(advice.timestamp * 1000).toLocaleTimeString('ja-JP')}
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Mini Chart (Sparkline) ────────────────────────────────
const Sparkline = ({ data, color = '#7D01FF', height = 60, label }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || data.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '05');

    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h * 0.85);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h * 0.85);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw current value dot
    if (data.length > 0) {
      const lastX = w;
      const lastY = h - ((data[data.length - 1] - min) / range) * (h * 0.85);
      ctx.beginPath();
      ctx.arc(lastX - 2, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }, [data, color]);

  return (
    <div className="flex flex-col">
      {label && <span className="text-[10px] text-gray-400 mb-1">{label}</span>}
      <canvas ref={canvasRef} width={200} height={height} className="w-full" />
    </div>
  );
};

// ─── Main LiveDashboard Component ──────────────────────────
const LiveDashboard = ({ videoId, liveUrl, username, title, onClose }) => {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [metrics, setMetrics] = useState({
    viewer_count: 0,
    like_count: 0,
    comment_count: 0,
    gift_count: 0,
    share_count: 0,
    new_follower_count: 0,
  });
  const [metricsHistory, setMetricsHistory] = useState({
    viewers: [],
    comments: [],
    likes: [],
    gifts: [],
  });
  const [advices, setAdvices] = useState([]);
  const [newAdviceId, setNewAdviceId] = useState(null);
  const [streamEnded, setStreamEnded] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStep, setLoadStep] = useState(0); // 0-5
  const loadSteps = [
    { label: 'モニター起動中...', pct: 10 },
    { label: 'TikTokライブに接続中...', pct: 30 },
    { label: 'SSEストリーム確立中...', pct: 50 },
    { label: 'ストリームURL取得中...', pct: 70 },
    { label: 'メトリクス受信待ち...', pct: 85 },
    { label: '接続完了', pct: 100 },
  ];

  const sseRef = useRef(null);
  const timerRef = useRef(null);
  const videoRef = useRef(null);
  const adviceContainerRef = useRef(null);
  const startTimeRef = useRef(Date.now());

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Format elapsed time
  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Handle metrics update
  const handleMetrics = useCallback((data) => {
    setMetrics(prev => ({
      ...prev,
      viewer_count: data.viewer_count ?? prev.viewer_count,
      like_count: data.total_likes ?? prev.like_count,
      comment_count: data.total_comments ?? prev.comment_count,
      gift_count: data.total_gifts ?? prev.gift_count,
      share_count: data.total_shares ?? prev.share_count,
    }));
    setMetricsHistory(prev => ({
      viewers: [...prev.viewers.slice(-59), data.viewer_count || 0],
      comments: [...prev.comments.slice(-59), data.comments_in_interval || 0],
      likes: [...prev.likes.slice(-59), data.likes_in_interval || 0],
      gifts: [...prev.gifts.slice(-59), data.gifts_in_interval || 0],
    }));
  }, []);

  // Handle AI advice
  const handleAdvice = useCallback((data) => {
    const id = Date.now();
    setAdvices(prev => [{ ...data, id }, ...prev.slice(0, 19)]);
    setNewAdviceId(id);
    setTimeout(() => setNewAdviceId(null), 3000);

    // Auto-scroll to top
    if (adviceContainerRef.current) {
      adviceContainerRef.current.scrollTop = 0;
    }
  }, []);

  // Handle stream URL
  const handleStreamUrl = useCallback((data) => {
    if (data.stream_url) {
      setStreamUrl(data.stream_url);
    } else if (data.flv_url || data.hls_url) {
      setStreamUrl(data.flv_url || data.hls_url);
    }
  }, []);

  // Handle stream ended
  const handleStreamEnded = useCallback((data) => {
    setStreamEnded(true);
    clearInterval(timerRef.current);
  }, []);

  // Smooth progress animation
  useEffect(() => {
    const target = loadSteps[loadStep]?.pct || 0;
    if (loadProgress >= target) return;
    const timer = setInterval(() => {
      setLoadProgress(prev => {
        if (prev >= target) { clearInterval(timer); return target; }
        return Math.min(prev + 1, target);
      });
    }, 40);
    return () => clearInterval(timer);
  }, [loadStep]);

  // Connect SSE
  useEffect(() => {
    if (!videoId) return;

    // Step 0: Start monitoring
    setLoadStep(0);
    VideoService.startLiveMonitor(videoId, liveUrl)
      .then(() => {
        setLoadStep(1); // Step 1: Connected to TikTok
      })
      .catch(err => {
        console.error('Failed to start monitor:', err);
        setLoadStep(1); // Continue anyway
      });

    // Step 2: SSE stream
    setTimeout(() => setLoadStep(2), 3000);

    // Connect SSE
    sseRef.current = VideoService.streamLiveEvents({
      videoId,
      onMetrics: (data) => {
        setLoadStep(prev => (prev < 5 ? 5 : prev)); // Step 5: Complete
        handleMetrics(data);
      },
      onAdvice: handleAdvice,
      onStreamUrl: (data) => {
        setLoadStep(prev => Math.max(prev, 3)); // Step 3: Stream URL received
        handleStreamUrl(data);
      },
      onStreamEnded: handleStreamEnded,
      onError: (err) => {
        console.error('LiveSSE error:', err);
        setError('接続が切断されました。再接続中...');
      },
    });

    setIsConnected(true);

    // Step 4: Waiting for metrics (if not received yet)
    const metricsTimer = setTimeout(() => {
      setLoadStep(prev => (prev < 4 ? 4 : prev));
    }, 8000);

    return () => {
      if (sseRef.current) sseRef.current.close();
      clearTimeout(metricsTimer);
    };
  }, [videoId, liveUrl]);

  // Format number
  const formatNum = (n) => {
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n || 0);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${streamEnded ? 'bg-gray-400' : 'bg-red-400'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${streamEnded ? 'bg-gray-500' : 'bg-red-500'}`}></span>
            </span>
            <span className="text-white font-bold text-sm">
              {streamEnded ? 'ライブ終了' : 'LIVE'}
            </span>
          </div>
          <span className="text-gray-300 text-sm">@{username}</span>
          {title && <span className="text-gray-500 text-xs hidden md:inline">| {title}</span>}
          <span className="text-gray-400 text-xs font-mono">{formatTime(elapsedTime)}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Live Video */}
        <div className="flex-1 flex flex-col bg-black">
          {/* Video Player Area */}
          <div className="flex-1 relative flex items-center justify-center">
            {loadStep >= 5 ? (
              /* Connected - show video or live placeholder */
              streamUrl ? (
                <video
                  ref={videoRef}
                  src={streamUrl}
                  autoPlay
                  muted
                  playsInline
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-center">
                  <div className="w-32 h-32 rounded-full bg-gradient-to-r from-[#FF0050]/20 to-[#00F2EA]/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF0050" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                  </div>
                  <p className="text-white text-lg font-bold">ライブ配信中</p>
                  <p className="text-gray-400 text-sm mt-1">@{username}</p>
                  <p className="text-gray-500 text-xs mt-2">リアルタイムデータを受信中</p>
                </div>
              )
            ) : (
              <div className="text-center w-80">
                {/* Animated icon */}
                <div className="w-24 h-24 rounded-full bg-gradient-to-r from-[#FF0050] to-[#00F2EA] flex items-center justify-center mx-auto mb-6 animate-pulse shadow-lg shadow-pink-500/30">
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                </div>

                {/* Progress percentage */}
                <p className="text-white text-3xl font-bold mb-2">{loadProgress}%</p>

                {/* Current step label */}
                <p className="text-gray-300 text-sm mb-4">{loadSteps[loadStep]?.label || '準備中...'}</p>

                {/* Progress bar */}
                <div className="w-full bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#FF0050] to-[#00F2EA] transition-all duration-300 ease-out"
                    style={{ width: `${loadProgress}%` }}
                  />
                </div>

                {/* Step indicators */}
                <div className="space-y-2 text-left">
                  {loadSteps.slice(0, -1).map((step, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs transition-all duration-300 ${i <= loadStep ? 'text-gray-300' : 'text-gray-600'}`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                        i < loadStep ? 'bg-green-500 text-white' : i === loadStep ? 'bg-gradient-to-r from-[#FF0050] to-[#00F2EA] text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                      }`}>
                        {i < loadStep ? '✓' : i + 1}
                      </span>
                      <span>{step.label.replace('...', '')}</span>
                    </div>
                  ))}
                </div>

                {/* Estimated time */}
                <p className="text-gray-600 text-[10px] mt-4">通常10〜30秒で接続されます</p>
              </div>
            )}

            {/* Overlay Metrics */}
            <div className="absolute top-4 left-4 flex gap-2">
              <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF0050" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span className="text-white text-xs font-bold">{formatNum(metrics.viewer_count)}</span>
              </div>
              <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#FF0050" stroke="#FF0050" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <span className="text-white text-xs font-bold">{formatNum(metrics.like_count)}</span>
              </div>
            </div>
          </div>

          {/* Bottom Sparklines */}
          <div className="h-20 bg-gray-900/80 border-t border-gray-800 px-4 py-2 grid grid-cols-4 gap-4">
            <Sparkline data={metricsHistory.viewers} color="#FF0050" height={50} label="視聴者" />
            <Sparkline data={metricsHistory.comments} color="#00F2EA" height={50} label="コメント/分" />
            <Sparkline data={metricsHistory.likes} color="#FF6B6B" height={50} label="いいね" />
            <Sparkline data={metricsHistory.gifts} color="#FFD93D" height={50} label="ギフト" />
          </div>
        </div>

        {/* Right: Dashboard */}
        <div className="w-[380px] flex flex-col bg-gray-50 border-l border-gray-200 overflow-hidden">
          {/* Metrics Grid */}
          <div className="p-3 grid grid-cols-2 gap-2 border-b border-gray-200">
            <MetricCard
              label="視聴者数"
              value={formatNum(metrics.viewer_count)}
              trend={metricsHistory.viewers.length > 5 ?
                ((metrics.viewer_count - metricsHistory.viewers[metricsHistory.viewers.length - 6]) / (metricsHistory.viewers[metricsHistory.viewers.length - 6] || 1)) * 100
                : undefined}
              icon="👁"
              color="red"
            />
            <MetricCard
              label="コメント数"
              value={formatNum(metrics.comment_count)}
              icon="💬"
              color="blue"
            />
            <MetricCard
              label="いいね"
              value={formatNum(metrics.like_count)}
              icon="❤️"
              color="pink"
            />
            <MetricCard
              label="ギフト"
              value={formatNum(metrics.gift_count)}
              icon="🎁"
              color="orange"
            />
            <MetricCard
              label="シェア"
              value={formatNum(metrics.share_count)}
              icon="📤"
              color="green"
            />
            <MetricCard
              label="新規フォロー"
              value={formatNum(metrics.new_follower_count)}
              icon="➕"
              color="purple"
            />
          </div>

          {/* AI Advice Section */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
                  <span className="text-white text-xs">AI</span>
                </div>
                <span className="text-sm font-bold text-gray-800">リアルタイムアドバイス</span>
                {advices.length > 0 && (
                  <span className="bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-full">
                    {advices.length}件
                  </span>
                )}
              </div>
            </div>

            <div
              ref={adviceContainerRef}
              className="flex-1 overflow-y-auto p-3 space-y-2"
            >
              {advices.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-3">
                    <span className="text-2xl">🤖</span>
                  </div>
                  <p className="text-sm text-gray-500">AIがライブを分析中...</p>
                  <p className="text-xs text-gray-400 mt-1">
                    視聴者の動きやコメントの変化を<br/>監視しています
                  </p>
                </div>
              ) : (
                advices.map((advice) => (
                  <AdviceCard
                    key={advice.id}
                    advice={advice}
                    isNew={advice.id === newAdviceId}
                  />
                ))
              )}
            </div>
          </div>

          {/* Connection Status */}
          <div className="px-4 py-2 bg-white border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected && !streamEnded ? 'bg-green-500' : streamEnded ? 'bg-gray-400' : 'bg-red-500'}`}></div>
              <span className="text-[10px] text-gray-500">
                {streamEnded ? 'ライブ終了' : isConnected ? '接続中' : '接続待ち'}
              </span>
            </div>
            {error && (
              <span className="text-[10px] text-red-500">{error}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveDashboard;
