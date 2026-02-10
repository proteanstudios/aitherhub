import BaseApiService from '../api/BaseApiService';
import { URL_CONSTANTS } from '../api/endpoints/constant';
import { BlockBlobClient } from "@azure/storage-blob";
import TokenManager from '../utils/tokenManager';
import { openDB } from 'idb';

const DB_NAME = 'VideoUploadDB';
const STORE_NAME = 'uploads';
const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB blocks
const MAX_CONCURRENT_UPLOADS = 4;

class UploadService extends BaseApiService {
  constructor() {
    super(import.meta.env.VITE_API_BASE_URL);
    this.db = null;
  }

  /**
   * Initialize IndexedDB
   */
  async initDB() {
    if (this.db) return this.db;
    
    this.db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
        }
      },
    });
    
    return this.db;
  }

  /**
   * Save upload metadata to IndexedDB
   */
  async saveUploadMetadata(metadata) {
    const db = await this.initDB();
    await db.put(STORE_NAME, metadata);
  }

  /**
   * Get upload metadata from IndexedDB
   */
  async getUploadMetadata(uploadId) {
    const db = await this.initDB();
    return await db.get(STORE_NAME, uploadId);
  }

  /**
   * Mark block as uploaded
   */
  async markBlockUploaded(uploadId, blockId) {
    const metadata = await this.getUploadMetadata(uploadId);
    if (metadata) {
      if (!metadata.uploadedBlocks) {
        metadata.uploadedBlocks = [];
      }
      if (!metadata.uploadedBlocks.includes(blockId)) {
        metadata.uploadedBlocks.push(blockId);
      }
      await this.saveUploadMetadata(metadata);
    }
  }

  /**
   * Clear upload metadata
   */
  async clearUploadMetadata(uploadId) {
    const db = await this.initDB();
    await db.delete(STORE_NAME, uploadId);
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
   * Upload file directly to Azure Blob Storage with resume support
   * @param {File} file - File to upload
   * @param {string} uploadUrl - SAS URL from backend
   * @param {string} uploadId - Upload ID for resume tracking
   * @param {Function} onProgress - Callback for progress updates
   * @param {number} startFrom - Start uploading from this block index (for resume)
   * @returns {Promise<void>}
   */
  async uploadToAzure(file, uploadUrl, uploadId, onProgress, startFrom = 0) {
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

    // 1. Create block list and metadata
    const blocks = [];
    const blockIds = [];
    
    for (let i = 0; i < file.size; i += BLOCK_SIZE) {
      const blockIndex = Math.floor(i / BLOCK_SIZE);
      // Create simple numeric block ID and encode as base64
      const blockIdString = String(blockIndex).padStart(6, '0');
      const blockId = btoa(blockIdString); // Base64 encode
      blockIds.push(blockId);
      blocks.push({
        index: blockIndex,
        data: file.slice(i, Math.min(i + BLOCK_SIZE, file.size)),
        id: blockId,
        start: i,
        end: Math.min(i + BLOCK_SIZE, file.size),
      });
    }

    // 2. Save metadata to IndexedDB (merge with existing if resuming)
    const existingMetadata = await this.getUploadMetadata(uploadId) || {};
    await this.saveUploadMetadata({
      uploadId,
      uploadUrl,
      fileName: file.name,
      fileSize: file.size,
      blockIds,
      uploadedBlocks: existingMetadata.uploadedBlocks || [],
      contentType,
      timestamp: existingMetadata.timestamp || Date.now(),
      videoId: existingMetadata.videoId, // Preserve videoId if already set
    });

    // 3. Upload blocks (concurrent with bounded pool)
    const metadata = await this.getUploadMetadata(uploadId);
    const uploadedSet = new Set(metadata?.uploadedBlocks || []);

    // Ensure skipped blocks before startFrom are recorded for resume
    if (startFrom > 0) {
      let changed = false;
      for (const block of blocks) {
        if (block.index >= startFrom) break;
        if (!uploadedSet.has(block.id)) {
          uploadedSet.add(block.id);
          changed = true;
        }
      }
      if (changed) {
        await this.saveUploadMetadata({
          ...metadata,
          uploadedBlocks: Array.from(uploadedSet),
        });
      }
    }

    let completed = uploadedSet.size;
    const totalBlocks = blocks.length;

    const updateProgress = () => {
      const percentage = Math.round((completed / totalBlocks) * 100);
      if (onProgress) onProgress(percentage);
    };

    // Serialize metadata writes to avoid race conditions
    let writeQueue = Promise.resolve();
    const safeMarkUploaded = async (blockId) => {
      writeQueue = writeQueue.then(() => this.markBlockUploaded(uploadId, blockId));
      return writeQueue;
    };

    const pendingBlocks = blocks.filter(
      (block) => block.index >= startFrom && !uploadedSet.has(block.id)
    );

    if (pendingBlocks.length === 0) {
      updateProgress();
    } else {
      let nextIndex = 0;

      const uploadWorker = async () => {
        while (true) {
          const current = nextIndex++;
          if (current >= pendingBlocks.length) break;
          const block = pendingBlocks[current];

          try {
            const blockSize = block.end - block.start;
            await blockBlobClient.stageBlock(block.id, block.data, blockSize);

            await safeMarkUploaded(block.id);
            uploadedSet.add(block.id);
            completed += 1;
            updateProgress();
          } catch (error) {
            console.error(`Failed to upload block ${block.id}:`, error);
            throw error;
          }
        }
      };

      const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, pendingBlocks.length);
      await Promise.all(Array.from({ length: workerCount }, uploadWorker));
    }

    // 4. Commit all blocks
    try {
      await blockBlobClient.commitBlockList(blockIds, {
        blobHTTPHeaders: {
          blobContentType: contentType,
          blobCacheControl: 'public, max-age=3600',
        },
      });
      
      // Clear metadata after successful commit
      await this.clearUploadMetadata(uploadId);
    } catch (error) {
      console.error('Failed to commit blocks:', error);
      throw error;
    }
  }

  /**
   * Notify backend that upload is complete
   * @param {string} email - User email
   * @param {string} video_id - Video ID
   * @param {string} filename - File name
   * @param {string} upload_id - Upload ID
   * @returns {Promise<{video_id, status, message}>}
   */
  async uploadComplete(email, video_id, filename, upload_id) {
    // Verify token is valid before making authenticated request
    const token = TokenManager.getToken();
    if (!token) {
      throw new Error(window.__t('authTokenNotFound'));
    }

    if (TokenManager.isTokenExpired(token)) {
      throw new Error(window.__t('sessionExpired'));
    }

    return await this.post(URL_CONSTANTS.UPLOAD_COMPLETE, {
      email,
      video_id,
      filename,
      upload_id,
    });
  }

  /**
   * Check if user has resumable upload
   * @param {number} user_id
   * @returns {Promise<{upload_resume: boolean, upload_id?: string}>}
   */
  async checkUploadResume(user_id) {
    return await this.get(`${URL_CONSTANTS.UPLOAD_RESUME_CHECK}/${user_id}`);
  }

  /**
   * Clear all uploads for a user
   * @param {number} user_id
   * @returns {Promise<{status: string, message: string, deleted_count: number}>}
   */
  async clearUserUploads(user_id) {
    return await this.delete(`${URL_CONSTANTS.UPLOADS_CLEAR}/${user_id}`);
  }

  /**
   * Complete upload workflow: generate URL + upload to Azure + notify backend
   * @param {File} file - File to upload
   * @param {string} email - User email
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<string>} - video_id
   */
  async uploadFile(file, email, onProgress, onUploadInit) {
    const { video_id, upload_id, upload_url } = await this.generateUploadUrl(email, file.name);

    if (onUploadInit) {
      onUploadInit({ uploadId: upload_id, videoId: video_id });
    }

    // Save initial metadata with video_id for potential resume
    await this.saveUploadMetadata({
      uploadId: upload_id,
      uploadUrl: upload_url,
      videoId: video_id,
      fileName: file.name,
      fileSize: file.size,
      blockIds: [],
      uploadedBlocks: [],
      contentType: 'video/mp4',
      timestamp: Date.now(),
    });

    await this.uploadToAzure(file, upload_url, upload_id, onProgress);

    // Notify backend that upload is complete
    await this.uploadComplete(email, video_id, file.name, upload_id);

    return video_id;
  }
}

export default new UploadService();
