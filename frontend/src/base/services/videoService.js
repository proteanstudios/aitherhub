import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';

class VideoService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
  }

  async getVideosByUser(userId) {
    try {
      // TODO: Replace with actual API endpoint when backend is ready
      // Expected endpoint: GET /api/v1/videos/user/{userId} or GET /api/v1/videos?user_id={userId}
      const response = await this.get(`/api/v1/videos/user/${userId}`);
      // Handle different response formats
      if (Array.isArray(response)) {
        return response;
      } else if (response?.data && Array.isArray(response.data)) {
        return response.data;
      } else if (response?.videos && Array.isArray(response.videos)) {
        return response.videos;
      }
      return [];
    } catch (error) {
      console.error("Error fetching videos:", error);
      // Return mock data for development when API is not ready
      // Remove this fallback when backend endpoint is implemented
      if (error.response?.status === 404 || error.response?.status === 501) {
        console.warn("Video API endpoint not implemented yet, using mock data");
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
      // Handle different response formats
      if (response?.data) {
        return response.data;
      }
      return response;
    } catch (error) {
      console.error("Error fetching video:", error);
      // Return mock data for development when API is not ready
      // Remove this fallback when backend endpoint is implemented
      if (error.response?.status === 404 || error.response?.status === 501) {
        console.warn("Video detail API endpoint not implemented yet, using mock data");
        // Mock data chi tiết với description đầy đủ
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
}

export default new VideoService();

