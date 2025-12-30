import axios from 'axios';
import { API_CONFIG, HTTP_STATUS } from './config';
import TokenManager from '../utils/tokenManager';
import { AUTH_URLS, isAuthEndpoint } from '../../constants/authConstants';
// import { getCurrentStoreId } from '../../utils/storeHelpers';

const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Check if Authorization header is already set
    if (config.headers && config.headers.Authorization) {
      // Validate the token from headers
      const existingToken = config.headers.Authorization.replace('Bearer ', '');
      if (!TokenManager.isValidJWT(existingToken) || TokenManager.isTokenExpired(existingToken)) {
        delete config.headers.Authorization;
        TokenManager.clearTokens();
      }
    } else {
      // Get token using TokenManager for consistent handling
      const token = config.token || TokenManager.getToken();
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        // Only redirect to login if this is not already an auth endpoint
        if (!isAuthEndpoint(config.url)) {
          window.location.href = AUTH_URLS.LOGIN;
          return Promise.reject(new Error('No valid token - redirecting to login'));
        }
      }
    }

    // Add store_id header if available and not an auth endpoint
    // Commented out - not needed for this project
    // if (!isAuthEndpoint(config.url)) {
    //   const storeId = getCurrentStoreId();
    //   if (storeId) {
    //     config.headers['store-id'] = storeId.toString();
    //   } else {
    //     console.warn(`⚠️ No store ID available from Redux for request: ${config.url}`);
    //   }
    // }

    // Add request timestamp
    config.metadata = { startTime: new Date() };

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle authentication errors
    if (error.response?.status === HTTP_STATUS.UNAUTHORIZED && !originalRequest._retry) {
      originalRequest._retry = true;

      // Check if it's a token signature error
      const errorMessage = error.response?.data?.message || '';
      const isSignatureError = errorMessage.toLowerCase().includes('signature') || 
                              errorMessage.toLowerCase().includes('token') ||
                              errorMessage.toLowerCase().includes('jwt');

      if (isSignatureError) {
        // Clear all authentication data using TokenManager
        TokenManager.clearTokens();
        
        // Redirect to login unless already on auth pages
        if (!isAuthEndpoint(window.location.pathname)) {
          window.location.href = AUTH_URLS.LOGIN;
        }
        
        return Promise.reject(new Error('Token signature verification failed'));
      }

      // Try to refresh token if available
      try {
        const refreshToken = TokenManager.getRefreshToken();
        if (refreshToken) {
          const response = await axios.post(`${API_CONFIG.BASE_URL}/auth/refresh`, {
            refreshToken,
          });

          const { token, refreshToken: newRefreshToken } = response.data;
          
          // Store new tokens using TokenManager
          const tokenStored = TokenManager.setToken(token);
          if (newRefreshToken) {
            TokenManager.setRefreshToken(newRefreshToken);
          }
          
          if (tokenStored) {
            // Retry original request
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          } else {
            throw new Error('Failed to store refreshed token');
          }
        } else {
          throw new Error('No refresh token available');
        }
      } catch (refreshError) {
        // Refresh failed, clear all tokens and redirect to login
        TokenManager.clearTokens();
        
        if (!isAuthEndpoint(window.location.pathname)) {
          window.location.href = AUTH_URLS.LOGIN;
        }
        
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
