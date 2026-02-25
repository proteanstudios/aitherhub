/**
 * AitherHub AI Commander - Overlay Panel for TikTok LIVE Dashboard
 * 
 * Injected into TikTok LIVE Dashboard (workbench + streamer) pages.
 * Provides AI-powered real-time analysis, suggestions, and alerts
 * as a floating overlay panel on top of the existing TikTok UI.
 * 
 * Features:
 * - AI提案: Real-time AI suggestions based on live metrics
 * - コメント: Live comment feed with AI reply suggestions
 * - 商品: Product performance with AI recommendations
 * - トラフィック: Traffic source analysis
 */

(function() {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================
  const AI_ANALYZE_INTERVAL_MS = 30000;  // AI analysis every 30 seconds
  const METRICS_POLL_MS = 3000;          // Poll metrics every 3 seconds
  const COMMENT_POLL_MS = 2000;          // Poll comments every 2 seconds
  const PRODUCT_POLL_MS = 5000;          // Poll products every 5 seconds
  const MAX_DISPLAY_COMMENTS = 100;
  const MAX_AI_SUGGESTIONS = 20;
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[AitherHub Commander]', ...args);
  }

  // ============================================================
  // State
  // ============================================================
  let isExpanded = true;
  let activeTab = 'ai';
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let pollTimers = [];
  let aiSuggestions = [];
  let comments = [];
  let products = [];
  let trafficSources = [];
  let currentMetrics = {};
  let previousMetrics = {};
  let metricsHistory = [];
  let seenCommentIds = new Set();
  let lastAiAnalysis = 0;
  let isAnalyzing = false;
  let panelElement = null;

  // ============================================================
  // Panel Creation
  // ============================================================
  function createPanel() {
    if (document.getElementById('aitherhub-commander')) return;

    const panel = document.createElement('div');
    panel.id = 'aitherhub-commander';
    panel.innerHTML = `
      <div class="ahub-panel">
        <!-- Header -->
        <div class="ahub-header" id="ahub-drag-handle">
          <div class="ahub-header-left">
            <div class="ahub-logo">AI</div>
            <div>
              <div class="ahub-title">AitherHub 司令塔</div>
              <div class="ahub-subtitle">LIVE AI アシスタント</div>
            </div>
          </div>
          <div class="ahub-header-actions">
            <button class="ahub-header-btn" id="ahub-refresh-btn" title="データ更新">↻</button>
            <button class="ahub-header-btn" id="ahub-minimize-btn" title="最小化">−</button>
          </div>
        </div>

        <!-- Tabs -->
        <div class="ahub-tabs">
          <button class="ahub-tab active" data-tab="ai">
            <span class="ahub-tab-icon">🤖</span>
            AI提案
          </button>
          <button class="ahub-tab" data-tab="comments">
            <span class="ahub-tab-icon">💬</span>
            コメント
          </button>
          <button class="ahub-tab" data-tab="products">
            <span class="ahub-tab-icon">🛍️</span>
            商品
          </button>
          <button class="ahub-tab" data-tab="traffic">
            <span class="ahub-tab-icon">📊</span>
            トラフィック
          </button>
        </div>

        <!-- Content -->
        <div class="ahub-content" id="ahub-content">
          <!-- AI Tab -->
          <div class="ahub-tab-panel active" id="ahub-panel-ai">
            <button class="ahub-analyze-btn" id="ahub-analyze-btn">
              🧠 AIに分析してもらう
            </button>
            <div class="ahub-metrics-mini" id="ahub-metrics-mini">
              <div class="ahub-metric-mini">
                <div class="value" id="ahub-mini-gmv">--</div>
                <div class="label">GMV</div>
              </div>
              <div class="ahub-metric-mini">
                <div class="value" id="ahub-mini-viewers">--</div>
                <div class="label">視聴者</div>
              </div>
              <div class="ahub-metric-mini">
                <div class="value" id="ahub-mini-clicks">--</div>
                <div class="label">商品クリック</div>
              </div>
              <div class="ahub-metric-mini">
                <div class="value" id="ahub-mini-ctr">--</div>
                <div class="label">タップスルー率</div>
              </div>
            </div>
            <div id="ahub-ai-list">
              <div class="ahub-empty">
                <div class="ahub-empty-icon">🤖</div>
                <div class="ahub-empty-text">
                  「AIに分析してもらう」をクリックすると<br>
                  リアルタイムの提案が表示されます
                </div>
              </div>
            </div>
          </div>

          <!-- Comments Tab -->
          <div class="ahub-tab-panel" id="ahub-panel-comments">
            <div class="ahub-section-header">
              <div class="ahub-section-title">
                💬 コメント <span class="ahub-section-count" id="ahub-comment-count">0</span>
              </div>
              <span class="ahub-section-action" id="ahub-comment-filter">すべて</span>
            </div>
            <div id="ahub-comment-list">
              <div class="ahub-empty">
                <div class="ahub-empty-icon">💬</div>
                <div class="ahub-empty-text">
                  コメントを取得中...<br>
                  LIVEが開始されるとコメントが表示されます
                </div>
              </div>
            </div>
          </div>

          <!-- Products Tab -->
          <div class="ahub-tab-panel" id="ahub-panel-products">
            <div class="ahub-section-header">
              <div class="ahub-section-title">
                🛍️ 商品 <span class="ahub-section-count" id="ahub-product-count">0</span>
              </div>
              <span class="ahub-section-action" id="ahub-product-sort">GMV順</span>
            </div>
            <div id="ahub-product-list">
              <div class="ahub-empty">
                <div class="ahub-empty-icon">🛍️</div>
                <div class="ahub-empty-text">
                  商品データを取得中...
                </div>
              </div>
            </div>
          </div>

          <!-- Traffic Tab -->
          <div class="ahub-tab-panel" id="ahub-panel-traffic">
            <div class="ahub-section-header">
              <div class="ahub-section-title">
                📊 トラフィックソース
              </div>
            </div>
            <div id="ahub-traffic-list">
              <div class="ahub-empty">
                <div class="ahub-empty-icon">📊</div>
                <div class="ahub-empty-text">
                  トラフィックデータを取得中...
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ahub-footer">
          <span><span class="ahub-status-dot"></span> 接続中</span>
          <span id="ahub-last-update">--</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    panelElement = panel;

    // Setup event listeners
    setupEventListeners(panel);
    setupDragging(panel);
  }

  // ============================================================
  // Event Listeners
  // ============================================================
  function setupEventListeners(panel) {
    // Tab switching
    panel.querySelectorAll('.ahub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        switchTab(tabId);
      });
    });

    // Minimize button
    panel.querySelector('#ahub-minimize-btn').addEventListener('click', () => {
      togglePanel();
    });

    // Refresh button
    panel.querySelector('#ahub-refresh-btn').addEventListener('click', () => {
      forceRefresh();
    });

    // AI Analyze button
    panel.querySelector('#ahub-analyze-btn').addEventListener('click', () => {
      requestAiAnalysis();
    });
  }

  function switchTab(tabId) {
    activeTab = tabId;
    const panel = panelElement;
    if (!panel) return;

    panel.querySelectorAll('.ahub-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.ahub-tab-panel').forEach(p => p.classList.remove('active'));

    panel.querySelector(`.ahub-tab[data-tab="${tabId}"]`)?.classList.add('active');
    panel.querySelector(`#ahub-panel-${tabId}`)?.classList.add('active');
  }

  function togglePanel() {
    isExpanded = !isExpanded;
    const panel = panelElement;
    if (!panel) return;

    if (isExpanded) {
      panel.classList.remove('collapsed');
      panel.querySelector('.ahub-panel').style.display = '';
    } else {
      // Replace with toggle button
      panel.classList.add('collapsed');
      panel.innerHTML = `
        <button class="ahub-toggle-btn" id="ahub-expand-btn" title="AitherHub 司令塔を開く">
          🤖
          ${aiSuggestions.length > 0 ? `<span class="badge">${aiSuggestions.length}</span>` : ''}
        </button>
      `;
      panel.querySelector('#ahub-expand-btn').addEventListener('click', () => {
        isExpanded = true;
        panel.classList.remove('collapsed');
        createPanel(); // Recreate full panel
        startPolling(); // Restart polling
      });
    }
  }

  // ============================================================
  // Dragging
  // ============================================================
  function setupDragging(panel) {
    const handle = panel.querySelector('#ahub-drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ahub-header-btn')) return;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      panel.style.left = `${Math.max(0, x)}px`;
      panel.style.top = `${Math.max(0, y)}px`;
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
      }
    });
  }

  // ============================================================
  // Data Extraction from TikTok Dashboard DOM
  // (Selectors confirmed against actual TikTok DOM structure)
  // ============================================================
  
  function extractMetricsFromDOM() {
    const metrics = {};
    
    const metricLabels = {
      // English labels (confirmed from actual DOM)
      'GMV': 'gmv',
      'Items sold': 'items_sold',
      'Current viewers': 'current_viewers',
      'Impressions': 'impressions',
      'Views': 'views',
      'GMV per hour': 'gmv_per_hour',
      'Impressions per hour': 'impressions_per_hour',
      'Show GPM': 'show_gpm',
      'Avg. viewing duration per view': 'avg_duration',
      'Comment rate': 'comment_rate',
      'Follow rate': 'follow_rate',
      'Tap-through rate': 'tap_through_rate',
      'Tap-through rate (via LIVE preview)': 'tap_through_preview',
      'LIVE CTR': 'live_ctr',
      'Order rate (SKU orders)': 'order_rate',
      'Share rate': 'share_rate',
      'Like rate': 'like_rate',
      '> 1 min. views': 'views_over_1min',
      // Japanese labels
      'GMV（円）': 'gmv',
      '商品販売数': 'items_sold',
      '現在の視聴者': 'current_viewers',
      'インプレッション数': 'impressions',
      '視聴数': 'views',
      '1時間あたりのGMV': 'gmv_per_hour',
      '1時間あたりのインプレッション数': 'impressions_per_hour',
      '表示GPM': 'show_gpm',
      '視聴1回あたりの平均視聴時間': 'avg_duration',
      'コメント率': 'comment_rate',
      'フォロー率': 'follow_rate',
      'タップスルー率': 'tap_through_rate',
      'タップスルー率（LIVEプレビュー経由）': 'tap_through_preview',
      '注文率（SKU注文数）': 'order_rate',
      'シェア率': 'share_rate',
      'いいね率': 'like_rate',
      '視聴時間が1分を超えた視聴者数': 'views_over_1min',
    };

    // Strategy 1: Workbench page - hero metrics
    // Items sold / Current viewers use: div.text-xl.font-medium.text-neutral-text-1
    const heroLabels = document.querySelectorAll('.text-xl.font-medium.text-neutral-text-1');
    for (const el of heroLabels) {
      const text = el.textContent.trim();
      const key = metricLabels[text];
      if (key) {
        const valueEl = el.nextElementSibling;
        if (valueEl) {
          metrics[key] = valueEl.textContent.trim();
        }
      }
    }

    // Strategy 2: Workbench page - detail metrics
    // Label: div.text-base.text-neutral-text-1.truncate
    // Value: nextElementSibling
    const detailLabels = document.querySelectorAll('.text-base.text-neutral-text-1.truncate');
    for (const el of detailLabels) {
      const text = el.textContent.trim();
      const key = metricLabels[text];
      if (key) {
        const valueEl = el.nextElementSibling;
        if (valueEl) {
          metrics[key] = valueEl.textContent.trim();
        }
      }
    }

    // Strategy 3: Streamer page - metric cards
    // Label: div inside [class*="metricCard"]
    const metricCards = document.querySelectorAll('[class*="metricCard"]');
    for (const card of metricCards) {
      const nameEl = card.querySelector('[class*="name-"]');
      if (nameEl) {
        const label = nameEl.textContent.trim();
        const key = metricLabels[label];
        if (key) {
          const valueEl = nameEl.nextElementSibling;
          if (valueEl) {
            metrics[key] = valueEl.textContent.trim();
          }
        }
      }
    }

    // Strategy 4: Extract GMV (the big number)
    if (!metrics.gmv) {
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent.trim();
        if (text.match(/^GMV\s*(\(.*\))?$/)) {
          const container = span.closest('[class*="flex"][class*="col"]') || span.parentElement?.parentElement;
          if (container) {
            const numberEls = container.querySelectorAll('div, span');
            for (const numEl of numberEls) {
              const numText = numEl.textContent.trim();
              if (/^[\d,]+$/.test(numText) && numText.length > 3 && numEl.children.length === 0) {
                metrics.gmv = numText;
                break;
              }
            }
          }
        }
      }
    }

    // Strategy 5: Fallback - walk all leaf text nodes
    if (Object.keys(metrics).length < 3) {
      const allElements = document.querySelectorAll('div, span');
      for (const el of allElements) {
        if (el.children.length > 4) continue;
        const text = el.textContent.trim();
        
        for (const [label, key] of Object.entries(metricLabels)) {
          if (text === label && !metrics[key]) {
            const parent = el.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children);
              const idx = siblings.indexOf(el);
              
              // Check next sibling
              if (idx < siblings.length - 1) {
                const nextText = siblings[idx + 1].textContent.trim();
                if (nextText && nextText !== label && /[\d,.%KkMm万円sS秒分]/.test(nextText)) {
                  metrics[key] = nextText;
                  continue;
                }
              }
              // Check previous sibling
              if (idx > 0) {
                const prevText = siblings[idx - 1].textContent.trim();
                if (prevText && prevText !== label && /[\d,.%KkMm万円sS秒分]/.test(prevText)) {
                  metrics[key] = prevText;
                }
              }
            }
          }
        }
      }
    }

    if (Object.keys(metrics).length > 0) {
      log('Metrics extracted:', Object.keys(metrics).length, metrics);
    }
    return metrics;
  }

  /**
   * Extract comments from DOM
   * 
   * Confirmed DOM structure:
   * - Container: div[class*="commentContainer--"]
   * - Each comment: div[class*="comment--"] (NOT commentContainer)
   *   - Child 1: span[class*="username--"] (text: "Rimi🌹:")
   *   - Child 2: span[class*="commentContent--"] (text: "やえちゃん❣️...")
   */
  function extractCommentsFromDOM() {
    const newComments = [];
    
    // Find all comment elements (exclude container)
    const commentEls = document.querySelectorAll('[class*="comment--"]');
    
    for (const el of commentEls) {
      // Skip the container itself
      if (el.className.includes('commentContainer')) continue;
      // Skip non-comment elements (e.g. commentContent--)
      if (el.className.includes('commentContent')) continue;
      if (el.className.includes('username')) continue;
      
      // Find username and content spans using confirmed class patterns
      const usernameEl = el.querySelector('[class*="username--"]');
      const contentEl = el.querySelector('[class*="commentContent--"]');
      
      if (!contentEl) continue;
      
      let username = '';
      let content = contentEl.textContent.trim();
      
      if (usernameEl) {
        username = usernameEl.textContent.trim().replace(/:$/, '');
      } else {
        // Fallback: extract from full text using ":" separator
        const fullText = el.textContent.trim();
        const colonIdx = fullText.indexOf(':');
        if (colonIdx > 0 && colonIdx < 50) {
          username = fullText.substring(0, colonIdx).trim();
        }
      }
      
      if (!content) continue;
      
      const commentId = hashString(username + content);
      if (seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);
      
      const tagEls = el.querySelectorAll('[class*="userTag"], [class*="tag"]');
      const tags = Array.from(tagEls).map(t => t.textContent.trim()).filter(t => t);
      
      newComments.push({
        username,
        content,
        tags,
        timestamp: new Date().toISOString(),
        id: commentId
      });
    }

    // Keep set manageable
    if (seenCommentIds.size > 2000) {
      const arr = Array.from(seenCommentIds);
      seenCommentIds = new Set(arr.slice(-1000));
    }

    if (newComments.length > 0) {
      log('Comments extracted:', newComments.length);
    }
    return newComments;
  }

  /**
   * Extract product table data
   * 
   * Confirmed DOM structure:
   * - Product table: the table with most rows (147+)
   * - Each row has 9 td cells:
   *   [0] No. (e.g. "78")
   *   [1] Product name + ID (has <a> link)
   *   [2] Pin status ("Pinned" or empty)
   *   [3] GMV ("161,577円")
   *   [4] Items sold ("59")
   *   [5] Add-to-cart count ("138")
   *   [6] Product Clicks ("698")
   *   [7] Product Impressions ("1,843")
   *   [8] Click-Through Rate ("37.87%")
   */
  function extractProductsFromDOM() {
    const extractedProducts = [];
    const tables = document.querySelectorAll('table');
    
    // Find the product table (the one with most rows)
    let productTable = null;
    let maxRows = 0;
    for (const t of tables) {
      const rowCount = t.querySelectorAll('tr').length;
      if (rowCount > maxRows) {
        maxRows = rowCount;
        productTable = t;
      }
    }

    if (!productTable) return extractedProducts;

    // Use all tr elements (TikTok tables may not use tbody)
    const rows = productTable.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) continue;

      const no = cells[0]?.textContent.trim();
      const nameCell = cells[1];
      
      // Extract product name (prefer link text, fallback to cell text)
      const nameLink = nameCell?.querySelector('a');
      let name = '';
      if (nameLink) {
        name = nameLink.textContent.trim();
      } else if (nameCell) {
        name = nameCell.textContent.trim();
      }
      
      // Clean product name: remove "ID: xxxx" suffix
      name = name.replace(/ID:\s*\d+/g, '').trim();
      
      // Extract product ID
      const idMatch = nameCell?.textContent.match(/ID:\s*(\d+)/);
      const productId = idMatch ? idMatch[1] : '';

      // Extract image if available
      const imgEl = row.querySelector('img');
      const imageUrl = imgEl?.src || '';

      let isPinned, gmv, sold, cartCount, clicks, impressions, ctr;

      if (cells.length >= 9) {
        // 9 columns: No, Product, Pin, GMV, Items sold, Add-to-cart, Clicks, Impressions, CTR
        isPinned = cells[2]?.textContent.trim() === 'Pinned' || cells[2]?.textContent.includes('ピン留め');
        gmv = cells[3]?.textContent.trim() || '0';
        sold = cells[4]?.textContent.trim() || '0';
        cartCount = cells[5]?.textContent.trim() || '0';
        clicks = cells[6]?.textContent.trim() || '0';
        impressions = cells[7]?.textContent.trim() || '0';
        ctr = cells[8]?.textContent.trim() || '0%';
      } else if (cells.length >= 8) {
        isPinned = row.textContent.includes('Pinned') || row.textContent.includes('ピン留め');
        gmv = cells[2]?.textContent.trim() || '0';
        sold = cells[3]?.textContent.trim() || '0';
        cartCount = cells[4]?.textContent.trim() || '0';
        clicks = cells[5]?.textContent.trim() || '0';
        impressions = cells[6]?.textContent.trim() || '0';
        ctr = cells[7]?.textContent.trim() || '0%';
      } else {
        isPinned = row.textContent.includes('Pinned') || row.textContent.includes('ピン留め');
        gmv = cells[2]?.textContent.trim() || '0';
        sold = cells[3]?.textContent.trim() || '0';
        clicks = cells[4]?.textContent.trim() || '0';
        cartCount = '0';
        impressions = '0';
        ctr = '0%';
      }

      if (name && name.length > 2) {
        extractedProducts.push({
          no: parseInt(no) || 0,
          name: name.substring(0, 150),
          product_id: productId,
          pinned: isPinned,
          image: imageUrl,
          gmv,
          sold,
          cart_count: cartCount,
          clicks,
          impressions,
          ctr
        });
      }
    }

    if (extractedProducts.length > 0) {
      log('Products extracted:', extractedProducts.length);
    }
    return extractedProducts;
  }

  /**
   * Extract traffic source data
   * 
   * Confirmed DOM structure:
   * - Table with th headers: ["Channel", "GMV", "Impressions", "Views"]
   * - 24 rows of traffic data in td cells
   */
  function extractTrafficFromDOM() {
    const sources = [];
    const tables = document.querySelectorAll('table');
    
    for (const table of tables) {
      // Check for traffic source table by looking at th headers
      const headers = Array.from(table.querySelectorAll('th')).map(h => h.textContent.trim());
      if (headers.includes('Channel') || headers.includes('チャンネル')) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            sources.push({
              channel: cells[0]?.textContent.trim() || '',
              gmv: cells[1]?.textContent.trim() || '0',
              impressions: cells[2]?.textContent.trim() || '0',
              views: cells[3]?.textContent.trim() || '0'
            });
          }
        }
        break;
      }
    }

    if (sources.length > 0) {
      log('Traffic sources extracted:', sources.length);
    }
    return sources;
  }

  // ============================================================
  // UI Update Functions
  // ============================================================

  function updateMetricsDisplay() {
    const panel = panelElement;
    if (!panel) return;

    const gmvEl = panel.querySelector('#ahub-mini-gmv');
    const viewersEl = panel.querySelector('#ahub-mini-viewers');
    const clicksEl = panel.querySelector('#ahub-mini-clicks');
    const ctrEl = panel.querySelector('#ahub-mini-ctr');

    if (gmvEl && currentMetrics.gmv) {
      gmvEl.textContent = formatMetricValue(currentMetrics.gmv, '円');
    }
    if (viewersEl && (currentMetrics.current_viewers || currentMetrics.views)) {
      viewersEl.textContent = currentMetrics.current_viewers || currentMetrics.views;
    }
    if (clicksEl && (currentMetrics.product_clicks || currentMetrics.impressions)) {
      clicksEl.textContent = currentMetrics.product_clicks || currentMetrics.impressions;
    }
    if (ctrEl && (currentMetrics.tap_through_rate || currentMetrics.live_ctr)) {
      ctrEl.textContent = currentMetrics.tap_through_rate || currentMetrics.live_ctr;
    }

    // Update last update time
    const lastUpdateEl = panel.querySelector('#ahub-last-update');
    if (lastUpdateEl) {
      lastUpdateEl.textContent = new Date().toLocaleTimeString('ja-JP');
    }
  }

  function updateCommentsDisplay() {
    const panel = panelElement;
    if (!panel) return;

    const countEl = panel.querySelector('#ahub-comment-count');
    const listEl = panel.querySelector('#ahub-comment-list');
    if (!listEl) return;

    if (countEl) countEl.textContent = comments.length;

    if (comments.length === 0) {
      listEl.innerHTML = `
        <div class="ahub-empty">
          <div class="ahub-empty-icon">💬</div>
          <div class="ahub-empty-text">
            コメントを取得中...<br>
            LIVEが開始されるとコメントが表示されます
          </div>
        </div>
      `;
      return;
    }

    // Show latest comments (most recent first)
    const displayComments = comments.slice(-30).reverse();
    listEl.innerHTML = displayComments.map(c => `
      <div class="ahub-comment-item">
        <div class="ahub-comment-avatar">${(c.username || '?')[0].toUpperCase()}</div>
        <div class="ahub-comment-body">
          <div class="ahub-comment-user">
            ${escapeHtml(c.username)}
            ${(c.tags || []).map(t => `<span class="ahub-comment-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
          <div class="ahub-comment-text">${escapeHtml(c.content)}</div>
          <div class="ahub-comment-time">${formatTime(c.timestamp)}</div>
        </div>
      </div>
    `).join('');
  }

  function updateProductsDisplay() {
    const panel = panelElement;
    if (!panel) return;

    const countEl = panel.querySelector('#ahub-product-count');
    const listEl = panel.querySelector('#ahub-product-list');
    if (!listEl) return;

    if (countEl) countEl.textContent = products.length;

    if (products.length === 0) {
      listEl.innerHTML = `
        <div class="ahub-empty">
          <div class="ahub-empty-icon">🛍️</div>
          <div class="ahub-empty-text">商品データを取得中...</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = products.map((p, i) => `
      <div class="ahub-product-item">
        <div class="ahub-product-rank ${i < 3 ? 'top' : ''}">${p.no || i + 1}</div>
        <div class="ahub-product-info">
          <div class="ahub-product-name">${escapeHtml(p.name)}</div>
          <div class="ahub-product-stats">
            ${p.gmv ? `GMV: ${p.gmv}` : ''}
            ${p.sold ? ` · ${p.sold}個販売` : ''}
            ${p.clicks ? ` · ${p.clicks}クリック` : ''}
            ${p.pinned ? ' · 📌ピン留め' : ''}
          </div>
        </div>
        <div class="ahub-product-gmv">${p.gmv || '--'}</div>
      </div>
    `).join('');
  }

  function updateTrafficDisplay() {
    const panel = panelElement;
    if (!panel) return;

    const listEl = panel.querySelector('#ahub-traffic-list');
    if (!listEl) return;

    if (trafficSources.length === 0) {
      listEl.innerHTML = `
        <div class="ahub-empty">
          <div class="ahub-empty-icon">📊</div>
          <div class="ahub-empty-text">トラフィックデータを取得中...</div>
        </div>
      `;
      return;
    }

    // Calculate max value for bar scaling
    const maxViews = Math.max(...trafficSources.map(s => parseFloat(s.views?.replace(/[,%]/g, '') || 0)));

    listEl.innerHTML = trafficSources.map(s => {
      const viewNum = parseFloat(s.views?.replace(/[,%]/g, '') || 0);
      const pct = maxViews > 0 ? (viewNum / maxViews * 100) : 0;
      return `
        <div class="ahub-traffic-item">
          <div style="width:100px;font-size:11px;color:#aaa;">${escapeHtml(s.channel)}</div>
          <div class="ahub-traffic-bar">
            <div class="ahub-traffic-fill" style="width:${pct}%"></div>
          </div>
          <div style="width:60px;text-align:right;font-size:11px;color:#888;">${s.views || '--'}</div>
          <div style="width:70px;text-align:right;font-size:11px;color:#00e676;">${s.gmv || '--'}</div>
        </div>
      `;
    }).join('');
  }

  function updateAiSuggestionsDisplay() {
    const panel = panelElement;
    if (!panel) return;

    const listEl = panel.querySelector('#ahub-ai-list');
    if (!listEl) return;

    if (aiSuggestions.length === 0 && !isAnalyzing) {
      listEl.innerHTML = `
        <div class="ahub-empty">
          <div class="ahub-empty-icon">🤖</div>
          <div class="ahub-empty-text">
            「AIに分析してもらう」をクリックすると<br>
            リアルタイムの提案が表示されます
          </div>
        </div>
      `;
      return;
    }

    if (isAnalyzing) {
      listEl.innerHTML = `
        <div class="ahub-loading">
          <div class="ahub-spinner"></div>
          AIが分析中...
        </div>
      ` + (aiSuggestions.length > 0 ? renderAiSuggestions() : '');
      return;
    }

    listEl.innerHTML = renderAiSuggestions();
  }

  function renderAiSuggestions() {
    return aiSuggestions.map(s => {
      const typeClass = s.type === 'warning' ? 'warning' : 
                        s.type === 'danger' ? 'danger' : 
                        s.type === 'info' ? 'info' : '';
      const icon = s.type === 'warning' ? '⚠️' : 
                   s.type === 'danger' ? '🚨' : 
                   s.type === 'info' ? 'ℹ️' : '💡';
      const typeLabel = s.type === 'warning' ? '注意' : 
                        s.type === 'danger' ? '危険' : 
                        s.type === 'info' ? '情報' : '提案';
      
      return `
        <div class="ahub-ai-card ${typeClass}">
          <div class="ahub-ai-header">
            <span class="ahub-ai-icon">${icon}</span>
            <span class="ahub-ai-type">${typeLabel}</span>
            <span class="ahub-ai-time">${formatTime(s.timestamp)}</span>
          </div>
          <div class="ahub-ai-text">${escapeHtml(s.text)}</div>
          ${s.action ? `<button class="ahub-ai-action" onclick="this.style.opacity='0.5'">${escapeHtml(s.action)}</button>` : ''}
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // AI Analysis
  // ============================================================

  async function requestAiAnalysis() {
    if (isAnalyzing) return;
    isAnalyzing = true;

    const btn = panelElement?.querySelector('#ahub-analyze-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="ahub-spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,0.2);width:14px;height:14px;"></div> 分析中...';
    }

    updateAiSuggestionsDisplay();

    try {
      // Collect current data snapshot
      const snapshot = {
        metrics: currentMetrics,
        previous_metrics: previousMetrics,
        comments_count: comments.length,
        recent_comments: comments.slice(-20).map(c => ({
          username: c.username,
          content: c.content
        })),
        products: products.slice(0, 10).map(p => ({
          name: p.name,
          gmv: p.gmv,
          sold: p.sold,
          clicks: p.clicks,
          pinned: p.pinned
        })),
        traffic_sources: trafficSources
      };

      // Send to backend for AI analysis
      const response = await sendToBackground('AI_ANALYZE', snapshot);
      
      if (response && response.suggestions) {
        // Add new suggestions to the top
        const newSuggestions = response.suggestions.map(s => ({
          ...s,
          timestamp: new Date().toISOString()
        }));
        aiSuggestions = [...newSuggestions, ...aiSuggestions].slice(0, MAX_AI_SUGGESTIONS);
      }

      lastAiAnalysis = Date.now();
    } catch (err) {
      console.error('[AitherHub Commander] AI analysis error:', err);
      // Add error suggestion
      aiSuggestions.unshift({
        type: 'info',
        text: 'AI分析に接続できませんでした。データの収集は継続しています。',
        timestamp: new Date().toISOString()
      });
    } finally {
      isAnalyzing = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🧠 AIに分析してもらう';
      }
      updateAiSuggestionsDisplay();
    }
  }

  // ============================================================
  // Communication with Background Script
  // ============================================================

  function sendToBackground(type, data) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, data }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Also send data to background for API forwarding
  function sendDataToBackground(data) {
    try {
      chrome.runtime.sendMessage({
        type: 'LIVE_DATA',
        data: {
          source: 'workbench',
          ...data
        }
      });
    } catch (err) {
      // Extension context may be invalidated
    }
  }

  // ============================================================
  // Polling Loop
  // ============================================================

  function startPolling() {
    stopPolling();

    log('Starting data polling');

    // Metrics polling
    const metricsTimer = setInterval(() => {
      try {
        const newMetrics = extractMetricsFromDOM();
        if (Object.keys(newMetrics).length > 0) {
          previousMetrics = { ...currentMetrics };
          currentMetrics = { ...currentMetrics, ...newMetrics };
          
          // Track history
          metricsHistory.push({
            timestamp: new Date().toISOString(),
            metrics: { ...currentMetrics }
          });
          if (metricsHistory.length > 500) {
            metricsHistory = metricsHistory.slice(-500);
          }

          updateMetricsDisplay();
          
          // Send to background for API
          sendDataToBackground({ metrics: newMetrics });
        }
      } catch (err) {
        console.error('[AitherHub Commander] Metrics error:', err);
      }
    }, METRICS_POLL_MS);
    pollTimers.push(metricsTimer);

    // Comment polling
    const commentTimer = setInterval(() => {
      try {
        const newComments = extractCommentsFromDOM();
        if (newComments.length > 0) {
          comments = [...comments, ...newComments];
          if (comments.length > MAX_DISPLAY_COMMENTS) {
            comments = comments.slice(-MAX_DISPLAY_COMMENTS);
          }
          updateCommentsDisplay();
          
          // Send to background for API
          sendDataToBackground({ comments: newComments });
        }
      } catch (err) {
        console.error('[AitherHub Commander] Comments error:', err);
      }
    }, COMMENT_POLL_MS);
    pollTimers.push(commentTimer);

    // Product polling
    const productTimer = setInterval(() => {
      try {
        const newProducts = extractProductsFromDOM();
        if (newProducts.length > 0) {
          products = newProducts;
          updateProductsDisplay();
          
          // Send to background for API
          sendDataToBackground({ products: newProducts });
        }
      } catch (err) {
        console.error('[AitherHub Commander] Products error:', err);
      }
    }, PRODUCT_POLL_MS);
    pollTimers.push(productTimer);

    // Traffic polling
    const trafficTimer = setInterval(() => {
      try {
        const newTraffic = extractTrafficFromDOM();
        if (newTraffic.length > 0) {
          trafficSources = newTraffic;
          updateTrafficDisplay();
          
          // Send to background for API
          sendDataToBackground({ trafficSources: newTraffic });
        }
      } catch (err) {
        console.error('[AitherHub Commander] Traffic error:', err);
      }
    }, PRODUCT_POLL_MS);
    pollTimers.push(trafficTimer);

    // Auto AI analysis
    const aiTimer = setInterval(() => {
      if (Date.now() - lastAiAnalysis > AI_ANALYZE_INTERVAL_MS && 
          Object.keys(currentMetrics).length > 0 &&
          !isAnalyzing) {
        requestAiAnalysis();
      }
    }, AI_ANALYZE_INTERVAL_MS);
    pollTimers.push(aiTimer);

    // MutationObserver for real-time comment detection
    setupCommentObserver();
  }

  function stopPolling() {
    pollTimers.forEach(t => clearInterval(t));
    pollTimers = [];
  }

  function forceRefresh() {
    log('Force refresh triggered');
    const metrics = extractMetricsFromDOM();
    const newComments = extractCommentsFromDOM();
    const newProducts = extractProductsFromDOM();
    const newTraffic = extractTrafficFromDOM();

    if (Object.keys(metrics).length > 0) {
      previousMetrics = { ...currentMetrics };
      currentMetrics = { ...currentMetrics, ...metrics };
      updateMetricsDisplay();
    }
    if (newComments.length > 0) {
      comments = [...comments, ...newComments];
      updateCommentsDisplay();
    }
    if (newProducts.length > 0) {
      products = newProducts;
      updateProductsDisplay();
    }
    if (newTraffic.length > 0) {
      trafficSources = newTraffic;
      updateTrafficDisplay();
    }
    
    log('Force refresh complete:', {
      metrics: Object.keys(metrics).length,
      comments: newComments.length,
      products: newProducts.length,
      traffic: newTraffic.length
    });
  }

  // ============================================================
  // MutationObserver for Real-time Updates
  // ============================================================

  function setupCommentObserver() {
    // Watch for new comments being added to the DOM
    // Confirmed class: commentContainer--xxxxx
    const commentContainers = document.querySelectorAll('[class*="commentContainer"]');
    
    if (commentContainers.length > 0) {
      for (const container of commentContainers) {
        log('MutationObserver attached to comment container');
        const observer = new MutationObserver((mutations) => {
          let hasNewNodes = false;
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              hasNewNodes = true;
              break;
            }
          }
          if (hasNewNodes) {
            const newComments = extractCommentsFromDOM();
            if (newComments.length > 0) {
              comments = [...comments, ...newComments];
              if (comments.length > MAX_DISPLAY_COMMENTS) {
                comments = comments.slice(-MAX_DISPLAY_COMMENTS);
              }
              updateCommentsDisplay();
              sendDataToBackground({ comments: newComments });
            }
          }
        });
        observer.observe(container, { childList: true, subtree: true });
      }
    } else {
      // Retry after delay - comment container may not be loaded yet
      log('Comment container not found, will retry in 5s');
      setTimeout(() => {
        const containers = document.querySelectorAll('[class*="commentContainer"]');
        for (const container of containers) {
          log('MutationObserver attached to comment container (retry)');
          const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            for (const mutation of mutations) {
              if (mutation.addedNodes.length > 0) {
                hasNewNodes = true;
                break;
              }
            }
            if (hasNewNodes) {
              const newComments = extractCommentsFromDOM();
              if (newComments.length > 0) {
                comments = [...comments, ...newComments];
                if (comments.length > MAX_DISPLAY_COMMENTS) {
                  comments = comments.slice(-MAX_DISPLAY_COMMENTS);
                }
                updateCommentsDisplay();
                sendDataToBackground({ comments: newComments });
              }
            }
          });
          observer.observe(container, { childList: true, subtree: true });
        }
      }, 5000);
    }
  }

  // ============================================================
  // Utility Functions
  // ============================================================

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatMetricValue(value, suffix) {
    if (!value) return '--';
    // If already formatted, return as-is
    if (typeof value === 'string' && (value.includes('万') || value.includes('K'))) {
      return value;
    }
    const num = parseFloat(String(value).replace(/[,円¥]/g, ''));
    if (isNaN(num)) return value;
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万' + (suffix || '');
    }
    return num.toLocaleString() + (suffix || '');
  }

  // ============================================================
  // Initialization
  // ============================================================

  function init() {
    const url = window.location.href;
    
    // Only activate on TikTok LIVE Dashboard (workbench or streamer) pages
    if (!url.includes('/workbench/live/') && !url.includes('/streamer/live/')) {
      log('Not a LIVE page, not activating');
      return;
    }

    log('Detected LIVE page, waiting for content...');

    // Wait for page content to be ready
    const checkReady = setInterval(() => {
      const root = document.querySelector('#root');
      if (root && root.textContent.length > 200) {
        clearInterval(checkReady);
        log('Page ready, creating panel');
        createPanel();
        startPolling();
        
        // Initial data extraction after a short delay
        setTimeout(forceRefresh, 1000);
      }
    }, 1000);

    // Timeout after 60 seconds
    setTimeout(() => clearInterval(checkReady), 60000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      stopPolling();
    });
  }

  // Start
  init();

})();
