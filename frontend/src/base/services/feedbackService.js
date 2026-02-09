import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';

class FeedbackService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
  }

  /**
   * Submit feedback
   * @param {string} content - Feedback content
   * @returns {Promise<Object>} Feedback response
   */
  async submit(content) {
    try {
      const response = await this.post(URL_CONSTANTS.FEEDBACK_SUBMIT, {
        content: content.trim(),
      });
      return response;
    } catch (error) {
      console.error("Error submitting feedback:", error);
      throw error;
    }
  }
}

export default new FeedbackService();

