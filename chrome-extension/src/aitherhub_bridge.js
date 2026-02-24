/**
 * AitherHub LIVE Connector - AitherHub Bridge Content Script
 * 
 * Runs on aitherhub.com pages.
 * Reads the JWT token from localStorage and sends it to the background script.
 * This allows the extension to authenticate with the AitherHub API
 * without requiring a separate login.
 */

(function() {
  'use strict';

  const TOKEN_KEY = 'app_access_token';
  const REFRESH_KEY = 'app_refresh_token';
  const CHECK_INTERVAL_MS = 5000; // Check every 5 seconds

  /**
   * Read tokens from localStorage and send to background script
   */
  function syncTokens() {
    try {
      const accessToken = localStorage.getItem(TOKEN_KEY);
      const refreshToken = localStorage.getItem(REFRESH_KEY);

      if (accessToken) {
        chrome.runtime.sendMessage({
          type: 'BRIDGE_TOKEN_SYNC',
          accessToken: accessToken,
          refreshToken: refreshToken || '',
        }, (response) => {
          if (chrome.runtime.lastError) {
            // Extension context invalidated - ignore
            return;
          }
          if (response && response.status === 'saved') {
            console.log('[AitherHub Bridge] Token synced to extension');
          }
        });
      }
    } catch (err) {
      // localStorage access may fail in some contexts
      console.warn('[AitherHub Bridge] Token sync error:', err);
    }
  }

  // Initial sync
  syncTokens();

  // Periodic sync (in case user logs in/out on the website)
  setInterval(syncTokens, CHECK_INTERVAL_MS);

  // Listen for storage changes (user login/logout on the website)
  window.addEventListener('storage', (event) => {
    if (event.key === TOKEN_KEY || event.key === REFRESH_KEY) {
      console.log('[AitherHub Bridge] Token changed in localStorage, syncing...');
      syncTokens();
    }
  });

  console.log('[AitherHub Bridge] Token bridge initialized');
})();
