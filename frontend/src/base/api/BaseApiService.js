import axios from "axios";
import TokenManager from "../utils/tokenManager";

export default class BaseApiService {
  constructor(baseURL) {
    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add request interceptor to include JWT token
    this.client.interceptors.request.use(
      (config) => {
        const token = TokenManager.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
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
