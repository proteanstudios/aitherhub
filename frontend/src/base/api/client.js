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
        handleAutoLogout();
        return Promise.reject(new Error('Token expired - auto logout'));
      }
    } else {
      const token = config.token || TokenManager.getToken();
      
      if (token) {
        if (TokenManager.isTokenExpired(token)) {
          handleAutoLogout();
          return Promise.reject(new Error('Token expired - auto logout'));
        }
        config.headers.Authorization = `Bearer ${token}`;
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
      originalRequest._retry = true;

      // Don't auto logout if this is an auth endpoint (login/register)
      // Let the component handle the error and display it in the modal
      const requestUrl = originalRequest?.url || '';
      const isAuthRequest = isAuthEndpoint(requestUrl);

      const errorMessage = error.response?.data?.message || '';
      const isSignatureError = errorMessage.toLowerCase().includes('signature') || 
                              errorMessage.toLowerCase().includes('token') ||
                              errorMessage.toLowerCase().includes('jwt');

      // If it's an auth endpoint (login/register), just reject the error
      // Don't try to refresh token or logout
      if (isAuthRequest) {
        return Promise.reject(error);
      }

      if (isSignatureError) {
        handleAutoLogout();
        return Promise.reject(new Error('Token signature verification failed'));
      }

      try {
        const refreshToken = TokenManager.getRefreshToken();
        if (refreshToken) {
          const response = await axios.post(`${API_CONFIG.BASE_URL}/auth/refresh`, {
            refreshToken,
          });

          const { token, refreshToken: newRefreshToken } = response.data;
          
          const tokenStored = TokenManager.setToken(token);
          if (newRefreshToken) {
            TokenManager.setRefreshToken(newRefreshToken);
          }
          
          if (tokenStored) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          } else {
            throw new Error('Failed to store refreshed token');
          }
        } else {
          throw new Error('No refresh token available');
        }
      } catch (refreshError) {
        handleAutoLogout();
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 Forbidden - auto logout and open login modal
    if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
      const requestUrl = originalRequest?.url || '';
      // Don't auto logout if this is an auth endpoint
      if (!isAuthEndpoint(requestUrl)) {
        handleAutoLogout();
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
