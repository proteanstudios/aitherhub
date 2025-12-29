const TOKEN_KEY = 'app_access_token';
const REFRESH_KEY = 'app_refresh_token';

function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch (e) {
    console.error('Failed to store token', e);
    return false;
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setRefreshToken(token) {
  try {
    localStorage.setItem(REFRESH_KEY, token);
    return true;
  } catch (e) {
    console.error('Failed to store refresh token', e);
    return false;
  }
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

function _parseJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = _parseJwt(token);
  if (!payload) return true;
  if (!payload.exp) return false; // not JWT or no exp
  const exp = payload.exp; // exp is unix timestamp in seconds
  return Date.now() / 1000 > exp;
}

function isValidJWT(token) {
  return !!_parseJwt(token);
}

export default {
  setToken,
  getToken,
  setRefreshToken,
  getRefreshToken,
  clearTokens,
  isTokenExpired,
  isValidJWT,
};