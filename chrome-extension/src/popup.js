/**
 * AitherHub LIVE Connector - Popup Script v1.1.0
 * Email/Password login with automatic JWT token management
 */

const API_BASE = 'https://aitherhubapi-cpcjcnezbgf5f7e2.japaneast-01.azurewebsites.net';

document.addEventListener('DOMContentLoaded', () => {
  // Elements - Login
  const loginSection = document.getElementById('loginSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  // Elements - Dashboard
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const liveDot = document.getElementById('liveDot');
  const liveInfo = document.getElementById('liveInfo');

  // Stats elements
  const statDataSent = document.getElementById('statDataSent');
  const statComments = document.getElementById('statComments');
  const statProducts = document.getElementById('statProducts');
  const statUptime = document.getElementById('statUptime');

  // ============================================================
  // Initialization - Check if already logged in
  // ============================================================
  chrome.storage.local.get(['accessToken', 'refreshToken', 'userEmail', 'userName'], (result) => {
    if (result.accessToken && result.userEmail) {
      showDashboard(result.userEmail, result.userName || '');
      checkConnectionStatus();
    } else {
      showLogin();
    }
  });

  // ============================================================
  // Login Handler
  // ============================================================
  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    // Validation
    if (!email) {
      showError('メールアドレスを入力してください');
      return;
    }
    if (!password) {
      showError('パスワードを入力してください');
      return;
    }

    // Disable button and show loading
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="loading-spinner"></span>ログイン中...';
    hideError();

    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.detail || `ログインに失敗しました (${response.status})`;
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const accessToken = data.access_token;
      const refreshToken = data.refresh_token;

      if (!accessToken) {
        throw new Error('トークンの取得に失敗しました');
      }

      // Save tokens and user info to chrome.storage.local
      await chrome.storage.local.set({
        accessToken: accessToken,
        refreshToken: refreshToken,
        apiToken: accessToken,  // backward compat with background.js
        apiBase: API_BASE,
        userEmail: email,
        userName: email.split('@')[0]
      });

      // Notify background script of new config
      chrome.runtime.sendMessage({
        type: 'SET_CONFIG',
        apiBase: API_BASE,
        apiToken: accessToken
      });

      // Show dashboard
      showDashboard(email, email.split('@')[0]);
      
      // Update status
      updateStatus('connected', 'ログイン成功');

    } catch (err) {
      console.error('[AitherHub] Login error:', err);
      showError(err.message);
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'ログイン';
    }
  });

  // Enter key to submit
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });

  // ============================================================
  // Logout Handler
  // ============================================================
  logoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove([
      'accessToken', 'refreshToken', 'apiToken', 'apiBase',
      'userEmail', 'userName', 'liveSessionId'
    ]);

    // Notify background
    chrome.runtime.sendMessage({
      type: 'SET_CONFIG',
      apiBase: '',
      apiToken: ''
    });

    showLogin();
    updateStatus('disconnected', '未接続');
  });

  // ============================================================
  // UI Helpers
  // ============================================================
  function showLogin() {
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
  }

  function showDashboard(email, name) {
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');

    // Set user info
    userEmail.textContent = email;
    userName.textContent = name || email.split('@')[0];
    userAvatar.textContent = (name || email).charAt(0).toUpperCase();
  }

  function showError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }

  function hideError() {
    loginError.style.display = 'none';
  }

  function updateStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  // ============================================================
  // Connection Status Check
  // ============================================================
  function checkConnectionStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        updateStatus('disconnected', '拡張機能エラー');
        return;
      }
      if (response) {
        if (response.isConnected) {
          updateStatus('connected', 'ライブ接続中');
          liveDot.className = 'status-dot connected';
          liveInfo.textContent = 'データ送信中';
        } else if (response.hasToken) {
          updateStatus('connected', 'ログイン済み');
          liveDot.className = 'status-dot disconnected';
          liveInfo.textContent = 'TikTok Shop LIVEページを開いてください';
        } else {
          updateStatus('disconnected', '未接続');
        }

        // Update stats if available
        if (response.stats) {
          statDataSent.textContent = response.stats.dataSent || 0;
          statComments.textContent = response.stats.comments || 0;
          statProducts.textContent = response.stats.products || 0;
          if (response.stats.uptime) {
            statUptime.textContent = formatUptime(response.stats.uptime);
          }
        }
      }
    });
  }

  function formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  // Auto-refresh stats every 5 seconds when dashboard is visible
  setInterval(() => {
    if (!dashboardSection.classList.contains('hidden')) {
      checkConnectionStatus();
    }
  }, 5000);
});
