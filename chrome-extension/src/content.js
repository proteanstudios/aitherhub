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
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[AitherHub]', ...args);
  }

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
    // Strategy 1: For workbench page - look for username near "LIVE Dashboard" text
    if (pageType === 'workbench') {
      const root = document.querySelector('#root');
      if (root) {
        const text = root.textContent;
        const match = text.match(/LIVE Dashboard\s+([a-zA-Z0-9._]+)\s+(?:Duration|配信時間)/);
        if (match) return match[1];
      }
    }

    // Strategy 2: For streamer page - look for username in header
    if (pageType === 'streamer') {
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        if (span.children.length > 0) continue;
        const rect = span.getBoundingClientRect();
        if (rect.top > 60) continue;
        const text = span.textContent.trim();
        if (text && /^[a-zA-Z0-9._]{2,30}$/.test(text) &&
            !['LIVE', 'Shop', 'TikTok', 'Home', 'ON', 'OFF', 'English', 'Duration', 'Manager', 'Go'].includes(text)) {
          return text;
        }
      }
    }

    // Strategy 3: Generic - look for avatar + username pattern
    const headerSelectors = [
      '[class*="avatar"] + span',
      '[class*="avatar"] + div',
      '[class*="user-name"]',
      '[class*="userName"]',
      '[class*="accountName"]',
      '[class*="nick-name"]',
      '[class*="nickName"]',
    ];
    for (const sel of headerSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 0 && text.length < 50) return text;
        }
      } catch (e) { /* ignore */ }
    }

    // Strategy 4: Extract from document title
    const titleMatch = document.title.match(/([a-zA-Z0-9._]+)\s*[-|]\s*(?:TikTok|LIVE)/);
    if (titleMatch) return titleMatch[1];

    return '';
  }

  // ============================================================
  // Streamer Page Extractors
  // ============================================================
  const StreamerExtractor = {
    /**
     * Extract analytics metrics from the streamer dashboard
     * 
     * DOM structure (confirmed 2026-02-25):
     * - Metric card parent: div[class*="metricCard"]
     * - Label: div.text-neutral-text3.text-body-s-medium[class*="name--"] (text: "GMV", "Viewers", etc.)
     * - Value: nextElementSibling of label (text: "162.7万円", "262", etc.)
     */
    extractMetrics() {
      const metrics = {};
      const metricLabels = {
        // English labels (confirmed on actual page)
        'GMV': 'gmv',
        'Viewers': 'current_viewers',
        'Current viewers': 'current_viewers',
        'Current viewer': 'current_viewers',
        'LIVE impression': 'impressions',
        'LIVE impressions': 'impressions',
        'Impressions': 'impressions',
        'Tap-through rate': 'tap_through_rate',
        'TRR': 'tap_through_rate',
        'Avg. viewing duration': 'avg_duration',
        'Avg. duration': 'avg_duration',
        'Product clicks': 'product_clicks',
        // Japanese labels
        '視聴者数': 'current_viewers',
        'LIVEのインプレッション': 'impressions',
        'タップスルー率': 'tap_through_rate',
        '平均視聴時間': 'avg_duration',
        '商品クリック数': 'product_clicks',
      };

      // Strategy 1: Find metric cards by class pattern (confirmed: index-module__metricCard----Twq)
      const metricCards = document.querySelectorAll('[class*="metricCard"]');
      for (const card of metricCards) {
        // Label element has class containing "name--" (confirmed: index-module__name--+ryzY)
        const nameEl = card.querySelector('[class*="name--"]');
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

      // Strategy 2: Fallback - find by text-neutral-text3 class
      if (Object.keys(metrics).length === 0) {
        const labelEls = document.querySelectorAll('.text-neutral-text3.text-body-s-medium');
        for (const el of labelEls) {
          const label = el.textContent.trim();
          const key = metricLabels[label];
          if (key) {
            const valueEl = el.nextElementSibling;
            if (valueEl) {
              metrics[key] = valueEl.textContent.trim();
            }
          }
        }
      }

      // Strategy 3: Fallback - walk through all leaf text nodes
      if (Object.keys(metrics).length === 0) {
        const allElements = document.querySelectorAll('div, span');
        for (const el of allElements) {
          const text = el.textContent.trim();
          for (const [label, key] of Object.entries(metricLabels)) {
            if (text === label && el.children.length === 0) {
              const parent = el.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children);
                const idx = siblings.indexOf(el);
                if (idx < siblings.length - 1) {
                  metrics[key] = siblings[idx + 1].textContent.trim();
                }
              }
            }
          }
        }
      }

      log('Streamer metrics extracted:', metrics);
      return metrics;
    },

    /**
     * Extract product list from #product-list
     * 
     * DOM structure (confirmed 2026-02-25):
     * - Container: #product-list
     * - Product cards: div.rounded-4.mb-8
     * - Each card contains:
     *   - Product name: span with text > 15 chars
     *   - Price: "18,315円" pattern
     *   - Stock: "Stock: 28" or "Low Stock: 12" or "Sold Out"
     *   - Pin: "Unpin" button (pinned) or "Pin" button (unpinned)
     *   - Stats: "Clicks 87 | Added to cart 8 | Items sold 0"
     */
    extractProducts() {
      const products = [];
      const productList = document.querySelector('#product-list');
      if (!productList) {
        log('No #product-list found');
        return products;
      }

      // Find product cards - confirmed class: rounded-4 mb-8
      const cards = productList.querySelectorAll('.rounded-4.mb-8');
      
      for (const card of cards) {
        const fullText = card.textContent.trim();
        
        // Extract product name from span elements
        const spans = card.querySelectorAll('span');
        let name = '';
        for (const span of spans) {
          const text = span.textContent.trim();
          if (text.length > 15 && 
              !text.includes('Clicks') && 
              !text.includes('Pin') && 
              !text.includes('Stock') &&
              !text.includes('Added to cart') &&
              !text.includes('Items sold') &&
              !text.includes('Sold Out') &&
              !text.includes('All')) {
            name = text;
            break;
          }
        }
        
        if (!name) continue;

        // Extract price
        const priceMatch = fullText.match(/([\d,]+)円/);
        const price = priceMatch ? priceMatch[1] : '';

        // Extract stats using regex (confirmed format: "Clicks 87", "Added to cart 8", "Items sold 0")
        const clicksMatch = fullText.match(/Clicks\s*([\d,.K]+)/i);
        const cartsMatch = fullText.match(/Added to cart\s*([\d,.K]+)/i);
        const soldMatch = fullText.match(/Items sold\s*([\d,.K]+)/i);

        // Pin status (confirmed: "Unpin" button = pinned, "Pin" button = unpinned)
        const isPinned = fullText.includes('Unpin') || fullText.includes('Pinned');

        // Stock info
        const stockMatch = fullText.match(/(Low Stock|Stock)[:\s]*([\d,]+)/i);
        const isSoldOut = fullText.includes('Sold Out');

        // Parse K values (e.g., "1.7K" -> 1700)
        function parseValue(val) {
          if (!val) return 0;
          val = val.replace(/,/g, '');
          if (val.includes('K')) return Math.round(parseFloat(val) * 1000);
          if (val.includes('M')) return Math.round(parseFloat(val) * 1000000);
          return parseInt(val) || 0;
        }

        products.push({
          name: name.substring(0, 150),
          pinned: isPinned,
          price,
          stock: isSoldOut ? 'Sold Out' : (stockMatch ? stockMatch[2] : ''),
          clicks: parseValue(clicksMatch ? clicksMatch[1] : '0'),
          carts: parseValue(cartsMatch ? cartsMatch[1] : '0'),
          sold: parseValue(soldMatch ? soldMatch[1] : '0')
        });
      }

      // Fallback: if no cards found with .rounded-4.mb-8, try broader search
      if (products.length === 0) {
        const allDivs = productList.querySelectorAll('div');
        const processedNames = new Set();
        
        for (const div of allDivs) {
          const text = div.textContent.trim();
          if (text.includes('Clicks') && text.includes('Items sold') && text.length < 500) {
            // This is likely a product card
            const spans = div.querySelectorAll('span');
            let name = '';
            for (const span of spans) {
              const t = span.textContent.trim();
              if (t.length > 15 && !t.includes('Clicks') && !processedNames.has(t)) {
                name = t;
                break;
              }
            }
            if (!name || processedNames.has(name)) continue;
            processedNames.add(name);

            const priceMatch = text.match(/([\d,]+)円/);
            const clicksMatch = text.match(/Clicks\s*([\d,.K]+)/i);
            const cartsMatch = text.match(/Added to cart\s*([\d,.K]+)/i);
            const soldMatch = text.match(/Items sold\s*([\d,.K]+)/i);
            const isPinned = text.includes('Unpin') || text.includes('Pinned');

            products.push({
              name: name.substring(0, 150),
              pinned: isPinned,
              price: priceMatch ? priceMatch[1] : '',
              stock: '',
              clicks: parseInt((clicksMatch ? clicksMatch[1] : '0').replace(/[,K]/g, '')) || 0,
              carts: parseInt((cartsMatch ? cartsMatch[1] : '0').replace(/[,K]/g, '')) || 0,
              sold: parseInt((soldMatch ? soldMatch[1] : '0').replace(/[,K]/g, '')) || 0
            });
          }
        }
      }

      log('Streamer products extracted:', products.length);
      return products;
    },

    /**
     * Extract activity feed
     * 
     * DOM structure (confirmed 2026-02-25):
     * - Activity items are divs with text patterns:
     *   "1 customer purchased product no. 68|12,786円"
     *   "ゆかり just joined"
     *   "1 person is viewing product no. 6"
     */
    extractActivities() {
      const activities = [];
      const allElements = document.querySelectorAll('div, span');
      
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.length > 200 || text.length < 5) continue;
        
        let type = null;
        if (text.includes('just joined')) type = 'join';
        else if (text.includes('viewing product')) type = 'view_product';
        else if (text.includes('purchased')) type = 'order';
        else if (text.includes('placed an order')) type = 'order';
        else if (text.includes('shared')) type = 'share';
        else if (text.includes('followed')) type = 'follow';
        
        if (type && el.children.length <= 2) {
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

      if (seenActivityIds.size > 500) {
        const arr = Array.from(seenActivityIds);
        seenActivityIds = new Set(arr.slice(-200));
      }

      if (activities.length > 0) log('Streamer activities extracted:', activities.length);
      return activities.slice(-MAX_ACTIVITIES_PER_BATCH);
    },

    /**
     * Extract TikTok AI suggestions
     * 
     * DOM structure (confirmed 2026-02-25):
     * - Header: div.arco-collapse-item-header-title (contains "Suggestion")
     * - Content: .arco-collapse-item-content inside same .arco-collapse-item parent
     * - Text example: "過去5分間に149人の視聴者がLIVEに参加しました！..."
     */
    extractSuggestions() {
      const suggestions = [];
      
      // Strategy 1: Look for arco-collapse Suggestion sections
      const collapseHeaders = document.querySelectorAll('.arco-collapse-item-header-title, [class*="collapse"] [class*="header"]');
      for (const header of collapseHeaders) {
        if (header.textContent.trim().includes('Suggestion')) {
          const parent = header.closest('.arco-collapse-item') || header.parentElement;
          if (parent) {
            const content = parent.querySelector('.arco-collapse-item-content, [class*="content"]');
            if (content) {
              const text = content.textContent.trim();
              if (text.length > 10) {
                suggestions.push({
                  text,
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
        }
      }

      // Strategy 2: Fallback - look for suggestion-like text
      if (suggestions.length === 0) {
        const allElements = document.querySelectorAll('div');
        for (const el of allElements) {
          const text = el.textContent.trim();
          if (text.length > 30 && text.length < 500 && 
              (text.includes('コメント率') || text.includes('comment rate') ||
               text.includes('視聴者') || text.includes('viewers') || 
               text.includes('Suggestion') || text.includes('提案'))) {
            if (el.children.length <= 3) {
              suggestions.push({
                text,
                timestamp: new Date().toISOString()
              });
            }
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
     * Extract all key metrics from workbench LIVE Dashboard
     * 
     * DOM structure (confirmed):
     * - GMV label: <span> "GMV (円)" inside div.flex.items-center.relative
     * - GMV value: large number like "1,568,283"
     * - Items sold / Current viewers: div.text-xl.font-medium.text-neutral-text-1.ml-1
     *   - nextElementSibling contains the value
     * - Detail metrics: div.text-base.text-neutral-text-1.truncate (label)
     *   - nextElementSibling contains the value
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
        'Tap-through rate (via LIVE preview)': 'tap_through_preview',
        'LIVE CTR': 'live_ctr',
        'Order rate (SKU orders)': 'order_rate',
        'Share rate': 'share_rate',
        'Like rate': 'like_rate',
        '> 1 min. views': 'views_over_1min'
      };

      // Strategy 1: Extract hero metrics (Items sold, Current viewers)
      const heroLabels = document.querySelectorAll('.text-xl.font-medium.text-neutral-text-1');
      for (const el of heroLabels) {
        const text = el.textContent.trim();
        if (text === 'Items sold' || text === 'Current viewers') {
          const valueEl = el.nextElementSibling;
          if (valueEl) {
            const key = metricLabels[text];
            metrics[key] = valueEl.textContent.trim();
          }
        }
      }

      // Strategy 2: Extract detail metrics
      const detailLabels = document.querySelectorAll('.text-base.text-neutral-text-1.truncate, .text-base.text-neutral-text-1');
      for (const el of detailLabels) {
        const text = el.textContent.trim();
        const key = metricLabels[text];
        if (key) {
          const valueEl = el.nextElementSibling;
          if (valueEl) {
            // Get only the direct text content of the value element,
            // not nested children (which may contain other metric values)
            // This prevents concatenation like "0.07%39.67%"
            let value = '';
            // First try: get text from first child text node only
            for (const node of valueEl.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent.trim();
                if (t) { value = t; break; }
              }
            }
            // If no direct text node, try first child element
            if (!value && valueEl.firstElementChild) {
              value = valueEl.firstElementChild.textContent.trim();
            }
            // Fallback: use full textContent but sanitize concatenated values
            if (!value) {
              value = valueEl.textContent.trim();
              // Detect concatenated percentages like "0.07%39.67%"
              const pctMatches = value.match(/(\d+\.?\d*%)/g);
              if (pctMatches && pctMatches.length >= 2) {
                value = pctMatches[0]; // Take only the first value
              }
            }
            metrics[key] = value;
          }
        }
      }

      // Strategy 3: Extract GMV (the big number)
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent.trim();
        if (text.match(/^GMV\s*(\(.*\))?$/)) {
          const container = span.closest('[class*="flex"][class*="col"]') || span.parentElement?.parentElement;
          if (container) {
            const numberEls = container.querySelectorAll('div, span');
            for (const numEl of numberEls) {
              const numText = numEl.textContent.trim();
              if (/^[\d,]+$/.test(numText) && numText.length > 3) {
                metrics['gmv'] = numText;
                break;
              }
            }
          }
        }
      }

      // Strategy 4: Fallback - generic label-value extraction
      if (Object.keys(metrics).length < 3) {
        const allElements = document.querySelectorAll('div');
        for (const el of allElements) {
          if (el.children.length > 3) continue;
          const text = el.textContent.trim();
          
          for (const [label, key] of Object.entries(metricLabels)) {
            if (text === label && !metrics[key]) {
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
      }

      log('Workbench metrics extracted:', Object.keys(metrics).length, 'keys:', Object.keys(metrics));
      return metrics;
    },

    /**
     * Extract comments from the comment container
     * 
     * DOM structure (confirmed):
     * - Container: div[class*="commentContainer--"]
     * - Each comment: div[class*="comment--"] (not commentContainer)
     *   - Child 1: span[class*="username--"] (text: "Rimi🌹:")
     *   - Child 2: span[class*="commentContent--"] (text: "やえちゃん❣️")
     */
    extractComments() {
      const comments = [];
      
      // Primary: Find comment elements by CSS module class pattern
      const commentEls = document.querySelectorAll('[class*="comment--"]');
      
      for (const el of commentEls) {
        // Skip the container itself (commentContainer--)
        if (el.className.includes('commentContainer')) continue;
        
        // Find username and content spans
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
        
        // Extract user tags if present
        const tagEls = el.querySelectorAll('[class*="userTag"], [class*="tag"]');
        const tags = Array.from(tagEls).map(t => t.textContent.trim()).filter(t => t);
        
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

      if (comments.length > 0) log('Workbench comments extracted:', comments.length);
      return comments.slice(-MAX_COMMENTS_PER_BATCH);
    },

    /**
     * Extract product table data
     * 
     * DOM structure (confirmed):
     * - Product table: the table with most rows (147+)
     * - Each row has 9 cells:
     *   [0] No. (e.g. "78")
     *   [1] Product name + ID (has <a> link, text: "セインムー...ID: 173...")
     *   [2] Pin status ("Pinned" or empty)
     *   [3] GMV ("161,577円")
     *   [4] Items sold ("59")
     *   [5] Add-to-cart count ("138")
     *   [6] Product Clicks ("698")
     *   [7] Product Impressions ("1,843")
     *   [8] Click-Through Rate ("37.87%")
     */
    extractProducts() {
      const products = [];
      const tables = document.querySelectorAll('table');
      
      // Find the product table - it's the one with the most rows
      let productTable = null;
      let maxRows = 0;
      for (const t of tables) {
        const rowCount = t.querySelectorAll('tr').length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          productTable = t;
        }
      }

      if (!productTable) {
        log('No product table found');
        return products;
      }

      const rows = productTable.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) continue;

        const no = cells[0]?.textContent.trim();
        const nameCell = cells[1];
        const name = nameCell?.querySelector('a')?.textContent.trim() || 
                     nameCell?.textContent.trim() || '';
        
        // Extract product ID
        const idMatch = nameCell?.textContent.match(/ID:\s*(\d+)/);
        const productId = idMatch ? idMatch[1] : '';

        // Determine column mapping based on cell count
        let isPinned, gmv, sold, cartCount, clicks, impressions, ctr;

        if (cells.length >= 9) {
          isPinned = cells[2]?.textContent.trim() === 'Pinned';
          gmv = cells[3]?.textContent.trim() || '0';
          sold = cells[4]?.textContent.trim() || '0';
          cartCount = cells[5]?.textContent.trim() || '0';
          clicks = cells[6]?.textContent.trim() || '0';
          impressions = cells[7]?.textContent.trim() || '0';
          ctr = cells[8]?.textContent.trim() || '0%';
        } else if (cells.length >= 8) {
          isPinned = row.textContent.includes('Pinned');
          gmv = cells[2]?.textContent.trim() || '0';
          sold = cells[3]?.textContent.trim() || '0';
          cartCount = cells[4]?.textContent.trim() || '0';
          clicks = cells[5]?.textContent.trim() || '0';
          impressions = cells[6]?.textContent.trim() || '0';
          ctr = cells[7]?.textContent.trim() || '0%';
        } else {
          isPinned = row.textContent.includes('Pinned');
          gmv = cells[2]?.textContent.trim() || '0';
          sold = cells[3]?.textContent.trim() || '0';
          cartCount = cells[4]?.textContent.trim() || '0';
          clicks = cells[5]?.textContent.trim() || '0';
          impressions = cells[6]?.textContent.trim() || '0';
          ctr = '0%';
        }

        // Clean product name (remove ID suffix)
        const cleanName = name.replace(/ID:\s*\d+/g, '').trim();

        if (cleanName && cleanName.length > 3) {
          products.push({
            no: parseInt(no) || 0,
            name: cleanName.substring(0, 150),
            product_id: productId,
            pinned: isPinned,
            gmv,
            sold,
            cart_count: cartCount,
            clicks,
            impressions,
            ctr
          });
        }
      }

      log('Workbench products extracted:', products.length);
      return products;
    },

    /**
     * Extract traffic source data
     * 
     * DOM structure (confirmed):
     * - Table with headers: ["Channel", "GMV", "Impressions", "Views"]
     * - 24 rows of traffic data
     */
    extractTrafficSources() {
      const sources = [];
      const tables = document.querySelectorAll('table');
      
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('th')).map(h => h.textContent.trim());
        if (headers.includes('Channel') && (headers.includes('Views') || headers.includes('Impressions'))) {
          const rows = table.querySelectorAll('tr');
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

      log('Workbench traffic sources extracted:', sources.length);
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
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  // ============================================================
  // Main Polling Loop
  // ============================================================
  function startPolling() {
    if (isRunning) return;
    isRunning = true;

    log(`Starting data extraction on ${pageType} page`);

    const account = extractAccount();
    let roomId = extractRoomId();
    const region = extractRegion();

    // Generate a stable room_id when URL doesn't contain one
    // This prevents creating a new session every time the page loads
    if (!roomId && account) {
      // Use account name as stable identifier
      roomId = 'acct_' + account;
    } else if (!roomId) {
      // Last resort: use a daily-stable ID so at least within the same day
      // the same session is reused
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      roomId = 'day_' + today;
    }

    log(`Account: ${account}, Room: ${roomId}, Region: ${region}`);

    // Notify background that live session started
    // background.js will deduplicate and reuse existing sessions
    chrome.runtime.sendMessage({
      type: 'LIVE_STARTED',
      data: {
        source: pageType,
        roomId,
        account,
        region
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

        // Only send if metrics changed or products exist
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
          log('Sent LIVE_DATA with', Object.keys(metrics).length, 'metrics,', products.length, 'products,', trafficSources.length, 'traffic sources');
        }
      } catch (err) {
        console.error('[AitherHub] Metrics extraction error:', err);
      }
    }, POLL_INTERVAL_MS);
    pollTimers.push(metricsTimer);

    // Comment polling (workbench has comment container)
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
            log('Sent', comments.length, 'new comments');
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
    log('Stopped data extraction');
  }

  // ============================================================
  // MutationObserver for Real-time Updates
  // ============================================================
  function setupMutationObserver() {
    // Watch for new comments (workbench)
    const commentContainer = document.querySelector('[class*="commentContainer"]');
    if (commentContainer) {
      log('MutationObserver attached to comment container');
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
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
    } else {
      log('Comment container not found for MutationObserver, will retry...');
      setTimeout(() => {
        const container = document.querySelector('[class*="commentContainer"]');
        if (container) {
          log('MutationObserver attached to comment container (retry)');
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.addedNodes.length > 0) {
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
          observer.observe(container, { childList: true, subtree: true });
        }
      }, 5000);
    }

    // Watch for activity updates (streamer page)
    if (pageType === 'streamer') {
      const activityContainer = document.querySelector('[class*="activity"], [class*="Activity"], [class*="sc-"]');
      if (activityContainer) {
        log('MutationObserver attached to activity container');
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
      log('Unknown page type, not activating');
      return;
    }

    log(`Detected ${pageType} page, waiting for content to load...`);

    // Wait for page content to be ready
    const checkReady = setInterval(() => {
      const root = document.querySelector('#root');
      const hasContent = root && root.textContent.length > 100;
      if (hasContent) {
        clearInterval(checkReady);
        log('Page content ready, starting polling');
        startPolling();
      }
    }, 1000);

    // Timeout after 60 seconds
    setTimeout(() => {
      clearInterval(checkReady);
      if (!isRunning) {
        log('Timeout waiting for content, starting anyway');
        startPolling();
      }
    }, 60000);

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      stopPolling();
    });
  }

  // Start
  init();

})();
