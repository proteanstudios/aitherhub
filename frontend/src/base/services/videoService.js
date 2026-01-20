import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';
import TokenManager from '../utils/tokenManager';

class VideoService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
  }

  async getVideosByUser(userId) {
    try {
      const response = await this.get(`/api/v1/videos/user/${userId}`);
      if (Array.isArray(response)) {
        return response;
      } else if (response?.data && Array.isArray(response.data)) {
        return response.data;
      } else if (response?.videos && Array.isArray(response.videos)) {
        return response.videos;
      }
      return [];
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 501) {
        return [
          {
            "id": "1",
            "original_filename": "富士山.mp4",
            "status": "completed",
            "created_at": "2026-01-08T00:00:00.000Z"
          },          
          {
            "id": "2",
            "original_filename": "video 2",
            "status": "processing",
            "created_at": "2026-01-08T00:00:00.000Z"
          },
        ];
      }
      return [];
    }
  }

  async getVideoById(videoId) {
    try {
      const response = await this.get(`/api/v1/videos/${videoId}`);
      if (response?.data) {
        return response.data;
      }
      return response;
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 501) {
        const mockVideoDetails = {
          "1": {
            "id": "1",
            "original_filename": "富士山.mp4",
            "status": "completed",
            "created_at": "2026-01-08T00:00:00.000Z",
            "description": {
              "title1": "富士山",
              "content1": "富士山の壮大な景色を収めたこの動画では、四季折々の自然美と静寂な空気感を臨場感たっぷりに感じることができます。朝日や夕焼け、雲海、雪景色が心を癒やし旅情を深めてくれます感動が広がる映像ですとても美しい 富士山の壮大な景色を収めたこの動画では、四季折々の自然美と静寂な空気感を臨場感たっぷりに感じることができます。朝日や夕焼け、雲海、雪景色が心を癒やし旅情を深めてくれます感動が広がる映像ですとても美しい富士山の壮大な景色を収めたこの動画では、四季折々の自然美と静寂な空気感を臨場感たっぷりに感じることができます。朝日や夕焼け、雲海、雪景色が心を癒やし旅情を深めてくれます感動が広がる映像ですとても美しい 富士山の壮大な景色を収めたこの動画では、四季折々の自然美と静寂な空気感を臨場感たっぷりに感じることができます。朝日や夕焼け、雲海、雪景色が心を癒やし旅情を深めてくれます感動が広がる映像ですとても美しい",
              "title2": "tiêu điểm 2",
              "content2": "người dùng đang mỉm cười với người xem",
              "title3": "tiêu điểm 3",
              "content3": "người dùng cúi đầu chào kết thúc video"
            }
          },
          "2": {
            "id": "2",
            "original_filename": "video 2",
            "status": "processing",
            "created_at": "2026-01-08T00:00:00.000Z",
            "description": {
              "title": "tiêu điểm 2",
              "content": "người dùng đang show sản phẩm"
            }
          }
        };
        
        if (mockVideoDetails[videoId]) {
          return mockVideoDetails[videoId];
        }
      }
      throw error;
    }
  }

  /**
   * Stream chat responses from backend SSE endpoint.
   * params: { videoId, messages, token, onMessage, onDone, onError }
   * Returns: { cancel: () => void }
   */
  streamChat({ videoId, messages = [], onMessage = () => {}, onDone = () => {}, onError = () => {} }) {
    const base = (this.client && this.client.defaults && this.client.defaults.baseURL) || import.meta.env.VITE_API_BASE_URL || "";
    const url = `${base.replace(/\/$/, "")}/api/v1/chat/stream?video_id=${encodeURIComponent(videoId)}`;

    const controller = new AbortController();
    const signal = controller.signal;

    (async () => {
      try {
        const headers = {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        };

        const token = TokenManager.getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ messages }),
          credentials: "same-origin",
          signal,
        });

        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`Stream request failed: ${resp.status} ${txt}`);
        }

        if (!resp.body) {
          throw new Error("Stream response has no body");
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = raw.split(/\r?\n/);
            for (const line of lines) {
              if (line === "") continue;
              if (line.startsWith("data:")) {
                let payload = line.slice(5);
                if (payload.charAt(0) === " ") payload = payload.slice(1);
                if ((payload.startsWith('"') && payload.endsWith('"')) || (payload.startsWith("'") && payload.endsWith("'"))) {
                  payload = payload.slice(1, -1).trim();
                }
                const isDone = payload === "[DONE]" || payload === "DONE";
                if (isDone) {
                  try { onDone(); } catch (e) {}
                } else if (payload.startsWith("[ERROR]")) {
                  try { onError(new Error(payload)); } catch (e) {}
                } else {
                  try { onMessage(payload); } catch (e) {}
                }
              }
            }
          }
        }

        if (buffer) {
          const lines = buffer.split(/\r?\n/);
          for (const line of lines) {
            if (line === "") continue;
            if (line.startsWith("data:")) {
              let payload = line.slice(5);
              if (payload.charAt(0) === " ") payload = payload.slice(1);
              if ((payload.startsWith('"') && payload.endsWith('"')) || (payload.startsWith("'") && payload.endsWith("'"))) {
                payload = payload.slice(1, -1);
              }
              const isDone = payload === "[DONE]" || payload === "DONE";
              if (isDone) onDone();
              else if (payload.startsWith("[ERROR]")) onError(new Error(payload));
              else onMessage(payload);
            }
          }
        }

        try { onDone(); } catch (e) {}
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }
        try { onError(err); } catch (e) {}
      }
    })();

    return { cancel: () => controller.abort() };
  }

  async getChatHistory(videoId) {
    try {
      const response = await this.get(`/api/v1/chat/history?video_id=${encodeURIComponent(videoId)}`);
      if (response?.data) return response.data;
      return response;
    } catch (err) {
      throw err;
    }
  }
}

export default new VideoService();

