/**
 * AitherHub LIVE Connector - Background Service Worker v1.4.0
 * 
 * Handles:
 * - Receiving data from content scripts (content.js + ai_commander.js)
 * - Sending data to AitherHub API
 * - AI analysis requests forwarding
 * - Managing connection state
 * - Token refresh
 * - Periodic health checks
 */

const DEFAULT_API_BASE = 'https://aitherhubapi-cpcjcnezbgf5f7e2.japaneast-01.azurewebsites.net';
const SEND_INTERVAL_MS = 5000; // 5 seconds

// State
let apiBase = DEFAULT_API_BASE;
let apiToken = '';
let refreshToken = '';
let isConnected = false;
let lastSendTime = 0;
let pendingData = null;
let sessionStartTime = null;

// Stats tracking
let stats = {
  dataSent: 0,
  comments: 0,
  products: 0,
  uptime: 0,
  aiAnalyses: 0
};

// Load settings from storage on startup
chrome.storage.local.get(['apiBase', 'accessToken', 'apiToken', 'refreshToken'], (result) => {
  if (result.apiBase) apiBase = result.apiBase;
  // Prefer accessToken (new login flow), fall back to apiToken (legacy)
  apiToken = result.accessToken || result.apiToken || '';
  refreshToken = result.refreshToken || '';
  console.log('[AitherHub BG] Loaded config, hasToken:', !!apiToken);
});

// Listen for storage changes (e.g., when popup saves new tokens)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.accessToken) {
      apiToken = changes.accessToken.newValue || '';
      console.log('[AitherHub BG] Token updated from storage');
    }
    if (changes.apiToken) {
      apiToken = changes.apiToken.newValue || apiToken;
    }
    if (changes.apiBase) {
      apiBase = changes.apiBase.newValue || DEFAULT_API_BASE;
    }
    if (changes.refreshToken) {
      refreshToken = changes.refreshToken.newValue || '';
    }
  }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'LIVE_DATA':
      handleLiveData(message.data, sender.tab);
      sendResponse({ status: 'received' });
      break;

    case 'LIVE_STARTED':
      handleLiveStarted(message.data, sender.tab);
      sendResponse({ status: 'ok' });
      break;

    case 'LIVE_ENDED':
      handleLiveEnded(message.data);
      sendResponse({ status: 'ok' });
      break;

    case 'AI_ANALYZE':
      // Forward AI analysis request to backend
      handleAiAnalyze(message.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ 
          suggestions: [{
            type: 'info',
            text: 'AI分析に接続できませんでした: ' + err.message
          }]
        }));
      return true; // Keep channel open for async response

    case 'GET_STATUS':
      sendResponse({
        isConnected,
        apiBase,
        hasToken: !!apiToken,
        lastSendTime,
        stats: {
          ...stats,
          uptime: sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0
        }
      });
      break;

    case 'SET_CONFIG':
      if (message.apiBase !== undefined) apiBase = message.apiBase || DEFAULT_API_BASE;
      if (message.apiToken !== undefined) apiToken = message.apiToken || '';
      chrome.storage.local.set({
        apiBase: apiBase,
        apiToken: apiToken,
        accessToken: apiToken
      });
      sendResponse({ status: 'saved' });
      break;

    case 'BRIDGE_TOKEN_SYNC':
      // Token synced from AitherHub website via aitherhub_bridge.js
      if (message.accessToken) {
        apiToken = message.accessToken;
        refreshToken = message.refreshToken || refreshToken;
        chrome.storage.local.set({
          accessToken: apiToken,
          apiToken: apiToken,
          refreshToken: refreshToken
        });
        console.log('[AitherHub BG] Token synced from AitherHub website');
        sendResponse({ status: 'saved' });
      } else {
        sendResponse({ status: 'no_token' });
      }
      break;

    default:
      sendResponse({ status: 'unknown_type' });
  }
  return true; // Keep message channel open for async response
});

/**
 * Handle live session start
 * Deduplicates: if we already have an active session for the same account,
 * reuse it regardless of source (streamer vs workbench).
 * Both pages share the same session so their metrics are merged.
 */
async function handleLiveStarted(data, tab) {
  console.log('[AitherHub BG] Live session started:', data);

  // Check if we already have an active session for the same account
  // Note: We ignore source (streamer/workbench) for deduplication because
  // both pages should share the same session to merge their metrics
  const existing = await chrome.storage.local.get(['liveSessionId', 'liveSessionAccount', 'liveSessionSource']);
  if (existing.liveSessionId && 
      existing.liveSessionAccount === data.account && 
      isConnected) {
    console.log('[AitherHub BG] Reusing existing session for', data.source, ':', existing.liveSessionId);
    // Already connected with same account, skip creating new session
    return;
  }

  sessionStartTime = Date.now();
  stats = { dataSent: 0, comments: 0, products: 0, uptime: 0, aiAnalyses: 0 };
  
  const payload = {
    event: 'live_started',
    source: data.source,
    room_id: data.roomId,
    account: data.account,
    region: data.region,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await sendToAPI('/api/v1/live/extension/session/start', payload);
    if (response && response.session_id) {
      chrome.storage.local.set({ 
        liveSessionId: response.session_id,
        liveSessionAccount: data.account || '',
        liveSessionSource: data.source || ''
      });
      isConnected = true;
      updateBadge('ON', '#00C853');
    }
  } catch (err) {
    console.error('[AitherHub BG] Failed to start session:', err);
    updateBadge('ERR', '#FF1744');
  }
}

