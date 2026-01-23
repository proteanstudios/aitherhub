import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';
import { BlockBlobClient } from "@azure/storage-blob";
import TokenManager from '../utils/tokenManager';

class UploadService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
  }

  /**
   * Generate SAS upload URL from backend
   * @param {string} email - User email
   * @param {string} filename - File name to upload
   * @returns {Promise<{video_id, upload_url, blob_url, expires_at}>}
   */
  async generateUploadUrl(email, filename) {
    return await this.post(URL_CONSTANTS.GENERATE_UPLOAD_URL, {
      email,
      filename,
    });
  }

  /**
   * Upload file directly to Azure Blob Storage
   * @param {File} file - File to upload
   * @param {string} uploadUrl - SAS URL from backend
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<void>}
   */
  async uploadToAzure(file, uploadUrl, onProgress) {
    const blockBlobClient = new BlockBlobClient(uploadUrl);

    // Determine proper content type for video files
    let contentType = 'video/mp4'; // Default fallback

    // Use file.type if available and valid
    if (file.type && file.type.startsWith('video/')) {
      contentType = file.type;
    } else {
      // Fallback detection based on file extension
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.mp4')) {
        contentType = 'video/mp4';
      } else if (fileName.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (fileName.endsWith('.avi')) {
        contentType = 'video/avi';
      } else if (fileName.endsWith('.mov')) {
        contentType = 'video/quicktime';
      } else if (fileName.endsWith('.mkv')) {
        contentType = 'video/x-matroska';
      }
    }

    await blockBlobClient.uploadData(file, {
      blockSize: 8 * 1024 * 1024, // 8MB chunks
      concurrency: 8,
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: 'public, max-age=3600', // Allow CDN caching
      },
      onProgress: (progress) => {
        const percentage = Math.round((progress.loadedBytes / file.size) * 100);
        if (onProgress) onProgress(percentage);
      },
    });
  }

  /**
   * Notify backend that upload is complete
   * @param {string} email - User email
   * @param {string} video_id - Video ID
   * @param {string} filename - File name
   * @returns {Promise<{video_id, status, message}>}
   */
  async uploadComplete(email, video_id, filename) {
    // Verify token is valid before making authenticated request
    const token = TokenManager.getToken();
    if (!token) {
      throw new Error('Authentication token not found. Please log in again.');
    }
    
    if (TokenManager.isTokenExpired(token)) {
      throw new Error('Your session has expired. Please log in again.');
    }

    return await this.post(URL_CONSTANTS.UPLOAD_COMPLETE, {
      email,
      video_id,
      filename,
    });
  }

  /**
   * Complete upload workflow: generate URL + upload to Azure + notify backend
   * @param {File} file - File to upload
   * @param {string} email - User email
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<string>} - video_id
   */
  async uploadFile(file, email, onProgress) {
    const { video_id, upload_url } = await this.generateUploadUrl(email, file.name);

    await this.uploadToAzure(file, upload_url, onProgress);

    // Notify backend that upload is complete
    await this.uploadComplete(email, video_id, file.name);

    return video_id;
  }
}

export default new UploadService();
