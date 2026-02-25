import React, { useState, useEffect, useRef, useCallback } from 'react';
import VideoService from '../base/services/videoService';
import {
  CommentsPanel,
  ProductsPanel,
  TrafficSourcesPanel,
  ActivitiesPanel,
  ExtensionStatusBadge,
} from './LiveDashboardExtension';

// ─── Sparkline Chart ──────────────────────────────────────
const Sparkline = ({ data, color = '#00F2EA', height = 60, label, showDots = false }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || data.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const padding = 4;

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '05');

    ctx.beginPath();
    data.forEach((val, i) => {
      const x = padding + (i / (data.length - 1)) * (w - padding * 2);
      const y = padding + (1 - (val - min) / range) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + (w - padding * 2), h);
    ctx.lineTo(padding, h);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = padding + (i / (data.length - 1)) * (w - padding * 2);
      const y = padding + (1 - (val - min) / range) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current value dot
    if (data.length > 0) {
      const lastX = padding + ((data.length - 1) / (data.length - 1)) * (w - padding * 2);
      const lastY = padding + (1 - (data[data.length - 1] - min) / range) * (h - padding * 2);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
      ctx.strokeStyle = color + '60';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [data, color, height]);

  return (
    <div className="flex flex-col">
      {label && <span className="text-[10px] text-gray-500 mb-1">{label}</span>}
      <canvas ref={canvasRef} width={200} height={height} className="w-full" />
    </div>
  );
};

