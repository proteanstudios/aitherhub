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
          if (TokenManager.isTokenExpired(token)) {
            handleAutoLogout();
            return Promise.reject(new Error('Token expired - auto logout'));
          }
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const requestUrl = error.config?.url || '';
        const isAuthRequest = isAuthEndpoint(requestUrl);

        // Handle 401 Unauthorized
        if (error.response?.status === 401) {
          // Don't auto logout if this is an auth endpoint (login/register)
          // Let the component handle the error and display it in the modal
          if (!isAuthRequest) {
            handleAutoLogout();
          }
        }

        // Handle 403 Forbidden - auto logout and open login modal
        if (error.response?.status === 403) {
          // Don't auto logout if this is an auth endpoint
          if (!isAuthRequest) {
            handleAutoLogout();
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
