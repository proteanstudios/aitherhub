/**
 * AitherHub LIVE Connector - Content Script
 * 
 * Runs on TikTok Shop LIVE Manager and LIVE Dashboard pages.
 * Extracts real-time data from the DOM and sends to background worker.
 * 
 * Supported pages:
 * 1. LIVE Manager (Streamer): shop.tiktok.com/streamer/live/product/dashboard
 * 2. LIVE Dashboard (Workbench): shop.tiktok.com/workbench/live/overview
 */

(function() {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================
  const POLL_INTERVAL_MS = 3000;       // Poll DOM every 3 seconds
  const COMMENT_POLL_MS = 1500;        // Poll comments more frequently
  const ACTIVITY_POLL_MS = 2000;       // Poll activities frequently
  const MAX_COMMENTS_PER_BATCH = 50;
  const MAX_ACTIVITIES_PER_BATCH = 50;

  // ============================================================
  // State
  // ============================================================
  let pageType = detectPageType();
  let isRunning = false;
  let seenCommentIds = new Set();
  let seenActivityIds = new Set();
  let lastMetrics = {};
  let pollTimers = [];

  // ============================================================
  // Page Detection
  // ============================================================
  function detectPageType() {
    const url = window.location.href;
    if (url.includes('/streamer/live/')) return 'streamer';
    if (url.includes('/workbench/live/')) return 'workbench';
    return 'unknown';
  }

  function extractRoomId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('room_id') || '';
  }

  function extractRegion() {
    const params = new URLSearchParams(window.location.search);
    return params.get('region') || '';
  }

  function extractAccount() {
    // Try multiple selectors for account name
    const selectors = [
      'div[class*="kyogoku"]', // specific
      '[class*="accountName"]',
      '[class*="account-name"]',
      '[class*="userName"]',
    ];
    
    // For streamer page
    if (pageType === 'streamer') {
      const el = document.querySelector('#root');
      if (el) {
        const text = el.textContent;
        const match = text.match(/LIVE Manager.*?(\w+)\s*Go LIVE/);
        if (match) return match[1];
      }
    }
    
    // For workbench page
    if (pageType === 'workbench') {
      const el = document.querySelector('[class*="accountInfo"], [class*="account"]');
      if (el) return el.textContent.trim();
      // Fallback: look for text after "LIVE Dashboard"
      const root = document.querySelector('#root');
      if (root) {
        const text = root.textContent;
        const match = text.match(/LIVE Dashboard\s*[>·]*\s*(\w+)/);
        if (match) return match[1];
      }
    }
    
    return '';
  }

  // ============================================================
  // Streamer Page Extractors
  // ============================================================
  const StreamerExtractor = {
    /**
     * Extract analytics metrics from the right panel
     */
    extractMetrics() {
      const metrics = {};
      const metricLabels = {
        'GMV': 'gmv',
        'Current viewers': 'current_viewers',
        'Impressions': 'impressions',
        'TRR': 'trr',
        'Avg. duration': 'avg_duration',
        'Product clicks': 'product_clicks',
        'Current viewer': 'current_viewers',
      };

      // Walk through all text nodes to find label-value pairs
      const allElements = document.querySelectorAll('div, span');
      for (const el of allElements) {
        const text = el.textContent.trim();
        for (const [label, key] of Object.entries(metricLabels)) {
          if (text === label && el.children.length === 0) {
            // Find the value - usually a sibling or parent's next child
            const parent = el.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children);
              const idx = siblings.indexOf(el);
              // Check next sibling
              if (idx < siblings.length - 1) {
                metrics[key] = siblings[idx + 1].textContent.trim();
              } else {
                // Check parent's text minus label
                const parentText = parent.textContent.trim();
                metrics[key] = parentText.replace(label, '').trim();
              }
            }
          }
        }
      }

      return metrics;
    },

    /**
     * Extract product list from the left panel
     */
    extractProducts() {
      const products = [];
      const productList = document.querySelector('#product-list');
      if (!productList) return products;

      // Find all product items
      const items = productList.querySelectorAll('[class*="product"], label');
      const processedNames = new Set();

      for (const item of items) {
        const nameEl = item.querySelector('span');
        if (!nameEl) continue;
        
        const name = nameEl.textContent.trim();
        if (!name || name.length < 5 || processedNames.has(name)) continue;
        processedNames.add(name);

        const pinBtn = item.querySelector('button');
        const isPinned = pinBtn && pinBtn.textContent.includes('Unpin');

        // Find metrics near this product
        const parentText = item.textContent;
        const clicksMatch = parentText.match(/Products clicks\s*(\d+)/);
        const cartsMatch = parentText.match(/Add to carts count\s*(\d+)/);
        const soldMatch = parentText.match(/Items sold\s*(\d+)/);
        const priceMatch = parentText.match(/([\d,]+)円/);
        const stockMatch = parentText.match(/Stock:\s*([\d,]+)/);

        products.push({
          name: name.substring(0, 100),
          pinned: isPinned,
          price: priceMatch ? priceMatch[1] : '',
          stock: stockMatch ? stockMatch[1] : '',
          clicks: clicksMatch ? parseInt(clicksMatch[1]) : 0,
          carts: cartsMatch ? parseInt(cartsMatch[1]) : 0,
          sold: soldMatch ? parseInt(soldMatch[1]) : 0
        });
      }

      return products;
    },

    /**
     * Extract activity feed from the right panel
     */
    extractActivities() {
      const activities = [];
      // Look for activity items like "xxx just joined", "viewing product"
      const allElements = document.querySelectorAll('div, span');
      
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.length > 200 || text.length < 5) continue;
        
        let type = null;
        if (text.includes('just joined')) type = 'join';
        else if (text.includes('viewing product')) type = 'view_product';
        else if (text.includes('placed an order')) type = 'order';
        else if (text.includes('shared')) type = 'share';
        else if (text.includes('followed')) type = 'follow';
        
        if (type && el.children.length <= 2) {
          const id = hashString(text + Math.floor(Date.now() / 10000));
          if (!seenActivityIds.has(text)) {
            seenActivityIds.add(text);
            activities.push({
              type,
              text,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // Keep set manageable
      if (seenActivityIds.size > 500) {
        const arr = Array.from(seenActivityIds);
        seenActivityIds = new Set(arr.slice(-200));
      }

      return activities.slice(-MAX_ACTIVITIES_PER_BATCH);
    },

    /**
     * Extract TikTok AI suggestions
     */
    extractSuggestions() {
      const suggestions = [];
      const allElements = document.querySelectorAll('div');
      
      for (const el of allElements) {
        const text = el.textContent.trim();
        // TikTok suggestions are typically longer Japanese/English text with actionable advice
        if (text.length > 30 && text.length < 500 && 
            (text.includes('視聴者') || text.includes('viewers') || 
             text.includes('紹介') || text.includes('チャンス') ||
             text.includes('Suggestion') || text.includes('提案'))) {
          // Check it's a leaf-ish element
          if (el.children.length <= 3) {
            suggestions.push({
              text,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      return suggestions.slice(0, 5);
    }
  };

  // ============================================================
  // Workbench Page Extractors
  // ============================================================
  const WorkbenchExtractor = {
    /**
     * Extract all key metrics
     */
    extractMetrics() {
      const metrics = {};
      const metricLabels = {
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
        'LIVE CTR': 'live_ctr',
        'Order rate (SKU orders)': 'order_rate',
        'Share rate': 'share_rate',
        'Like rate': 'like_rate',
        '> 1 min. views': 'views_over_1min',
        'Tap-through rate (via LIVE preview)': 'tap_through_preview'
      };

      const allElements = document.querySelectorAll('div');
      for (const el of allElements) {
        if (el.children.length > 3) continue;
        const text = el.textContent.trim();
        
        for (const [label, key] of Object.entries(metricLabels)) {
          if (text === label) {
            // Value is typically in the next sibling or parent's adjacent child
            const parent = el.parentElement;
            if (parent) {
              const fullText = parent.textContent.trim();
              const value = fullText.replace(label, '').trim().split('\n')[0].trim();
              if (value && value !== label) {
                metrics[key] = value;
              }
            }
          }
        }
      }

      // Also try to get the big hero numbers (GMV, Items sold, Current viewers)
      const heroSelectors = [
        { selector: '.text-neutral-text-3.text-bodyL-regular', labels: ['GMV', 'Items sold'] },
        { selector: '.text-xl.font-medium', labels: ['Current viewers'] }
      ];

      for (const { selector, labels } of heroSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const parent = el.closest('[class*="metric"], [class*="card"]') || el.parentElement;
          if (parent) {
            const text = parent.textContent.trim();
            for (const label of labels) {
              if (text.includes(label)) {
                const match = text.match(new RegExp(label + '\\s*([\\d,.]+[KkMm%円]*)'));
                if (match) metrics[label.toLowerCase().replace(/\s+/g, '_')] = match[1];
              }
            }
          }
        }
      }

      return metrics;
    },

    /**
     * Extract comments from the comment container
     */
    extractComments() {
      const comments = [];
      
      // Primary selector: CSS module class
      const commentEls = document.querySelectorAll('[class*="comment--"]');
      
      for (const el of commentEls) {
        const usernameEl = el.querySelector('[class*="username"]');
        const contentEl = el.querySelector('[class*="commentContent"]');
        const tagEls = el.querySelectorAll('[class*="userTag"]');
        
        if (!usernameEl || !contentEl) continue;
        
        const username = usernameEl.textContent.trim().replace(/:$/, '');
        const content = contentEl.textContent.trim();
        const tags = Array.from(tagEls).map(t => t.textContent.trim());
        
        const commentId = hashString(username + content);
        if (seenCommentIds.has(commentId)) continue;
        seenCommentIds.add(commentId);
        
        comments.push({
          username,
          content,
          tags,
          timestamp: new Date().toISOString()
        });
      }

      // Keep set manageable
      if (seenCommentIds.size > 1000) {
        const arr = Array.from(seenCommentIds);
        seenCommentIds = new Set(arr.slice(-500));
      }

      return comments.slice(-MAX_COMMENTS_PER_BATCH);
    },

    /**
     * Extract product table data
     */
    extractProducts() {
      const products = [];
      const tables = document.querySelectorAll('table');
      
      // Product table is typically the one with most rows
      let productTable = null;
      let maxRows = 0;
      for (const t of tables) {
        const rowCount = t.querySelectorAll('tbody tr, tr').length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          productTable = t;
        }
      }

      if (!productTable) return products;

      const rows = productTable.querySelectorAll('tbody tr, tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) continue;

        const no = cells[0]?.textContent.trim();
        const nameCell = cells[1];
        const name = nameCell?.querySelector('a')?.textContent.trim() || 
                     nameCell?.textContent.trim() || '';
        
        // Check for "Pinned" text
        const isPinned = row.textContent.includes('Pinned');
        
        // Extract product ID if available
        const idMatch = nameCell?.textContent.match(/ID:\s*(\d+)/);
        const productId = idMatch ? idMatch[1] : '';

        // Metrics columns (offset depends on whether Pin column exists)
        const impressions = cells[cells.length - 6]?.textContent.trim() || '0';
        const ctr = cells[cells.length - 5]?.textContent.trim() || '0%';
        const gmv = cells[cells.length - 4]?.textContent.trim() || '0';
        const cartCount = cells[cells.length - 3]?.textContent.trim() || '0';
        const stock = cells[cells.length - 2]?.textContent.trim() || '0';
        const sold = cells[cells.length - 1]?.textContent.trim() || '0';

        if (name && name.length > 3) {
          products.push({
            no: parseInt(no) || 0,
            name: name.substring(0, 150),
            product_id: productId,
            pinned: isPinned,
            impressions,
            ctr,
            gmv,
            cart_count: cartCount,
            stock,
            sold
          });
        }
      }

      return products;
    },

    /**
     * Extract traffic source data
     */
    extractTrafficSources() {
      const sources = [];
      const tables = document.querySelectorAll('table');
      
      // Traffic source table has Channel, GMV, Impressions, Views headers
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('th')).map(h => h.textContent.trim());
        if (headers.includes('Channel') && headers.includes('Views')) {
          const rows = table.querySelectorAll('tbody tr, tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
              sources.push({
                channel: cells[0]?.textContent.trim(),
                gmv: cells[1]?.textContent.trim(),
                impressions: cells[2]?.textContent.trim(),
                views: cells[3]?.textContent.trim()
              });
            }
          }
          break;
        }
      }

      return sources;
    }
  };

  // ============================================================
  // Utility Functions
  // ============================================================
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  // ============================================================
  // Main Polling Loop
  // ============================================================
  function startPolling() {
    if (isRunning) return;
    isRunning = true;

    console.log(`[AitherHub] Starting data extraction on ${pageType} page`);

    // Notify background that live session started
    chrome.runtime.sendMessage({
      type: 'LIVE_STARTED',
      data: {
        source: pageType,
        roomId: extractRoomId(),
        account: extractAccount(),
        region: extractRegion()
      }
    });

    // Show connection indicator
    showIndicator();

    const extractor = pageType === 'streamer' ? StreamerExtractor : WorkbenchExtractor;

    // Main metrics polling
    const metricsTimer = setInterval(() => {
      try {
        const metrics = extractor.extractMetrics();
        const products = extractor.extractProducts();
        const trafficSources = pageType === 'workbench' ? 
          WorkbenchExtractor.extractTrafficSources() : [];

        // Only send if metrics changed
        const metricsStr = JSON.stringify(metrics);
        if (metricsStr !== JSON.stringify(lastMetrics) || products.length > 0) {
          lastMetrics = metrics;
          
          chrome.runtime.sendMessage({
            type: 'LIVE_DATA',
            data: {
              source: pageType,
              metrics,
              products,
              trafficSources
            }
          });
        }
      } catch (err) {
        console.error('[AitherHub] Metrics extraction error:', err);
      }
    }, POLL_INTERVAL_MS);
    pollTimers.push(metricsTimer);

    // Comment polling (workbench only has comment container)
    if (pageType === 'workbench') {
      const commentTimer = setInterval(() => {
        try {
          const comments = WorkbenchExtractor.extractComments();
          if (comments.length > 0) {
            chrome.runtime.sendMessage({
              type: 'LIVE_DATA',
              data: {
                source: pageType,
                comments
              }
            });
          }
        } catch (err) {
          console.error('[AitherHub] Comment extraction error:', err);
        }
      }, COMMENT_POLL_MS);
      pollTimers.push(commentTimer);
    }

    // Activity polling (streamer page)
    if (pageType === 'streamer') {
      const activityTimer = setInterval(() => {
        try {
          const activities = StreamerExtractor.extractActivities();
          const suggestions = StreamerExtractor.extractSuggestions();
          if (activities.length > 0 || suggestions.length > 0) {
            chrome.runtime.sendMessage({
              type: 'LIVE_DATA',
              data: {
                source: pageType,
                activities,
                suggestions
              }
            });
          }
        } catch (err) {
          console.error('[AitherHub] Activity extraction error:', err);
        }
      }, ACTIVITY_POLL_MS);
      pollTimers.push(activityTimer);
    }

    // MutationObserver for real-time comment/activity detection
    setupMutationObserver();
  }

  function stopPolling() {
    isRunning = false;
    pollTimers.forEach(t => clearInterval(t));
    pollTimers = [];
    
    chrome.runtime.sendMessage({
      type: 'LIVE_ENDED',
      data: { source: pageType }
    });

    removeIndicator();
    console.log('[AitherHub] Stopped data extraction');
  }

  // ============================================================
  // MutationObserver for Real-time Updates
  // ============================================================
  function setupMutationObserver() {
    // Watch for new comments
    const commentContainer = document.querySelector('[class*="commentContainer"]');
    if (commentContainer) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            // New comment added - extract immediately
            const comments = WorkbenchExtractor.extractComments();
            if (comments.length > 0) {
              chrome.runtime.sendMessage({
                type: 'LIVE_DATA',
                data: { source: pageType, comments }
              });
            }
          }
        }
      });
      observer.observe(commentContainer, { childList: true, subtree: true });
    }

    // Watch for activity updates (streamer page)
    if (pageType === 'streamer') {
      const activityContainer = document.querySelector('[class*="activity"], [class*="Activity"]');
      if (activityContainer) {
        const observer = new MutationObserver(() => {
          const activities = StreamerExtractor.extractActivities();
          if (activities.length > 0) {
            chrome.runtime.sendMessage({
              type: 'LIVE_DATA',
              data: { source: pageType, activities }
            });
          }
        });
        observer.observe(activityContainer, { childList: true, subtree: true });
      }
    }
  }

  // ============================================================
  // Visual Indicator
  // ============================================================
  function showIndicator() {
    if (document.getElementById('aitherhub-indicator')) return;
    
    const indicator = document.createElement('div');
    indicator.id = 'aitherhub-indicator';
    indicator.innerHTML = `
      <div class="aitherhub-indicator-inner">
        <div class="aitherhub-indicator-dot"></div>
        <span>AitherHub Connected</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }

  function removeIndicator() {
    const indicator = document.getElementById('aitherhub-indicator');
    if (indicator) indicator.remove();
  }

  // ============================================================
  // Initialization
  // ============================================================
  function init() {
    if (pageType === 'unknown') {
      console.log('[AitherHub] Unknown page type, not activating');
      return;
    }

    console.log(`[AitherHub] Detected ${pageType} page, waiting for content to load...`);

    // Wait for page content to be ready
    const checkReady = setInterval(() => {
      const hasContent = document.querySelector('#root') && 
                         document.querySelector('#root').textContent.length > 100;
      if (hasContent) {
        clearInterval(checkReady);
        startPolling();
      }
    }, 1000);

    // Timeout after 30 seconds
    setTimeout(() => clearInterval(checkReady), 30000);

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      stopPolling();
    });
  }

  // Start
  init();

})();
