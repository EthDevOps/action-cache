import { CacheMetadata } from './types';
export declare class S3CacheClient {
    private client;
    private bucket;
    constructor(endpoint: string, accessKeyId: string, secretAccessKey: string, bucket: string, region: string);
    /**
     * Upload a file to S3
     */
    uploadFile(localPath: string, cacheKey: string): Promise<void>;
    /**
     * Download a file from S3
     */
    downloadFile(cacheKey: string, localPath: string): Promise<void>;
    /**
     * Check if a cache exists in S3
     */
    cacheExists(cacheKey: string): Promise<boolean>;
    /**
     * Get cache metadata
     */
    getCacheMetadata(cacheKey: string): Promise<CacheMetadata | null>;
    /**
     * Find the first existing cache from a list of keys
     */
    findFirstExistingCache(cacheKeys: string[]): Promise<{
        key: string;
        isExactMatch: boolean;
    } | null>;
}
