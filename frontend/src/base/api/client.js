import axios from 'axios';
import { API_CONFIG, HTTP_STATUS } from './config';
import TokenManager from '../utils/tokenManager';
import { isAuthEndpoint } from '../../constants/authConstants';
import AuthService from '../services/userService';
// import { getCurrentStoreId } from '../../utils/storeHelpers';

const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const handleAutoLogout = () => {
  // First, perform logout (clear tokens and user data)
  AuthService.logout();
  // Then dispatch event to open login modal
  // Use setTimeout to ensure logout completes before opening modal
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('openLoginModal'));
  }, 0);
};

apiClient.interceptors.request.use(
  (config) => {
    if (config.headers && config.headers.Authorization) {
      const existingToken = config.headers.Authorization.replace('Bearer ', '');
      if (!TokenManager.isValidJWT(existingToken) || TokenManager.isTokenExpired(existingToken)) {
        delete config.headers.Authorization;
        // Don't auto logout here - let the refresh interceptor handle it
      }
    } else {
      const token = config.token || TokenManager.getToken();
      
      if (token) {
        if (!TokenManager.isTokenExpired(token)) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        // Don't auto logout on expired token - let refresh handle it
      } else {
        if (!isAuthEndpoint(config.url)) {
          handleAutoLogout();
          return Promise.reject(new Error('No valid token - redirecting to login'));
        }
      }
    }

    config.metadata = { startTime: new Date() };

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized
    if (error.response?.status === HTTP_STATUS.UNAUTHORIZED && !originalRequest._retry) {
      // Don't auto logout if this is an auth endpoint (login/register)
      // Let the component handle the error and display it in the modal
      const requestUrl = originalRequest?.url || '';
      const isAuthRequest = isAuthEndpoint(requestUrl);

      // If it's an auth endpoint (login/register), just reject the error
      // Don't try to refresh token or logout
      if (isAuthRequest) {
        return Promise.reject(error);
      }

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = TokenManager.getRefreshToken();
        if (refreshToken && !TokenManager.isTokenExpired(refreshToken)) {
          const response = await axios.post(`${API_CONFIG.BASE_URL}/api/v1/auth/refresh`, {
            refresh_token: refreshToken,
          });

          const { token, refreshToken: newRefreshToken } = response.data;
          
          const tokenStored = TokenManager.setToken(token);
          if (newRefreshToken) {
            TokenManager.setRefreshToken(newRefreshToken);
          }
          
          isRefreshing = false;

          if (tokenStored) {
            processQueue(null, token);
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          } else {
            throw new Error('Failed to store refreshed token');
          }
        } else {
          throw new Error('No valid refresh token available');
        }
      } catch (refreshError) {
        isRefreshing = false;
        processQueue(refreshError, null);
        handleAutoLogout();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
