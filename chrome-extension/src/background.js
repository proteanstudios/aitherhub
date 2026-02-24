/**
 * AitherHub LIVE Connector - Background Service Worker
 * 
 * Handles:
 * - Receiving data from content scripts
 * - Sending data to AitherHub API
 * - Managing connection state
 * - Periodic health checks
 */

const DEFAULT_API_BASE = 'https://api.aitherhub.com';
const SEND_INTERVAL_MS = 5000; // 5 seconds

// State
let apiBase = DEFAULT_API_BASE;
let apiToken = '';
let isConnected = false;
let lastSendTime = 0;
let pendingData = null;

// Load settings from storage
chrome.storage.local.get(['apiBase', 'apiToken', 'liveSessionId'], (result) => {
  if (result.apiBase) apiBase = result.apiBase;
  if (result.apiToken) apiToken = result.apiToken;
});

// Listen for messages from content scripts
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

    case 'GET_STATUS':
      sendResponse({
        isConnected,
        apiBase,
        hasToken: !!apiToken,
        lastSendTime
      });
      break;

    case 'SET_CONFIG':
      if (message.apiBase) apiBase = message.apiBase;
      if (message.apiToken) apiToken = message.apiToken;
      chrome.storage.local.set({
        apiBase: apiBase,
        apiToken: apiToken
      });
      sendResponse({ status: 'saved' });
      break;

    default:
      sendResponse({ status: 'unknown_type' });
  }
  return true; // Keep message channel open for async response
});

/**
 * Handle live session start
 */
async function handleLiveStarted(data, tab) {
  console.log('[AitherHub] Live session started:', data);
  
  const payload = {
    event: 'live_started',
    source: data.source, // 'streamer' or 'workbench'
    room_id: data.roomId,
    account: data.account,
    region: data.region,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await sendToAPI('/api/v1/live/extension/session/start', payload);
    if (response && response.session_id) {
      chrome.storage.local.set({ liveSessionId: response.session_id });
      isConnected = true;
      updateBadge('ON', '#00C853');
    }
  } catch (err) {
    console.error('[AitherHub] Failed to start session:', err);
    updateBadge('ERR', '#FF1744');
  }
}

/**
 * Handle live session end
 */
async function handleLiveEnded(data) {
  console.log('[AitherHub] Live session ended');
  
  const sessionId = (await chrome.storage.local.get('liveSessionId')).liveSessionId;
  if (sessionId) {
    try {
      await sendToAPI('/api/v1/live/extension/session/end', {
        session_id: sessionId,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[AitherHub] Failed to end session:', err);
    }
  }

  isConnected = false;
  chrome.storage.local.remove('liveSessionId');
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
    updateBadge('ON', '#00C853');
  } catch (err) {
    console.error('[AitherHub] Failed to send data:', err);
    pendingData = data; // Retry next time
    updateBadge('ERR', '#FF1744');
  }
}

/**
 * Merge two data objects (for throttling)
 */
function mergeData(existing, incoming) {
  return {
    ...incoming,
    metrics: incoming.metrics || existing.metrics,
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
