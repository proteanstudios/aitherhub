import axios from 'axios';
import { API_CONFIG, HTTP_STATUS } from './config';
import TokenManager from '../utils/tokenManager';
import { AUTH_URLS, isAuthEndpoint } from '../../constants/authConstants';
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
  AuthService.logout();
  if (!isAuthEndpoint(window.location.pathname)) {
    window.location.href = AUTH_URLS.LOGIN;
  }
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

    if (error.response?.status === HTTP_STATUS.UNAUTHORIZED && !originalRequest._retry) {
      originalRequest._retry = true;

      const errorMessage = error.response?.data?.message || '';
      const isSignatureError = errorMessage.toLowerCase().includes('signature') || 
                              errorMessage.toLowerCase().includes('token') ||
                              errorMessage.toLowerCase().includes('jwt');

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

    return Promise.reject(error);
  }
);

export default apiClient;