/**
 * Handle live session end
 */
async function handleLiveEnded(data) {
  console.log('[AitherHub BG] Live session ended');
  
  const sessionId = (await chrome.storage.local.get('liveSessionId')).liveSessionId;
  if (sessionId) {
    try {
      await sendToAPI('/api/v1/live/extension/session/end', {
        session_id: sessionId,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[AitherHub BG] Failed to end session:', err);
    }
  }

  isConnected = false;
  sessionStartTime = null;
  chrome.storage.local.remove(['liveSessionId', 'liveSessionAccount', 'liveSessionSource']);
  updateBadge('', '');
}

/**
 * Handle incoming live data from content scripts
 */
async function handleLiveData(data, tab) {
  const now = Date.now();
  
  // Throttle: merge data if sending too frequently
  if (pendingData && (now - lastSendTime) < SEND_INTERVAL_MS) {
    pendingData = mergeData(pendingData, data);
    return;
  }

  const sessionId = (await chrome.storage.local.get('liveSessionId')).liveSessionId;
  
  const payload = {
    session_id: sessionId,
    source: data.source,
    timestamp: new Date().toISOString(),
    metrics: data.metrics || {},
    comments: data.comments || [],
    products: data.products || [],
    activities: data.activities || [],
    traffic_sources: data.trafficSources || [],
    suggestions: data.suggestions || []
  };

  try {
    await sendToAPI('/api/v1/live/extension/data', payload);
    lastSendTime = now;
    pendingData = null;
    
    // Update stats
    stats.dataSent++;
    stats.comments += (data.comments || []).length;
    stats.products = Math.max(stats.products, (data.products || []).length);
    
    updateBadge('ON', '#00C853');
  } catch (err) {
    console.error('[AitherHub BG] Failed to send data:', err);
    pendingData = data; // Retry next time
    
    // If 401, try to refresh token
    if (err.message && err.message.includes('401')) {
      await tryRefreshToken();
    }
    
    updateBadge('ERR', '#FF1744');
  }
}

/**
 * Handle AI analysis request from AI Commander panel
 */
async function handleAiAnalyze(snapshot) {
  console.log('[AitherHub BG] AI analysis requested');
  stats.aiAnalyses++;

  try {
    const result = await sendToAPI('/api/v1/live/ai/analyze', snapshot);
    return result;
  } catch (err) {
    console.error('[AitherHub BG] AI analysis API failed:', err);
    
    // If 401, try to refresh token and retry
    if (err.message && err.message.includes('401')) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        try {
          return await sendToAPI('/api/v1/live/ai/analyze', snapshot);
        } catch (retryErr) {
          throw retryErr;
        }
      }
    }
    
    throw err;
  }
}

/**
 * Merge two data objects (for throttling)
 * IMPORTANT: metrics must be MERGED (not replaced) because Streamer and Workbench
 * pages send different metric keys. Replacing would lose one source's data.
 */
function mergeData(existing, incoming) {
  return {
    ...incoming,
    // Deep merge metrics so both Streamer and Workbench metrics are preserved
    metrics: { ...(existing.metrics || {}), ...(incoming.metrics || {}) },
    comments: [...(existing.comments || []), ...(incoming.comments || [])],
    activities: [...(existing.activities || []), ...(incoming.activities || [])],
    products: incoming.products || existing.products,
    trafficSources: incoming.trafficSources || existing.trafficSources
  };
}

/**
 * Send data to AitherHub API
 */
async function sendToAPI(endpoint, payload) {
  const url = `${apiBase}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Try to refresh the access token using the refresh token
 */
async function tryRefreshToken() {
  if (!refreshToken) {
    console.log('[AitherHub BG] No refresh token available');
    return false;
  }

  try {
    const response = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      console.error('[AitherHub BG] Token refresh failed:', response.status);
      // Clear tokens - user needs to re-login
      apiToken = '';
      refreshToken = '';
      await chrome.storage.local.remove(['accessToken', 'apiToken', 'refreshToken']);
      return false;
    }

    const data = await response.json();
    apiToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;

    await chrome.storage.local.set({
      accessToken: apiToken,
      apiToken: apiToken,
      refreshToken: refreshToken
    });

    console.log('[AitherHub BG] Token refreshed successfully');
    return true;
  } catch (err) {
    console.error('[AitherHub BG] Token refresh error:', err);
    return false;
  }
}

/**
 * Update extension badge
 */
function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

// Periodic flush of pending data
chrome.alarms.create('flushData', { periodInMinutes: 0.1 }); // Every 6 seconds

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flushData' && pendingData) {
    const data = pendingData;
    pendingData = null;
    await handleLiveData(data, null);
  }
});
