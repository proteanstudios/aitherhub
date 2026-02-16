import axios from "axios";
import TokenManager from "../utils/tokenManager";
import AuthService from "../services/userService";
import { isAuthEndpoint } from "../../constants/authConstants";

export default class BaseApiService {
  constructor(baseURL) {
    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
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

    this.client.interceptors.request.use(
      (config) => {
        const token = TokenManager.getToken();
        if (token) {
          if (!TokenManager.isTokenExpired(token)) {
            config.headers.Authorization = \`Bearer \${token}\`;
          }
          // Don't auto logout on expired token - let refresh handle it
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        const requestUrl = originalRequest?.url || '';
        const isAuthRequest = isAuthEndpoint(requestUrl);

        // Handle 401 Unauthorized
        if (error.response?.status === 401 && !originalRequest._retry) {
          // Don't auto logout if this is an auth endpoint (login/register)
          if (isAuthRequest) {
            return Promise.reject(error);
          }

          // If already refreshing, queue this request
          if (isRefreshing) {
            return new Promise((resolve, reject) => {
              failedQueue.push({ resolve, reject });
            }).then(token => {
              originalRequest.headers.Authorization = \`Bearer \${token}\`;
              return this.client(originalRequest);
            }).catch(err => {
              return Promise.reject(err);
            });
          }

          originalRequest._retry = true;
          isRefreshing = true;

          try {
            const refreshToken = TokenManager.getRefreshToken();
            if (refreshToken && !TokenManager.isTokenExpired(refreshToken)) {
              const response = await axios.post(\`\${baseURL}/api/v1/auth/refresh\`, {
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
                originalRequest.headers.Authorization = \`Bearer \${token}\`;
                return this.client(originalRequest);
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
  }

  async post(url, data, config = {}) {
    const res = await this.client.post(url, data, config);
    return res.data;
  }

  async get(url, config = {}) {
    const res = await this.client.get(url, config);
    return res.data;
  }

  async delete(url, config = {}) {
    const res = await this.client.delete(url, config);
    return res.data;
  }
}
