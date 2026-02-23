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
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-r ${colorMap[color]} flex items-center justify-center`}>
          <span className="text-white text-xs">{icon}</span>
        </div>
      </div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {trend !== undefined && (
        <div className={`text-[10px] mt-0.5 ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
    <div className={`border-l-4 ${priorityColors[priority]} rounded-r-lg p-3 mb-2 transition-all duration-500 ${isNew ? 'animate-pulse ring-2 ring-purple-300' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-base">{priorityIcons[priority]}</span>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-900">{advice.message}</p>
          {advice.action && (
            <p className="text-[10px] text-gray-600 mt-1 italic">→ {advice.action}</p>
          )}
          <p className="text-[9px] text-gray-400 mt-1">
            {advice.timestamp ? new Date(typeof advice.timestamp === 'number' ? advice.timestamp * 1000 : advice.timestamp).toLocaleTimeString('ja-JP') : ''}
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Mini Chart (Sparkline) ────────────────────────────────
const Sparkline = ({ data, color = '#7D01FF', height = 50, label }) => {
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

// ─── HLS Video Player ──────────────────────────────────────
const HLSVideoPlayer = ({ streamUrl, username }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playerState, setPlayerState] = useState('loading'); // loading | playing | error
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    let hls = null;

    const initHls = async () => {
      try {
        // Dynamically import hls.js from CDN
        if (!window.Hls) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        const Hls = window.Hls;

        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
            maxBufferLength: 10,
            maxMaxBufferLength: 20,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
            liveDurationInfinity: true,
            fragLoadingTimeOut: 20000,
            manifestLoadingTimeOut: 20000,
            levelLoadingTimeOut: 20000,
          });

          hlsRef.current = hls;

          hls.on(Hls.Events.ERROR, (event, data) => {
            console.warn('HLS error:', data.type, data.details);
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('HLS: Fatal network error, trying to recover...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('HLS: Fatal media error, trying to recover...');
                  hls.recoverMediaError();
                  break;
                default:
                  setPlayerState('error');
                  setErrorMsg('ストリームの再生に失敗しました');
                  break;
              }
            }
          });

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS: Manifest parsed, starting playback');
            videoRef.current.play().then(() => {
              setPlayerState('playing');
            }).catch(err => {
              console.warn('HLS: Autoplay blocked, muting and retrying');
              videoRef.current.muted = true;
              videoRef.current.play().then(() => {
                setPlayerState('playing');
              }).catch(() => {
                setPlayerState('error');
                setErrorMsg('自動再生がブロックされました');
              });
            });
          });

          hls.loadSource(streamUrl);
          hls.attachMedia(videoRef.current);

        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS support
          videoRef.current.src = streamUrl;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current.play().then(() => {
              setPlayerState('playing');
            }).catch(() => {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => setPlayerState('playing'));
            });
          });
        } else {
          setPlayerState('error');
          setErrorMsg('お使いのブラウザはHLS再生に対応していません');
        }
      } catch (err) {
        console.error('HLS init error:', err);
        setPlayerState('error');
        setErrorMsg('プレーヤーの初期化に失敗しました');
      }
    };

    initHls();

    return () => {
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center">
      {/* Video element - maintain 9:16 aspect ratio */}
      <video
        ref={videoRef}
        className="h-full object-contain"
        style={{
          maxWidth: '100%',
          aspectRatio: '9 / 16',
          display: playerState === 'playing' ? 'block' : 'none',
        }}
        playsInline
        autoPlay
        controls={false}
      />

      {/* Loading state */}
      {playerState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full border-4 border-t-[#FF0050] border-r-[#00F2EA] border-b-[#FF0050] border-l-[#00F2EA] animate-spin mb-4"></div>
          <p className="text-white text-sm">ライブ映像を読み込み中...</p>
          <p className="text-gray-500 text-xs mt-1">@{username}</p>
        </div>
      )}

      {/* Error state - show fallback */}
      {playerState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF0050]/20 to-[#00F2EA]/20 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
              <line x1="12" y1="2" x2="12" y2="6" opacity="0.5"/>
              <line x1="12" y1="18" x2="12" y2="22" opacity="0.5"/>
              <line x1="2" y1="12" x2="6" y2="12" opacity="0.5"/>
              <line x1="18" y1="12" x2="22" y2="12" opacity="0.5"/>
            </svg>
          </div>
          <p className="text-white text-sm mb-1">{errorMsg || 'ストリーム接続エラー'}</p>
          <p className="text-gray-500 text-xs mb-4">ダッシュボードのデータは正常に受信しています</p>
          <a
            href={`https://www.tiktok.com/@${username}/live`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#FF0050] hover:bg-[#FF0050]/80 text-white text-xs px-4 py-2 rounded-full transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            TikTokで視聴
          </a>
        </div>
      )}

      {/* Mute indicator overlay */}
      {playerState === 'playing' && (
        <button
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.muted = !videoRef.current.muted;
            }
          }}
          className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm rounded-full p-2 text-white hover:bg-black/80 transition-colors"
          title="音声ON/OFF"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </button>
      )}
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
  const [metricsReceived, setMetricsReceived] = useState(false);
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
    console.log('LiveDashboard: Received metrics:', JSON.stringify(data));
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
    setMetricsReceived(true);
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
        console.log('LiveDashboard: Stream URL received:', data);
        if (data && data.stream_url) {
          setStreamUrl(data.stream_url);
        }
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

  // Check if dashboard should show (metrics received or loadStep >= 5)
  const showDashboard = loadStep >= 5 || metricsReceived;

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700/50 shrink-0">
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

      {/* Main Content - horizontal layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Live Video Area - 9:16 centered */}
        <div className="flex-1 flex flex-col bg-black min-w-0">
          {/* Video Player Area */}
          <div className="flex-1 relative flex items-center justify-center min-h-0">
            {showDashboard ? (
              /* Connected - show HLS video player or fallback */
              streamUrl ? (
                <div className="h-full flex items-center justify-center" style={{ aspectRatio: '9 / 16', maxWidth: '100%' }}>
                  <HLSVideoPlayer streamUrl={streamUrl} username={username} />
                </div>
              ) : (
                /* No stream URL yet - show waiting state with TikTok link */
                <div className="flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full border-4 border-t-[#FF0050] border-r-[#00F2EA] border-b-[#FF0050] border-l-[#00F2EA] animate-spin mb-4"></div>
                  <p className="text-white text-sm mb-2">ストリームURLを取得中...</p>
                  <p className="text-gray-500 text-xs mb-4">データは正常に受信しています</p>
                  <a
                    href={`https://www.tiktok.com/@${username}/live`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#FF0050] hover:bg-[#FF0050]/80 text-white text-xs px-4 py-2 rounded-full transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    TikTokで視聴
                  </a>
                </div>
              )
            ) : (
              /* Loading state */
              <div className="flex items-center justify-center">
                <div className="text-center w-72">
                  {/* Animated icon */}
                  <div className="w-20 h-20 rounded-full bg-gradient-to-r from-[#FF0050] to-[#00F2EA] flex items-center justify-center mx-auto mb-5 animate-pulse shadow-lg shadow-pink-500/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                  </div>

                  {/* Progress percentage */}
                  <p className="text-white text-2xl font-bold mb-2">{loadProgress}%</p>

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
              </div>
            )}

            {/* Overlay Metrics (only when video is playing) */}
            {showDashboard && (
              <div className="absolute top-3 left-3 flex gap-2 z-10">
                <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF0050" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span className="text-white text-xs font-bold">{formatNum(metrics.viewer_count)}</span>
                </div>
                <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#FF0050" stroke="#FF0050" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  <span className="text-white text-xs font-bold">{formatNum(metrics.like_count)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Sparklines */}
          {showDashboard && (
            <div className="h-16 bg-gray-900/80 border-t border-gray-800 px-3 py-1.5 grid grid-cols-4 gap-3 shrink-0">
              <Sparkline data={metricsHistory.viewers} color="#FF0050" height={40} label="視聴者" />
              <Sparkline data={metricsHistory.comments} color="#00F2EA" height={40} label="コメント/分" />
              <Sparkline data={metricsHistory.likes} color="#FF6B6B" height={40} label="いいね" />
              <Sparkline data={metricsHistory.gifts} color="#FFD93D" height={40} label="ギフト" />
            </div>
          )}
        </div>

        {/* Right: Dashboard Panel - fixed 320px */}
        <div className="w-80 flex flex-col bg-gray-50 border-l border-gray-200 overflow-hidden shrink-0">
          {/* Metrics Grid */}
          <div className="p-2.5 grid grid-cols-2 gap-2 border-b border-gray-200 shrink-0">
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
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b border-gray-200 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
                  <span className="text-white text-[10px]">AI</span>
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
              className="flex-1 overflow-y-auto p-2.5 space-y-2"
            >
              {advices.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center mb-3">
                    <span className="text-xl">🤖</span>
                  </div>
                  <p className="text-sm text-gray-500">AIがライブを分析中...</p>
                  <p className="text-xs text-gray-400 mt-1">
                    視聴者の動きやコメントの変化を<br/>監視しています
                  </p>
                  <p className="text-[10px] text-gray-300 mt-3">
                    約30秒後にデータが蓄積されると<br/>AIアドバイスが表示されます
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
          <div className="px-3 py-1.5 bg-white border-t border-gray-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected && !streamEnded ? 'bg-green-500' : streamEnded ? 'bg-gray-400' : 'bg-red-500'}`}></div>
              <span className="text-[10px] text-gray-500">
                {streamEnded ? 'ライブ終了' : isConnected ? '接続中' : '接続待ち'}
              </span>
            </div>
            {metricsReceived && (
              <span className="text-[10px] text-green-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                データ受信中
              </span>
            )}
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
