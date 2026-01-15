import axios from "axios";
import TokenManager from "../utils/tokenManager";
import AuthService from "../services/userService";
import { AUTH_URLS, isAuthEndpoint } from "../../constants/authConstants";

export default class BaseApiService {
  constructor(baseURL) {
    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const handleAutoLogout = () => {
      AuthService.logout();
      if (!isAuthEndpoint(window.location.pathname)) {
        window.location.href = AUTH_URLS.LOGIN;
      }
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
        if (error.response?.status === 401) {
          handleAutoLogout();
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
}
