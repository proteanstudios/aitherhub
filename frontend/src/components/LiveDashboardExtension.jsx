/**
 * LiveDashboard Extension Components (Dark Theme)
 * 
 * Additional panels for displaying Chrome extension data:
 * - Comments panel (real-time comments from TikTok Shop LIVE)
 * - Products panel (pinned products, CTR, GMV)
 * - Traffic Sources panel
 * - Activities panel (joins, product views, orders)
 * - Extension status badge
 */

import React, { useState, useEffect, useRef } from 'react';

// ─── Comment Item ─────────────────────────────────────────────
const CommentItem = ({ comment, isNew }) => {
  const badgeColors = {
    '1位': 'bg-yellow-500',
    '2位': 'bg-gray-400',
    '3位': 'bg-orange-600',
  };

  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded-lg transition-all duration-500 ${
      isNew ? 'bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'hover:bg-gray-800/50'
    }`}>
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white text-[9px] font-bold">
          {(comment.username || '?')[0].toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-gray-300 truncate max-w-[100px]">
            {comment.username || '匿名'}
          </span>
          {comment.badge && (
            <span className={`text-[8px] text-white px-1 py-0.5 rounded ${badgeColors[comment.badge] || 'bg-blue-500'}`}>
              {comment.badge}
            </span>
          )}
          <span className="text-[9px] text-gray-600 ml-auto flex-shrink-0">
            {comment.time || ''}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5 break-words">{comment.text}</p>
      </div>
    </div>
  );
};

// ─── Comments Panel ───────────────────────────────────────────
export const CommentsPanel = ({ comments = [], newCommentIds = new Set() }) => {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all');

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
      <div className="px-3 py-2 border-b border-gray-800/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300">コメント</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-[9px] px-1.5 py-0.5 rounded-full">
            {comments.length}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
              filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            すべて
          </button>
          <button
            onClick={() => setFilter('product')}
            className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
              filter === 'product' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            商品関連
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-1.5 space-y-0.5"
        onScroll={(e) => setAutoScroll(e.target.scrollTop < 10)}
      >
        {filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-gray-500">コメントを受信中...</p>
            <p className="text-[10px] text-gray-600 mt-1">
              Chrome拡張が接続されると表示されます
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

      {!autoScroll && comments.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }}
          className="mx-2 mb-2 py-1 bg-cyan-600 text-white text-[10px] rounded-full text-center hover:bg-cyan-500 transition-colors"
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
      isPinned ? 'border-orange-500/30 bg-orange-500/5' : 'border-gray-800/30 hover:bg-gray-800/30'
    }`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
        rank <= 3 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white' : 'bg-gray-800 text-gray-500'
      }`}>
        {rank}
      </div>

      {product.image && String(product.image).startsWith('http') ? (
        <img src={product.image} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex'); }} />
      ) : null}
      <div className={`w-9 h-9 rounded bg-gray-800 flex items-center justify-center flex-shrink-0 ${product.image && String(product.image).startsWith('http') ? 'hidden' : ''}`}>
        <span className="text-gray-600 text-[10px]">📦</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isPinned && (
            <span className="text-[8px] bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded">PIN</span>
          )}
          <p className="text-[10px] text-gray-300 truncate">{product.name || '商品名不明'}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-bold text-red-400">{product.price || ''}</span>
          {product.rating && (
            <span className="text-[9px] text-yellow-500">★{product.rating}</span>
          )}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        {product.sold !== undefined && (
          <p className="text-[9px] text-gray-500">{product.sold}個</p>
        )}
        {product.clicks !== undefined && (
          <p className="text-[9px] text-cyan-400">{product.clicks}click</p>
        )}
      </div>
    </div>
  );
};

// ─── Products Panel ───────────────────────────────────────────
export const ProductsPanel = ({ products = [] }) => {
  const [sortBy, setSortBy] = useState('default');

  const sortedProducts = [...products].sort((a, b) => {
    if (sortBy === 'clicks') return (b.clicks || 0) - (a.clicks || 0);
    if (sortBy === 'sold') return (b.sold || 0) - (a.sold || 0);
    if (sortBy === 'ctr') return parseFloat(b.ctr || '0') - parseFloat(a.ctr || '0');
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300">商品</span>
          <span className="bg-orange-500/20 text-orange-400 text-[9px] px-1.5 py-0.5 rounded-full">
            {products.length}
          </span>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="text-[9px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400"
        >
          <option value="default">デフォルト</option>
          <option value="clicks">クリック順</option>
          <option value="sold">販売数順</option>
          <option value="ctr">CTR順</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-gray-500">商品データを受信中...</p>
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


// ─── Traffic Sources Panel ────────────────────────────────────
export const TrafficSourcesPanel = ({ trafficSources = [] }) => {
  const colors = [
    'bg-gradient-to-r from-cyan-500 to-cyan-400',
    'bg-gradient-to-r from-pink-500 to-pink-400',
    'bg-gradient-to-r from-purple-500 to-purple-400',
    'bg-gradient-to-r from-yellow-500 to-yellow-400',
    'bg-gradient-to-r from-green-500 to-green-400',
    'bg-gradient-to-r from-orange-500 to-orange-400',
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800/30 shrink-0">
        <span className="text-xs font-semibold text-gray-300">トラフィックソース</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {trafficSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-gray-500">トラフィックデータを受信中...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trafficSources.map((source, idx) => (
              <div key={source.name || idx} className="flex items-center gap-2 py-1">
                <span className="text-[10px] text-gray-400 w-20 truncate">{source.name}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${colors[idx % colors.length]}`}
                    style={{ width: `${Math.min(source.percentage || 0, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium text-gray-300 w-12 text-right">
                  {(source.percentage || 0).toFixed(1)}%
                </span>
              </div>
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
    join: { icon: '👋', color: 'text-blue-400', label: '参加' },
    product_view: { icon: '👀', color: 'text-orange-400', label: '商品閲覧' },
    order: { icon: '🛒', color: 'text-green-400', label: '注文' },
    follow: { icon: '➕', color: 'text-purple-400', label: 'フォロー' },
    share: { icon: '📤', color: 'text-cyan-400', label: 'シェア' },
    gift: { icon: '🎁', color: 'text-pink-400', label: 'ギフト' },
    default: { icon: '📌', color: 'text-gray-400', label: '' },
  };

  const config = typeConfig[activity.type] || typeConfig.default;

  return (
    <div className="flex items-center gap-2 py-1 px-2 text-[10px]">
      <span>{config.icon}</span>
      <span className={`font-medium ${config.color}`}>{activity.username || ''}</span>
      <span className="text-gray-500 truncate flex-1">{activity.text || config.label}</span>
      <span className="text-[9px] text-gray-600 flex-shrink-0">{activity.time || ''}</span>
    </div>
  );
};

// ─── Activities Panel ─────────────────────────────────────────
export const ActivitiesPanel = ({ activities = [] }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activities.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800/30 flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold text-gray-300">アクティビティ</span>
        <span className="bg-green-500/20 text-green-400 text-[9px] px-1.5 py-0.5 rounded-full">
          {activities.length}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-gray-800/20">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-xs text-gray-500">アクティビティを受信中...</p>
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


// ─── Extension Connection Status Badge ────────────────────────
export const ExtensionStatusBadge = ({ isConnected, source, account }) => {
  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <span className="text-[9px] font-medium text-emerald-400">
        Chrome拡張
      </span>
      {source && (
        <span className="text-[8px] text-emerald-500/70">
          ({source === 'streamer' ? 'LIVE Manager' : 'Dashboard'})
        </span>
      )}
    </div>
  );
};


// ─── Helper ───────────────────────────────────────────────────
function formatLargeNum(n) {
  if (!n && n !== 0) return '--';
  if (typeof n === 'string') return n;
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
