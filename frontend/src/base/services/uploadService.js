import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';
import { BlockBlobClient } from "@azure/storage-blob";

class UploadService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
  }

  /**
   * Generate SAS upload URL from backend
   * @param {string} filename - File name to upload
   * @returns {Promise<{video_id, upload_url, blob_url, expires_at}>}
   */
  async generateUploadUrl(filename) {
    return await this.post(URL_CONSTANTS.GENERATE_UPLOAD_URL, {
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
    
    await blockBlobClient.uploadBrowserData(file, {
      blockSize: 50 * 1024 * 1024, // 50MB chunks
      concurrency: 4,
      onProgress: (progress) => {
        const percentage = Math.round((progress.loadedBytes / file.size) * 100);
        if (onProgress) onProgress(percentage);
      },
    });
  }

  /**
   * Complete upload workflow: generate URL + upload to Azure
   * @param {File} file - File to upload
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<string>} - video_id
   */
  async uploadFile(file, onProgress) {
    const { video_id, upload_url } = await this.generateUploadUrl(file.name);

    await this.uploadToAzure(file, upload_url, onProgress);

    return video_id;
  }
}

export default new UploadService();
