// API Configuration - reads values from Vite environment variables
const isDev = (import.meta.env.VITE_NODE_ENV || import.meta.env.MODE) === 'development';
export const API_CONFIG = {
  // When developing locally, use relative URLs so Vite dev server proxy is used and avoids CORS
  BASE_URL: isDev ? '' : (import.meta.env.VITE_API_BASE_URL || ''),
  TIMEOUT: Number(import.meta.env.VITE_API_TIMEOUT) || 30000,
  RETRY_ATTEMPTS: Number(import.meta.env.VITE_API_RETRY_ATTEMPTS) || 3,
  RETRY_DELAY: Number(import.meta.env.VITE_API_RETRY_DELAY) || 1000,
};
// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};
