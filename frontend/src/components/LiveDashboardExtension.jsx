/**
 * LiveDashboard Extension Components
 * 
 * Additional panels for displaying Chrome extension data:
 * - Comments panel (real-time comments from TikTok Shop LIVE)
 * - Products panel (pinned products, CTR, GMV)
 * - Traffic Sources panel
 * - Extended metrics (GMV, impressions, CTR, etc.)
 * - Activities panel (joins, product views, orders)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Comment Item ─────────────────────────────────────────────
const CommentItem = ({ comment, isNew }) => {
  const badgeColors = {
    '1位': 'bg-yellow-500',
    '2位': 'bg-gray-400',
    '3位': 'bg-orange-600',
  };

  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded-lg transition-all duration-500 ${
      isNew ? 'bg-purple-50 ring-1 ring-purple-200' : 'hover:bg-gray-50'
    }`}>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center flex-shrink-0">
        <span className="text-white text-[10px] font-bold">
          {(comment.username || '?')[0].toUpperCase()}
        </span>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-gray-700 truncate max-w-[100px]">
            {comment.username || '匿名'}
          </span>
          {comment.badge && (
            <span className={`text-[8px] text-white px-1 py-0.5 rounded ${badgeColors[comment.badge] || 'bg-blue-500'}`}>
              {comment.badge}
            </span>
          )}
          <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0">
            {comment.time || ''}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-0.5 break-words">{comment.text}</p>
      </div>
    </div>
  );
};

// ─── Comments Panel ───────────────────────────────────────────
export const CommentsPanel = ({ comments = [], newCommentIds = new Set() }) => {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'product'

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [comments.length, autoScroll]);

  const filteredComments = filter === 'product'
    ? comments.filter(c => c.isProductRelated)
    : comments;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800">💬 コメント</span>
          <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">
            {comments.length}件
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              filter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            すべて
          </button>
          <button
            onClick={() => setFilter('product')}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              filter === 'product' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            商品関連
          </button>
        </div>
      </div>

      {/* Comments List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-1.5 space-y-0.5"
        onScroll={(e) => {
          const { scrollTop } = e.target;
          setAutoScroll(scrollTop < 10);
        }}
      >
        {filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-2xl mb-2">💬</span>
            <p className="text-xs text-gray-400">コメントを受信中...</p>
            <p className="text-[10px] text-gray-300 mt-1">
              Chrome拡張が接続されると<br/>リアルタイムで表示されます
            </p>
          </div>
        ) : (
          filteredComments.map((comment, idx) => (
            <CommentItem
              key={comment.id || idx}
              comment={comment}
              isNew={newCommentIds.has(comment.id)}
            />
          ))
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && comments.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }}
          className="mx-2 mb-2 py-1 bg-purple-500 text-white text-[10px] rounded-full text-center hover:bg-purple-600 transition-colors"
        >
          ↑ 最新コメントに戻る
        </button>
      )}
    </div>
  );
};


// ─── Product Item ─────────────────────────────────────────────
const ProductItem = ({ product, rank }) => {
  const isPinned = product.isPinned || product.pinned;
  
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
      isPinned ? 'border-orange-300 bg-orange-50' : 'border-gray-100 bg-white hover:bg-gray-50'
    }`}>
      {/* Rank */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
        rank <= 3 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white' : 'bg-gray-100 text-gray-500'
      }`}>
        {rank}
      </div>

      {/* Product Image */}
      {product.image ? (
        <img src={product.image} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center flex-shrink-0">
          <span className="text-gray-400 text-xs">📦</span>
        </div>
      )}

      {/* Product Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isPinned && (
            <span className="text-[8px] bg-orange-500 text-white px-1 py-0.5 rounded">📌 PIN</span>
          )}
          <p className="text-[11px] font-medium text-gray-800 truncate">{product.name || '商品名不明'}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] font-bold text-red-600">{product.price || ''}</span>
          {product.rating && (
            <span className="text-[9px] text-yellow-600">★{product.rating}</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="text-right flex-shrink-0">
        {product.sold !== undefined && (
          <p className="text-[10px] text-gray-500">{product.sold}個販売</p>
        )}
        {product.clicks !== undefined && (
          <p className="text-[10px] text-blue-500">{product.clicks}クリック</p>
        )}
        {product.ctr && (
          <p className="text-[10px] text-green-600">CTR {product.ctr}</p>
        )}
      </div>
    </div>
  );
};

// ─── Products Panel ───────────────────────────────────────────
export const ProductsPanel = ({ products = [] }) => {
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'clicks' | 'sold' | 'ctr'

  const sortedProducts = [...products].sort((a, b) => {
    if (sortBy === 'clicks') return (b.clicks || 0) - (a.clicks || 0);
    if (sortBy === 'sold') return (b.sold || 0) - (a.sold || 0);
    if (sortBy === 'ctr') return parseFloat(b.ctr || '0') - parseFloat(a.ctr || '0');
    // Default: pinned first, then by order
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800">🛍️ 商品</span>
          <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-full">
            {products.length}件
          </span>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="text-[10px] bg-gray-100 border-0 rounded-full px-2 py-0.5 text-gray-600"
        >
          <option value="default">デフォルト</option>
          <option value="clicks">クリック順</option>
          <option value="sold">販売数順</option>
          <option value="ctr">CTR順</option>
        </select>
      </div>

      {/* Products List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-2xl mb-2">🛍️</span>
            <p className="text-xs text-gray-400">商品データを受信中...</p>
            <p className="text-[10px] text-gray-300 mt-1">
              ピン留め商品や商品リストが<br/>ここに表示されます
            </p>
          </div>
        ) : (
          sortedProducts.map((product, idx) => (
            <ProductItem key={product.id || idx} product={product} rank={idx + 1} />
          ))
        )}
      </div>
    </div>
  );
};


// ─── Traffic Source Bar ───────────────────────────────────────
const TrafficSourceBar = ({ source, percentage, color }) => (
  <div className="flex items-center gap-2 py-1">
    <span className="text-[10px] text-gray-600 w-20 truncate">{source}</span>
    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-1000 ${color}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
    <span className="text-[10px] font-semibold text-gray-700 w-12 text-right">
      {percentage.toFixed(1)}%
    </span>
  </div>
);

// ─── Traffic Sources Panel ────────────────────────────────────
export const TrafficSourcesPanel = ({ trafficSources = [] }) => {
  const colors = [
    'bg-gradient-to-r from-blue-500 to-blue-400',
    'bg-gradient-to-r from-purple-500 to-purple-400',
    'bg-gradient-to-r from-green-500 to-green-400',
    'bg-gradient-to-r from-orange-500 to-orange-400',
    'bg-gradient-to-r from-pink-500 to-pink-400',
    'bg-gradient-to-r from-cyan-500 to-cyan-400',
    'bg-gradient-to-r from-yellow-500 to-yellow-400',
    'bg-gradient-to-r from-red-500 to-red-400',
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 bg-white shrink-0">
        <span className="text-sm font-bold text-gray-800">📊 トラフィックソース</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {trafficSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-2xl mb-2">📊</span>
            <p className="text-xs text-gray-400">トラフィックデータを受信中...</p>
          </div>
        ) : (
          <div className="space-y-1">
            {trafficSources.map((source, idx) => (
              <TrafficSourceBar
                key={source.name || idx}
                source={source.name}
                percentage={source.percentage || 0}
                color={colors[idx % colors.length]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};


// ─── Activity Item ────────────────────────────────────────────
const ActivityItem = ({ activity }) => {
  const typeConfig = {
    join: { icon: '👋', color: 'text-blue-500', label: '参加' },
    product_view: { icon: '👀', color: 'text-orange-500', label: '商品閲覧' },
    order: { icon: '🛒', color: 'text-green-600', label: '注文' },
    follow: { icon: '➕', color: 'text-purple-500', label: 'フォロー' },
    share: { icon: '📤', color: 'text-cyan-500', label: 'シェア' },
    gift: { icon: '🎁', color: 'text-pink-500', label: 'ギフト' },
    default: { icon: '📌', color: 'text-gray-500', label: '' },
  };

  const config = typeConfig[activity.type] || typeConfig.default;

  return (
    <div className="flex items-center gap-2 py-1 px-2 text-[11px]">
      <span>{config.icon}</span>
      <span className={`font-medium ${config.color}`}>{activity.username || ''}</span>
      <span className="text-gray-500 truncate flex-1">{activity.text || config.label}</span>
      <span className="text-[9px] text-gray-400 flex-shrink-0">{activity.time || ''}</span>
    </div>
  );
};

// ─── Activities Panel ─────────────────────────────────────────
export const ActivitiesPanel = ({ activities = [] }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activities.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold text-gray-800">⚡ アクティビティ</span>
        <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full">
          {activities.length}件
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <span className="text-2xl mb-2">⚡</span>
            <p className="text-xs text-gray-400">アクティビティを受信中...</p>
          </div>
        ) : (
          activities.map((activity, idx) => (
            <ActivityItem key={activity.id || idx} activity={activity} />
          ))
        )}
      </div>
    </div>
  );
};


// ─── Extended Metrics Panel (GMV, Impressions, CTR, etc.) ─────
export const ExtendedMetricsPanel = ({ metrics = {} }) => {
  const metricItems = [
    { key: 'gmv', label: 'GMV (売上)', icon: '💰', format: (v) => `¥${(v || 0).toLocaleString()}`, color: 'from-green-500 to-emerald-500' },
    { key: 'impressions', label: 'インプレッション', icon: '👁', format: (v) => formatLargeNum(v), color: 'from-blue-500 to-cyan-500' },
    { key: 'current_viewers', label: '現在の視聴者', icon: '👥', format: (v) => formatLargeNum(v), color: 'from-red-500 to-pink-500' },
    { key: 'items_sold', label: '販売数', icon: '📦', format: (v) => String(v || 0), color: 'from-orange-500 to-amber-500' },
    { key: 'product_clicks', label: '商品クリック', icon: '🖱️', format: (v) => formatLargeNum(v), color: 'from-purple-500 to-violet-500' },
    { key: 'tap_through_rate', label: 'タップスルー率', icon: '📈', format: (v) => v ? `${v}` : '--', color: 'from-teal-500 to-cyan-500' },
    { key: 'avg_duration', label: '平均視聴時間', icon: '⏱️', format: (v) => v || '--', color: 'from-indigo-500 to-blue-500' },
    { key: 'live_ctr', label: 'LIVE CTR', icon: '🎯', format: (v) => v ? `${v}` : '--', color: 'from-pink-500 to-rose-500' },
    { key: 'comment_rate', label: 'コメント率', icon: '💬', format: (v) => v ? `${v}` : '--', color: 'from-sky-500 to-blue-500' },
    { key: 'follow_rate', label: 'フォロー率', icon: '➕', format: (v) => v ? `${v}` : '--', color: 'from-violet-500 to-purple-500' },
  ];

  return (
    <div className="grid grid-cols-2 gap-1.5 p-2">
      {metricItems.map(item => {
        const value = metrics[item.key];
        if (value === undefined && !metrics.gmv) return null; // Don't show if no extension data
        return (
          <div key={item.key} className="bg-white rounded-lg border border-gray-100 p-2 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-gray-500">{item.label}</span>
              <div className={`w-5 h-5 rounded bg-gradient-to-r ${item.color} flex items-center justify-center`}>
                <span className="text-[10px]">{item.icon}</span>
              </div>
            </div>
            <div className="text-sm font-bold text-gray-900">{item.format(value)}</div>
          </div>
        );
      }).filter(Boolean)}
    </div>
  );
};


// ─── Extension Connection Status Badge ────────────────────────
export const ExtensionStatusBadge = ({ isConnected, source, account }) => {
  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-full px-3 py-1">
      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      <span className="text-[10px] font-medium text-emerald-700">
        Chrome拡張接続中
      </span>
      {source && (
        <span className="text-[9px] text-emerald-500">
          ({source === 'streamer' ? 'LIVE Manager' : 'Dashboard'})
        </span>
      )}
      {account && (
        <span className="text-[9px] text-emerald-500">@{account}</span>
      )}
    </div>
  );
};


// ─── Tab Switcher for Right Panel ─────────────────────────────
export const PanelTabs = ({ activeTab, onTabChange, hasExtensionData }) => {
  const tabs = [
    { id: 'advice', label: 'AI提案', icon: '🤖' },
    { id: 'comments', label: 'コメント', icon: '💬', requiresExtension: true },
    { id: 'products', label: '商品', icon: '🛍️', requiresExtension: true },
    { id: 'traffic', label: 'トラフィック', icon: '📊', requiresExtension: true },
    { id: 'activity', label: 'アクティビティ', icon: '⚡', requiresExtension: true },
  ];

  return (
    <div className="flex border-b border-gray-200 bg-white px-1 shrink-0 overflow-x-auto">
      {tabs.map(tab => {
        // Show extension tabs only if extension data is available
        if (tab.requiresExtension && !hasExtensionData) return null;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-purple-500 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};


// ─── Helper ───────────────────────────────────────────────────
function formatLargeNum(n) {
  if (!n && n !== 0) return '--';
  if (typeof n === 'string') {
    // Already formatted (e.g., "15.2K")
    return n;
  }
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