// ─── Donut Chart for Traffic Sources ──────────────────────
const DonutChart = ({ data, size = 120 }) => {
  const canvasRef = useRef(null);
  const colors = ['#00F2EA', '#FF0050', '#7D01FF', '#FFD93D', '#4ADE80', '#F97316', '#EC4899'];

  useEffect(() => {
    if (!canvasRef.current || !data || data.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = outerR * 0.6;

    let startAngle = -Math.PI / 2;
    const total = data.reduce((sum, d) => sum + (d.percentage || 0), 0) || 100;

    data.forEach((d, i) => {
      const sliceAngle = ((d.percentage || 0) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      startAngle += sliceAngle;
    });
  }, [data, size]);

  return <canvas ref={canvasRef} width={size} height={size} />;
};

// ─── Conversion Funnel ────────────────────────────────────
const ConversionFunnel = ({ metrics }) => {
  const items = [
    { label: 'インプレッション', key: 'impressions', color: '#00F2EA' },
    { label: '視聴数', key: 'views', color: '#7D01FF' },
    { label: '商品クリック', key: 'product_clicks', color: '#FF0050' },
    { label: '注文数', key: 'orders', color: '#FFD93D' },
  ];

  const values = items.map(item => {
    const raw = metrics[item.key] || metrics[item.label] || 0;
    return typeof raw === 'string' ? parseMetricNumber(raw) : raw;
  });

  const maxVal = Math.max(...values, 1);

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const val = values[idx];
        const pct = (val / maxVal) * 100;
        const convRate = idx > 0 && values[idx - 1] > 0
          ? ((val / values[idx - 1]) * 100).toFixed(1) + '%'
          : null;
        return (
          <div key={item.key}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">{formatLargeNum(val)}</span>
                {convRate && (
                  <span className="text-[9px] text-cyan-400">{convRate}</span>
                )}
              </div>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-1000"
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── AI Chat Panel ────────────────────────────────────────
const AIChatPanel = ({ videoId, metrics, advices, newAdviceId }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'suggestions'
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage = { role: 'user', content: inputText.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      // Build context with current metrics
      const metricsContext = Object.entries(metrics)
        .filter(([k, v]) => v && v !== '--' && v !== '0')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

      const systemMessage = {
        role: 'system',
        content: `あなたはTikTok Shop LIVEコマースの専門AIアドバイザーです。配信者のリアルタイムデータに基づいて、具体的で実行可能なアドバイスを提供してください。

現在のLIVEメトリクス: ${metricsContext}

回答は簡潔に、日本語で、実行可能なアクションを含めてください。`
      };

      const allMessages = [systemMessage, ...messages.slice(-10), userMessage];

      let assistantContent = '';
      const assistantMsg = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, assistantMsg]);

      const { cancel } = VideoService.streamLiveAiChat({
        messages: allMessages,
        onMessage: (token) => {
          assistantContent += token;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
            return updated;
          });
        },
        onDone: () => {
          setIsLoading(false);
        },
        onError: (err) => {
          console.error('AI Chat error:', err);
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              content: 'エラーが発生しました。もう一度お試しください。'
            };
            return updated;
          });
          setIsLoading(false);
        },
      });
    } catch (err) {
      console.error('AI Chat error:', err);
      setIsLoading(false);
    }
  };

  const quickQuestions = [
    '視聴者を増やすには？',
    '今の商品戦略は？',
    'コメント率を上げるには？',
    'GMVを改善するには？',
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Tab Header */}
      <div className="flex border-b border-gray-700/50 shrink-0">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'chat'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          AI チャット
        </button>
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
            activeTab === 'suggestions'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          AI 提案
          {advices.length > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>
      </div>

      {activeTab === 'chat' ? (
        <>
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00F2EA" strokeWidth="1.5">
                    <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10a10 10 0 0 1-10-10A10 10 0 0 1 12 2z"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                  </svg>
                </div>
                <p className="text-sm text-gray-300 font-medium mb-1">AI アシスタント</p>
                <p className="text-[11px] text-gray-500 mb-4">
                  ライブ配信に関する質問をどうぞ。<br/>
                  リアルタイムデータに基づいてアドバイスします。
                </p>
                <div className="grid grid-cols-2 gap-1.5 w-full">
                  {quickQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setInputText(q); inputRef.current?.focus(); }}
                      className="text-[10px] text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-lg px-2 py-1.5 transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                    msg.role === 'user'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-800 text-gray-200 border border-gray-700/50'
                  }`}>
                    <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            {isLoading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-gray-800 border border-gray-700/50 rounded-xl px-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-2 border-t border-gray-700/50 shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="AIに質問する..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputText.trim()}
                className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </>
      ) : (
        /* AI Suggestions Tab */
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-0">
          {advices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7D01FF" strokeWidth="1.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <p className="text-xs text-gray-400">AIがライブを分析中...</p>
              <p className="text-[10px] text-gray-500 mt-1">
                データが蓄積されるとAI提案が表示されます
              </p>
            </div>
          ) : (
            advices.map((advice) => {
              const priority = advice.urgency || advice.priority || 'medium';
              const priorityConfig = {
                high: { border: 'border-l-red-500', bg: 'bg-red-500/10', icon: '🔥' },
                medium: { border: 'border-l-amber-500', bg: 'bg-amber-500/10', icon: '⚡' },
                low: { border: 'border-l-cyan-500', bg: 'bg-cyan-500/10', icon: '💡' },
              };
              const config = priorityConfig[priority] || priorityConfig.medium;

              return (
                <div
                  key={advice.id}
                  className={`border-l-4 ${config.border} ${config.bg} rounded-r-lg p-2.5 transition-all duration-500 ${
                    advice.id === newAdviceId ? 'ring-1 ring-cyan-400/50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm">{config.icon}</span>
                    <div className="flex-1">
                      <p className="text-[11px] font-medium text-gray-200 leading-relaxed">{advice.message}</p>
                      {advice.action && (
                        <p className="text-[10px] text-cyan-400 mt-1">→ {advice.action}</p>
                      )}
                      <p className="text-[9px] text-gray-500 mt-1">
                        {advice.timestamp
                          ? new Date(typeof advice.timestamp === 'number' ? advice.timestamp * 1000 : advice.timestamp).toLocaleTimeString('ja-JP')
                          : ''}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

// ─── Metric Tile (TikTok style) ──────────────────────────
const MetricTile = ({ label, value, change, small = false }) => {
  const isPositive = change && !change.startsWith('-');
  return (
    <div className={`${small ? 'p-2' : 'p-3'} rounded-lg bg-gray-800/50 border border-gray-700/30 hover:border-gray-600/50 transition-colors`}>
      <p className={`${small ? 'text-[9px]' : 'text-[10px]'} text-gray-400 mb-0.5`}>{label}</p>
      <p className={`${small ? 'text-sm' : 'text-lg'} font-bold text-white`}>{value || '--'}</p>
      {change && (
        <p className={`text-[9px] mt-0.5 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '↑' : '↓'} {change.replace('-', '')}
        </p>
      )}
    </div>
  );
};

// ─── HLS Video Player ─────────────────────────────────────
const HLSVideoPlayer = ({ streamUrl, username }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playerState, setPlayerState] = useState('loading');

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    let hls = null;

    const initHls = async () => {
      try {
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
            liveSyncDurationCount: 3,
            liveDurationInfinity: true,
          });

          hlsRef.current = hls;

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              else setPlayerState('error');
            }
          });

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current.play()
              .then(() => setPlayerState('playing'))
              .catch(() => {
                videoRef.current.muted = true;
                videoRef.current.play().then(() => setPlayerState('playing'));
              });
          });

          hls.loadSource(streamUrl);
          hls.attachMedia(videoRef.current);
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = streamUrl;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current.play()
              .then(() => setPlayerState('playing'))
              .catch(() => {
                videoRef.current.muted = true;
                videoRef.current.play().then(() => setPlayerState('playing'));
              });
          });
        }
      } catch (err) {
        setPlayerState('error');
      }
    };

    initHls();

    return () => {
      if (hls) { hls.destroy(); hlsRef.current = null; }
    };
  }, [streamUrl]);

  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="h-full object-contain"
        style={{ maxWidth: '100%', aspectRatio: '9 / 16', display: playerState === 'playing' ? 'block' : 'none' }}
        playsInline autoPlay controls={false}
      />
      {playerState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-3 border-t-[#FF0050] border-r-[#00F2EA] border-b-[#FF0050] border-l-[#00F2EA] animate-spin mb-3"></div>
          <p className="text-gray-400 text-xs">映像読み込み中...</p>
        </div>
      )}
      {playerState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF0050" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <p className="text-gray-400 text-xs">映像を取得できません</p>
          <a
            href={`https://www.tiktok.com/@${username}/live`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            TikTokで視聴 →
          </a>
        </div>
      )}
      {playerState === 'playing' && (
        <button
          onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}
          className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm rounded-full p-1.5 text-white hover:bg-black/80 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        </button>
      )}
    </div>
  );
};

// ─── Helper Functions ─────────────────────────────────────
function formatLargeNum(n) {
  if (!n && n !== 0) return '--';
  if (typeof n === 'string') return n;
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function parseMetricNumber(value) {
  if (!value) return 0;
  const str = String(value).trim().replace(/,/g, '').replace('¥', '').replace('円', '');
  if (str.includes('万')) return parseFloat(str.replace('万', '')) * 10000;
  if (str.includes('K') || str.includes('k')) return parseFloat(str.replace(/[Kk]/g, '')) * 1000;
  if (str.includes('M') || str.includes('m')) return parseFloat(str.replace(/[Mm]/g, '')) * 1000000;
  return parseFloat(str) || 0;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Main LiveDashboard Component ─────────────────────────
const LiveDashboard = ({ videoId, extensionVideoId, liveUrl, username, title, onClose }) => {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [metrics, setMetrics] = useState({
    viewer_count: 0, like_count: 0, comment_count: 0,
    gift_count: 0, share_count: 0, new_follower_count: 0,
  });
  const [metricsHistory, setMetricsHistory] = useState({
    viewers: [], comments: [], likes: [], gifts: [],
  });
  const [advices, setAdvices] = useState([]);
  const [newAdviceId, setNewAdviceId] = useState(null);
  const [streamEnded, setStreamEnded] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [error, setError] = useState(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStep, setLoadStep] = useState(0);
  const [metricsReceived, setMetricsReceived] = useState(false);

  // Extension data state
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [extensionSource, setExtensionSource] = useState(null);
  const [extensionAccount, setExtensionAccount] = useState(null);
  const [extensionComments, setExtensionComments] = useState([]);
  const [newCommentIds, setNewCommentIds] = useState(new Set());
  const [extensionProducts, setExtensionProducts] = useState([]);
  const [extensionActivities, setExtensionActivities] = useState([]);
  const [extensionTraffic, setExtensionTraffic] = useState([]);
  const [extensionMetrics, setExtensionMetrics] = useState({});

  // Right panel tab
  const [rightTab, setRightTab] = useState('ai'); // 'ai' | 'comments' | 'products' | 'activity'

  const loadSteps = [
    { label: 'モニター起動中...', pct: 10 },
    { label: 'TikTokライブに接続中...', pct: 30 },
    { label: 'SSEストリーム確立中...', pct: 50 },
    { label: 'ストリームURL取得中...', pct: 70 },
    { label: 'メトリクス受信待ち...', pct: 85 },
    { label: '接続完了', pct: 100 },
  ];

  const sseRef = useRef(null);
  const extSseRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const seenAdviceMessagesRef = useRef(new Set());

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Handle metrics update
  const handleMetrics = useCallback((data) => {
    if (data.source === 'extension') {
      setExtensionConnected(true);
      setExtensionMetrics(prev => ({ ...prev, ...data }));
      
      // Extract viewer count from various possible keys
      const viewerStr = data.current_viewers || data['Current viewers'] || data['\u8996\u8074\u8005\u6570'];
      if (viewerStr) {
        const viewerNum = parseInt(String(viewerStr).replace(/[^0-9]/g, '')) || 0;
        setMetrics(prev => ({ ...prev, viewer_count: viewerNum }));
        // Also update history for sparkline
        setMetricsHistory(prev => ({
          ...prev,
          viewers: [...prev.viewers.slice(-59), viewerNum],
        }));
      }
    } else {
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
    }
    setMetricsReceived(true);
  }, []);

  // Handle AI advice - with deduplication
  const handleAdvice = useCallback((data) => {
    const messageKey = data.message || data.text || '';
    if (seenAdviceMessagesRef.current.has(messageKey)) return;
    seenAdviceMessagesRef.current.add(messageKey);
    // Keep only last 50 unique messages
    if (seenAdviceMessagesRef.current.size > 50) {
      const arr = Array.from(seenAdviceMessagesRef.current);
      seenAdviceMessagesRef.current = new Set(arr.slice(-30));
    }

    const id = Date.now() + Math.random();
    setAdvices(prev => [{ ...data, id }, ...prev.slice(0, 19)]);
    setNewAdviceId(id);
    setTimeout(() => setNewAdviceId(null), 3000);
  }, []);

  const handleStreamEnded = useCallback(() => {
    setStreamEnded(true);
    clearInterval(timerRef.current);
  }, []);

  // Extension event handlers
  const handleExtensionComments = useCallback((data) => {
    setExtensionConnected(true);
    if (data.comments && data.comments.length > 0) {
      const newIds = new Set(data.comments.map(c => c.id || `${c.username}_${c.text}`));
      setNewCommentIds(newIds);
      setExtensionComments(prev => [...data.comments, ...prev].slice(0, 500));
      setTimeout(() => setNewCommentIds(new Set()), 3000);
    }
  }, []);

  const handleExtensionProducts = useCallback((data) => {
    setExtensionConnected(true);
    if (data.products) setExtensionProducts(data.products);
  }, []);

  const handleExtensionActivities = useCallback((data) => {
    setExtensionConnected(true);
    if (data.activities && data.activities.length > 0) {
      setExtensionActivities(prev => [...data.activities, ...prev].slice(0, 200));
    }
  }, []);

  const handleExtensionTraffic = useCallback((data) => {
    setExtensionConnected(true);
    if (data.traffic_sources && data.traffic_sources.length > 0) {
      // Chrome extension sends {channel, gmv, impressions, views}
      // DonutChart expects {name, percentage}
      const sources = data.traffic_sources.map(s => {
        const viewsNum = parseMetricNumber(s.views || s.impressions || '0');
        return { name: s.channel || s.name || 'Unknown', views: viewsNum, rawViews: s.views, rawGmv: s.gmv };
      });
      const totalViews = sources.reduce((sum, s) => sum + s.views, 0) || 1;
      const withPercentage = sources.map(s => ({
        ...s,
        percentage: (s.views / totalViews) * 100,
      })).filter(s => s.percentage > 0).sort((a, b) => b.percentage - a.percentage);
      setExtensionTraffic(withPercentage);
    }
  }, []);

  const handleExtensionStreamUrl = useCallback((data) => {
    if (data.source === 'extension') {
      setExtensionConnected(true);
      setExtensionSource(data.extension_source);
      setExtensionAccount(data.account);
    }
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

  // SSE event handlers factory (shared between primary and extension SSE)
  const createSseHandlers = (isPrimary = true) => ({
    onMetrics: (data) => {
      setLoadStep(prev => (prev < 5 ? 5 : prev));
      handleMetrics(data);
    },
    onAdvice: handleAdvice,
    onStreamUrl: (data) => {
      if (data && data.stream_url) {
        setStreamUrl(data.stream_url);
        setLoadStep(prev => Math.max(prev, 3));
      }
      if (data && data.source === 'extension') {
        setLoadStep(5);
      }
      handleExtensionStreamUrl(data);
    },
    onStreamEnded: isPrimary ? handleStreamEnded : () => {},
    onExtensionComments: handleExtensionComments,
    onExtensionProducts: handleExtensionProducts,
    onExtensionActivities: handleExtensionActivities,
    onExtensionTraffic: handleExtensionTraffic,
    onExtensionConnected: (data) => {
      setExtensionConnected(true);
    },
    onExtensionDisconnected: () => {
      setExtensionConnected(false);
    },
    onError: (err) => {
      if (isPrimary) setError('接続が切断されました。再接続中...');
    },
  });

  // Connect SSE (primary + optional extension)
  useEffect(() => {
    if (!videoId) return;

    setLoadStep(0);
    if (liveUrl) {
      VideoService.startLiveMonitor(videoId, liveUrl)
        .then(() => setLoadStep(1))
        .catch(() => setLoadStep(1));
    } else {
      setLoadStep(1);
    }

    setTimeout(() => setLoadStep(2), 3000);

    // Primary SSE connection
    sseRef.current = VideoService.streamLiveEvents({
      videoId,
      ...createSseHandlers(true),
    });

    // If we have a separate extension video_id, connect to that too
    // This handles the case where bridge is not working
    if (extensionVideoId && extensionVideoId !== videoId) {
      extSseRef.current = VideoService.streamLiveEvents({
        videoId: extensionVideoId,
        ...createSseHandlers(false),
      });
    }

    setIsConnected(true);

    const metricsTimer = setTimeout(() => {
      setLoadStep(prev => (prev < 4 ? 4 : prev));
    }, 8000);

    return () => {
      if (sseRef.current) sseRef.current.close();
      if (extSseRef.current) extSseRef.current.close();
      clearTimeout(metricsTimer);
    };
  }, [videoId, extensionVideoId, liveUrl]);

  // Show dashboard after metrics arrive OR after loadStep reaches 4 (8 seconds timeout)
  // This prevents being stuck on loading screen when extension data hasn't arrived yet
  const showDashboard = loadStep >= 4 || metricsReceived;
  const hasExtensionData = extensionConnected || extensionComments.length > 0 || extensionProducts.length > 0 || Object.keys(extensionMetrics).length > 1;

  // Get display values from extension metrics AND worker metrics
  // Chrome extension sends keys like: gmv, current_viewers, impressions, tap_through_rate, etc.
  // Workbench also sends: items_sold, views, show_gpm, comment_rate, follow_rate, etc.
  // Worker sends: viewer_count, total_comments, total_likes, total_shares, total_gifts
  const em = extensionMetrics;
  const wm = metrics; // worker metrics
  const getMetric = (...keys) => {
    for (const key of keys) {
      const val = em[key];
      if (val !== undefined && val !== null && val !== '' && val !== '0' && val !== 0) return val;
    }
    return null; // Return null instead of '--' so we can try worker fallback
  };

  // Helper: format percentage
  const fmtPct = (val) => val !== null && val !== undefined ? `${val.toFixed(2)}%` : null;

  // Compute rates from worker metrics as fallback
  const viewerCount = wm.viewer_count || 0;
  const workerCommentRate = viewerCount > 0 ? fmtPct((wm.comment_count / viewerCount) * 100) : null;
  const workerShareRate = viewerCount > 0 ? fmtPct((wm.share_count / viewerCount) * 100) : null;
  const workerLikeRate = viewerCount > 0 ? fmtPct((wm.like_count / viewerCount) * 100) : null;

  // Format GMV with yen symbol and proper formatting
  const rawGMV = em.gmv || em.GMV || '';
  const displayGMV = (() => {
    if (!rawGMV) return '¥0';
    // If already formatted with 万円, return as-is
    if (String(rawGMV).includes('万')) return rawGMV;
    // Parse numeric value
    const numVal = parseMetricNumber(String(rawGMV));
    if (numVal >= 10000) {
      return `${(numVal / 10000).toFixed(1)}万円`;
    }
    // Format with comma separator
    return `¥${numVal.toLocaleString()}`;
  })();
  const displayViewers = em.current_viewers || em['Current viewers'] || em['\u8996\u8074\u8005\u6570'] || formatLargeNum(wm.viewer_count);
  const displayImpressions = getMetric('impressions', 'Impressions', 'LIVE impression', 'LIVE impressions', 'LIVE\u306e\u30a4\u30f3\u30d7\u30ec\u30c3\u30b7\u30e7\u30f3') || '--';
  const displayItemsSold = em.items_sold || em['Items sold'] || em['\u8ca9\u58f2\u6570'] || '0';
  const displayProductClicks = getMetric('product_clicks', 'Product clicks', '\u5546\u54c1\u30af\u30ea\u30c3\u30af\u6570') || '--';
  const displayTTR = getMetric('tap_through_rate', 'Tap-through rate', 'TRR', 'trr', '\u30bf\u30c3\u30d7\u30b9\u30eb\u30fc\u7387') || '--';
  const displayAvgDuration = getMetric('avg_duration', 'Avg. viewing duration', 'Avg. viewing duration per view', 'Avg. duration', '\u5e73\u5747\u8996\u8074\u6642\u9593') || '--';
  const displayLiveCTR = getMetric('live_ctr', 'LIVE CTR') || '--';
  const displayCommentRate = getMetric('comment_rate', 'Comment rate', 'コメント率') || workerCommentRate || '--';
  // Follow rate may contain concatenated values like "0.03%86.83%"
  const rawFollowRate = getMetric('follow_rate', 'Follow rate', 'フォロー率');
  const displayFollowRate = (() => {
    if (!rawFollowRate) return '--';
    const str = String(rawFollowRate);
    // Check for concatenated percentages like "0.03%86.83%"
    const matches = str.match(/(\d+\.?\d*%)/g);
    if (matches && matches.length >= 2) {
      return matches[0]; // Use only the first value
    }
    return str;
  })();
  const displayOrderRate = getMetric('order_rate', 'Order rate (SKU orders)', '注文率') || '--';
  const displayShareRate = getMetric('share_rate', 'Share rate', 'シェア率') || workerShareRate || '--';
  const displayLikeRate = getMetric('like_rate', 'Like rate', 'いいね率') || workerLikeRate || '--';
  const displayGPM = getMetric('gpm', 'show_gpm', 'Show GPM', '表示GPM') || '--';

  // ─── RENDER ─────────────────────────────────────────────
  if (!showDashboard) {
    return (
      <div className="fixed inset-0 bg-[#0E0E10] z-50 flex items-center justify-center">
        <div className="text-center w-80">
          <div className="w-20 h-20 rounded-full bg-gradient-to-r from-[#FF0050] to-[#00F2EA] flex items-center justify-center mx-auto mb-5 animate-pulse shadow-lg shadow-pink-500/30">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <p className="text-white text-2xl font-bold mb-2">{loadProgress}%</p>
          <p className="text-gray-300 text-sm mb-4">{loadSteps[loadStep]?.label || '準備中...'}</p>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FF0050] to-[#00F2EA] transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <div className="space-y-2 text-left">
            {loadSteps.slice(0, -1).map((step, i) => (
              <div key={i} className={`flex items-center gap-2 text-xs transition-all ${i <= loadStep ? 'text-gray-300' : 'text-gray-600'}`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                  i < loadStep ? 'bg-green-500 text-white' : i === loadStep ? 'bg-gradient-to-r from-[#FF0050] to-[#00F2EA] text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                }`}>
                  {i < loadStep ? '✓' : i + 1}
                </span>
                <span>{step.label.replace('...', '')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0E0E10] z-50 flex flex-col overflow-hidden">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#18181B] border-b border-gray-800/50 shrink-0">
        <div className="flex items-center gap-3">
          {/* LIVE badge */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className={`w-8 h-8 rounded-full ${streamEnded ? 'bg-gray-600' : 'bg-gradient-to-br from-[#FF0050] to-[#FF0050]'} flex items-center justify-center`}>
                <span className="text-white text-[10px] font-bold">LIVE</span>
              </div>
              {!streamEnded && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75"></span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm">@{extensionAccount || username}</span>
                {title && <span className="text-gray-500 text-xs hidden lg:inline">| {title}</span>}
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-400 font-mono">{formatTime(elapsedTime)}</span>
                <span className="text-gray-600">|</span>
                <span className={`${streamEnded ? 'text-gray-500' : 'text-green-400'}`}>
                  {streamEnded ? 'ライブ終了' : '配信中'}
                </span>
              </div>
            </div>
          </div>

          {/* Extension status */}
          <ExtensionStatusBadge
            isConnected={extensionConnected}
            source={extensionSource}
            account={extensionAccount}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Quick stats in header */}
          <div className="hidden md:flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              <span className="text-gray-400">視聴者</span>
              <span className="text-white font-bold">{displayViewers}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="text-gray-400">GMV</span>
              <span className="text-white font-bold">{displayGMV}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1.5 hover:bg-gray-700/50 rounded-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      {/* ═══ MAIN CONTENT - 3 Column Layout ═══ */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ═══ LEFT COLUMN - Analytics ═══ */}
        <div className="w-72 xl:w-80 flex flex-col bg-[#18181B] border-r border-gray-800/50 overflow-y-auto shrink-0">

          {/* Viewer Source */}
          <div className="p-3 border-b border-gray-800/30">
            <h3 className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00F2EA" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              トラフィックソース
            </h3>
            {extensionTraffic.length > 0 ? (
              <div className="flex items-start gap-3">
                <DonutChart data={extensionTraffic} size={90} />
                <div className="flex-1 space-y-1.5">
                  {extensionTraffic.slice(0, 5).map((source, idx) => {
                    const colors = ['#00F2EA', '#FF0050', '#7D01FF', '#FFD93D', '#4ADE80'];
                    return (
                      <div key={source.name || idx} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors[idx % colors.length] }} />
                        <span className="text-[10px] text-gray-400 truncate flex-1">{source.name}</span>
                        <span className="text-[10px] text-white font-medium">{(source.percentage || 0).toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-[10px] text-gray-500">トラフィックデータ待ち...</p>
              </div>
            )}
          </div>

          {/* Performance Trends */}
          <div className="p-3 border-b border-gray-800/30">
            <h3 className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7D01FF" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              パフォーマンストレンド
            </h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">視聴者数</span>
                  <span className="text-[10px] text-white font-medium">{displayViewers}</span>
                </div>
                <Sparkline data={metricsHistory.viewers.length > 1 ? metricsHistory.viewers : [0, 0]} color="#FF0050" height={40} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">コメント/分</span>
                  <span className="text-[10px] text-white font-medium">{metricsHistory.comments.length > 0 ? metricsHistory.comments[metricsHistory.comments.length - 1] : 0}</span>
                </div>
                <Sparkline data={metricsHistory.comments.length > 1 ? metricsHistory.comments : [0, 0]} color="#00F2EA" height={40} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">いいね</span>
                  <span className="text-[10px] text-white font-medium">{formatLargeNum(metrics.like_count)}</span>
                </div>
                <Sparkline data={metricsHistory.likes.length > 1 ? metricsHistory.likes : [0, 0]} color="#FF6B6B" height={40} />
              </div>
            </div>
          </div>

          {/* Conversion Funnel */}
          <div className="p-3">
            <h3 className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFD93D" strokeWidth="2"><path d="M22 4L2 4l8 8v6l4 2v-8l8-8z"/></svg>
              コンバージョン
            </h3>
            <ConversionFunnel metrics={{
              impressions: displayImpressions,
              views: displayViewers,
              product_clicks: displayProductClicks,
              orders: displayItemsSold,
            }} />
          </div>
        </div>

        {/* ═══ CENTER COLUMN - GMV & Metrics & Products ═══ */}
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0">

          {/* GMV Hero Section */}
          <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] p-4 border-b border-gray-800/30">
            <div className="text-center mb-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Direct GMV (売上)</p>
              <p className="text-4xl xl:text-5xl font-black text-white tracking-tight">{displayGMV}</p>
              <div className="flex items-center justify-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-xs text-gray-400">販売数</span>
                  <span className="text-xs text-white font-bold">{displayItemsSold}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-xs text-gray-400">視聴者</span>
                  <span className="text-xs text-white font-bold">{displayViewers}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="p-3 border-b border-gray-800/30">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              <MetricTile label="インプレッション" value={displayImpressions} />
              <MetricTile label="商品クリック" value={displayProductClicks} />
              <MetricTile label="タップスルー率" value={displayTTR} />
              <MetricTile label="平均視聴時間" value={displayAvgDuration} />
              <MetricTile label="LIVE CTR" value={displayLiveCTR} />
              <MetricTile label="コメント率" value={displayCommentRate} />
              <MetricTile label="フォロー率" value={displayFollowRate} />
              <MetricTile label="表示GPM" value={displayGPM} />
              <MetricTile label="注文率" value={displayOrderRate} small />
              <MetricTile label="シェア率" value={displayShareRate} small />
              <MetricTile label="いいね率" value={displayLikeRate} small />
            </div>
          </div>

          {/* Product List */}
          <div className="flex-1 p-3 min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                商品リスト
                {extensionProducts.length > 0 && (
                  <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full">{extensionProducts.length}件</span>
                )}
              </h3>
            </div>

            {extensionProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-gray-500 border-b border-gray-800/30">
                      <th className="text-left py-1.5 px-2 font-medium">#</th>
                      <th className="text-left py-1.5 px-2 font-medium">商品</th>
                      <th className="text-right py-1.5 px-2 font-medium">インプレッション</th>
                      <th className="text-right py-1.5 px-2 font-medium">CTR</th>
                      <th className="text-right py-1.5 px-2 font-medium">注文数</th>
                      <th className="text-center py-1.5 px-2 font-medium">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extensionProducts.map((product, idx) => (
                      <tr key={product.id || idx} className="border-b border-gray-800/20 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2 px-2">
                          <span className={`text-[10px] font-bold ${idx < 3 ? 'text-yellow-400' : 'text-gray-500'}`}>{idx + 1}</span>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            {product.image ? (
                              <img src={product.image} alt="" className="w-8 h-8 rounded object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center">
                                <span className="text-[10px] text-gray-500">📦</span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-[11px] text-gray-200 truncate max-w-[200px]">{product.name || '商品名不明'}</p>
                              <p className="text-[10px] text-red-400 font-medium">{product.price || ''}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right text-[11px] text-gray-300">{product.impressions || '--'}</td>
                        <td className="py-2 px-2 text-right text-[11px] text-gray-300">{product.ctr || '--'}</td>
                        <td className="py-2 px-2 text-right text-[11px] text-gray-300">{product.sold || product.orders || '0'}</td>
                        <td className="py-2 px-2 text-center">
                          {(product.isPinned || product.pinned) ? (
                            <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">PIN</span>
                          ) : (
                            <span className="text-[9px] text-gray-600">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                </div>
                <p className="text-xs text-gray-500">商品データを受信中...</p>
                <p className="text-[10px] text-gray-600 mt-1">Chrome拡張から商品リストが送信されます</p>
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT COLUMN - LIVE Preview + Comments/Chat + AI ═══ */}
        <div className="w-80 xl:w-96 flex flex-col bg-[#18181B] border-l border-gray-800/50 shrink-0 overflow-hidden">

          {/* LIVE Video Preview */}
          <div className="h-48 xl:h-56 bg-black shrink-0 relative">
            {streamUrl ? (
              <HLSVideoPlayer streamUrl={streamUrl} username={username} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FF0050]/20 to-[#00F2EA]/20 flex items-center justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                </div>
                <p className="text-gray-500 text-[10px]">LIVE映像</p>
                <a
                  href={`https://www.tiktok.com/@${extensionAccount || username}/live`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  TikTokで視聴
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
            )}
            {/* Overlay: viewer count */}
            <div className="absolute top-2 left-2 flex gap-1.5 z-10">
              <div className="bg-black/70 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                <span className="text-white text-[10px] font-bold">{displayViewers}</span>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-800/50 shrink-0">
            {[
              { id: 'ai', label: 'AI', icon: '🤖' },
              { id: 'comments', label: 'コメント', icon: '💬', count: extensionComments.length },
              { id: 'products', label: '商品', icon: '🛍️' },
              { id: 'activity', label: 'アクティビティ', icon: '⚡' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 py-2 text-[10px] font-medium transition-colors relative ${
                  rightTab === tab.id
                    ? 'text-cyan-400 border-b-2 border-cyan-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span>{tab.icon}</span>
                <span className="ml-0.5">{tab.label}</span>
                {tab.count > 0 && (
                  <span className="absolute top-0.5 right-1 text-[8px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center">
                    {tab.count > 99 ? '99+' : tab.count > 9 ? '9+' : tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden min-h-0">
            {rightTab === 'ai' && (
              <AIChatPanel
                videoId={videoId}
                metrics={extensionMetrics}
                advices={advices}
                newAdviceId={newAdviceId}
              />
            )}
            {rightTab === 'comments' && (
              <div className="h-full bg-gray-900">
                <CommentsPanel comments={extensionComments} newCommentIds={newCommentIds} />
              </div>
            )}
            {rightTab === 'products' && (
              <div className="h-full bg-gray-900">
                <ProductsPanel products={extensionProducts} />
              </div>
            )}
            {rightTab === 'activity' && (
              <div className="h-full bg-gray-900">
                <ActivitiesPanel activities={extensionActivities} />
              </div>
            )}
          </div>

          {/* Connection Status */}
          <div className="px-3 py-1.5 bg-[#0E0E10] border-t border-gray-800/50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected && !streamEnded ? 'bg-green-500' : streamEnded ? 'bg-gray-500' : 'bg-red-500'}`}></div>
              <span className="text-[10px] text-gray-500">
                {streamEnded ? 'ライブ終了' : isConnected ? '接続中' : '接続待ち'}
              </span>
            </div>
            {metricsReceived && !streamEnded && (
              <span className="text-[10px] text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                データ受信中
              </span>
            )}
            {error && (
              <span className="text-[10px] text-red-400">{error}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveDashboard;
