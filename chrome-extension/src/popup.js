/**
 * AitherHub LIVE Connector - Popup Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const apiBaseInput = document.getElementById('apiBase');
  const apiTokenInput = document.getElementById('apiToken');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const messageEl = document.getElementById('message');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statsSection = document.getElementById('statsSection');

  // Load saved settings
  chrome.storage.local.get(['apiBase', 'apiToken'], (result) => {
    if (result.apiBase) apiBaseInput.value = result.apiBase;
    if (result.apiToken) apiTokenInput.value = result.apiToken;
  });

  // Check connection status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      if (response.isConnected) {
        statusDot.classList.add('connected');
        statusText.textContent = 'ライブ接続中';
        statsSection.style.display = 'block';
      } else if (response.hasToken) {
        statusText.textContent = 'TikTok Shopページを開いてください';
      } else {
        statusText.textContent = '未設定 - API設定を入力してください';
      }
    }
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const apiBase = apiBaseInput.value.trim();
    const apiToken = apiTokenInput.value.trim();

    if (!apiBase) {
      showMessage('API Base URLを入力してください', 'error');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'SET_CONFIG',
      apiBase,
      apiToken
    }, (response) => {
      if (response && response.status === 'saved') {
        showMessage('設定を保存しました', 'success');
      } else {
        showMessage('保存に失敗しました', 'error');
      }
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const apiBase = apiBaseInput.value.trim();
    const apiToken = apiTokenInput.value.trim();

    if (!apiBase) {
      showMessage('API Base URLを入力してください', 'error');
      return;
    }

    testBtn.textContent = 'テスト中...';
    testBtn.disabled = true;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

      const response = await fetch(`${apiBase}/api/v1/live/extension/health`, {
        method: 'GET',
        headers
      });

      if (response.ok) {
        showMessage('接続成功！', 'success');
        statusDot.classList.add('connected');
        statusText.textContent = '接続確認済み';
      } else {
        showMessage(`接続エラー: ${response.status} ${response.statusText}`, 'error');
        statusDot.classList.add('error');
      }
    } catch (err) {
      showMessage(`接続失敗: ${err.message}`, 'error');
      statusDot.classList.add('error');
    } finally {
      testBtn.textContent = '接続テスト';
      testBtn.disabled = false;
    }
  });

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    setTimeout(() => {
      messageEl.className = 'message';
    }, 5000);
  }
});
