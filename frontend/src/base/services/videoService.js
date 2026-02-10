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

  async getVideoById(videoId, config = {}) {
    try {
      const response = await this.get(`/api/v1/videos/${videoId}`, config);
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


  /**
   * Generate a download URL for a video from Azure Blob Storage
   * @param {string} videoId - The video ID
   * @param {Object} options
   * @param {number} [options.expiresInMinutes=60] - URL expiration time in minutes
   * @param {string} [options.email] - User email (required by backend). Will fallback to localStorage if not provided.
   * @returns {Promise<string>} - Download URL with SAS token
   */
  async getDownloadUrl(videoId, { expiresInMinutes = 60, email } = {}) {
    try {
      const payload = {
        video_id: videoId,
        expires_in_minutes: expiresInMinutes,
      };

      // Backend expects email; try to supply if available
      if (email) {
        payload.email = email;
      } else {
        try {
          const storedUser = localStorage.getItem("user");
          if (storedUser) {
            const parsed = JSON.parse(storedUser);
            if (parsed && parsed.email) {
              payload.email = parsed.email;
            }
          }
        } catch {
          // ignore storage access / parse errors
        }
      }

      const response = await this.post(`/api/v1/videos/generate-download-url`, payload);
      return response?.download_url || response?.data?.download_url || response;
    } catch (err) {
      console.error("Failed to get download URL:", err);
      throw err;
    }
  }
  /**
   * Stream video processing status updates via Server-Sent Events (SSE).
   *
   * @param {Object} params - Stream parameters
   * @param {string} params.videoId - Video ID to monitor
   * @param {Function} params.onStatusUpdate - Callback when status updates: (data) => void
   *   data shape: { video_id, status, progress, message, updated_at }
   * @param {Function} params.onDone - Callback when processing completes
   * @param {Function} params.onError - Callback on error: (error) => void
   * @returns {Object} - Control object with close() method to stop streaming
   *
   * @example
   * const stream = VideoService.streamVideoStatus({
   *   videoId: 'video-123',
   *   onStatusUpdate: (data) => {
   *     console.log(`Status: ${data.status}, Progress: ${data.progress}%`);
   *   },
   *   onDone: () => console.log('Processing complete'),
   *   onError: (err) => console.error('Stream error:', err),
   * });
   *
   * // Later: stream.close();
   */
  streamVideoStatus({ videoId, onStatusUpdate = () => {}, onDone = () => {}, onError = () => {} }) {
    const base = (this.client && this.client.defaults && this.client.defaults.baseURL) || import.meta.env.VITE_API_BASE_URL || "";
    const url = `${base.replace(/\/$/, "")}/api/v1/videos/${encodeURIComponent(videoId)}/status/stream`;

    const controller = new AbortController();
    const signal = controller.signal;

    // Retry configuration
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5 seconds
    const HEARTBEAT_TIMEOUT = 120000; // 2 minutes without heartbeat = connection lost
    let retryCount = 0;
    let lastHeartbeatTime = Date.now();
    let heartbeatTimeoutId = null;

    const connectWithRetry = async () => {
      try {
        console.log(`SSE: Connecting to video ${videoId} status stream${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);

        const headers = {
          Accept: "text/event-stream",
        };

        const token = TokenManager.getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const resp = await fetch(url, {
          method: "GET",
          headers,
          credentials: "same-origin",
          signal,
        });

        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`SSE request failed: ${resp.status} ${txt}`);
        }

        if (!resp.body) {
          throw new Error("SSE response has no body");
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        // Set up heartbeat timeout check
        const checkHeartbeat = () => {
          const timeSinceLastHeartbeat = Date.now() - lastHeartbeatTime;
          if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
            console.warn(`SSE: No heartbeat received for ${Math.round(timeSinceLastHeartbeat/1000)}s, connection may be stale`);
          }
          heartbeatTimeoutId = setTimeout(checkHeartbeat, 30000); // Check every 30 seconds
        };
        checkHeartbeat();

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
                let payload = line.slice(5).trim();

                // Handle [DONE] marker
                if (payload === "[DONE]" || payload === "DONE") {
                  console.log('SSE: Stream completed successfully');
                  clearTimeout(heartbeatTimeoutId);
                  onDone();
                  return;
                }

                // Parse JSON payload
                try {
                  const data = JSON.parse(payload);

                  // Update heartbeat timestamp for any message
                  lastHeartbeatTime = Date.now();

                  // Handle heartbeat messages
                  if (data.heartbeat) {
                    console.debug(`SSE: Heartbeat received (poll ${data.poll_count})`);
                    continue; // Don't pass heartbeat to onStatusUpdate
                  }

                  // Handle error from server
                  if (data.error) {
                    console.error('SSE: Server error:', data.error);
                    clearTimeout(heartbeatTimeoutId);
                    onError(new Error(data.error));
                    return;
                  }

                  // Send status update
                  onStatusUpdate(data);

                  // Auto-close on completion
                  if (data.status === 'DONE' || data.status === 'ERROR') {
                    console.log(`SSE: Processing ${data.status}, closing stream`);
                    clearTimeout(heartbeatTimeoutId);
                    onDone();
                    return;
                  }
                } catch (parseErr) {
                  console.error('SSE JSON parse error:', parseErr, 'payload:', payload);
                }
              }
            }
          }
        }

        // Handle remaining buffer
        if (buffer) {
          const lines = buffer.split(/\r?\n/);
          for (const line of lines) {
            if (line === "") continue;
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (payload === "[DONE]" || payload === "DONE") {
                console.log('SSE: Stream completed (from buffer)');
                clearTimeout(heartbeatTimeoutId);
                onDone();
              }
            }
          }
        }

        clearTimeout(heartbeatTimeoutId);
        onDone();
      } catch (err) {
        clearTimeout(heartbeatTimeoutId);

        if (err.name === 'AbortError') {
          console.log('SSE: Stream aborted by user');
          return;
        }

        console.error(`SSE: Connection failed: ${err.message}`);

        // Retry logic
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`SSE: Retrying connection in ${RETRY_DELAY}ms... (${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return connectWithRetry();
        } else {
          console.error(`SSE: Max retries (${MAX_RETRIES}) exceeded, giving up`);
          onError(err);
        }
      }
    };

    // Start the connection
    connectWithRetry();

    return {
      close: () => controller.abort(),
      cancel: () => controller.abort(), // Alias for compatibility
    };
  }
}

export default new VideoService();

