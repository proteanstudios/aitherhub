export const AUTH_URLS = {
  LOGIN: '/login',
  REGISTER: '/register',
};

export function isAuthEndpoint(url) {
  if (!url) return false;
  try {
    // Consider full URLs and relative paths
    const u = String(url);
    return u.includes('/auth');
  } catch (e) {
    return false;
  }
}
