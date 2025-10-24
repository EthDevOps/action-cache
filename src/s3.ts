import * as core from '@actions/core';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3ServiceException
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { CacheMetadata } from './types';

export class S3CacheClient {
  private client: S3Client;
  private bucket: string;

  constructor(
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    region: string
  ) {
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true // Required for Minio compatibility
    });
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(localPath: string, cacheKey: string): Promise<void> {
    core.info(`Uploading cache to S3: ${cacheKey}`);
    const fileStream = createReadStream(localPath);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: cacheKey,
      Body: fileStream
    });

    try {
      await this.client.send(command);
      core.info(`Successfully uploaded cache: ${cacheKey}`);
    } catch (error) {
      throw new Error(
        `Failed to upload cache to S3: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Download a file from S3
   */
  async downloadFile(cacheKey: string, localPath: string): Promise<void> {
    core.info(`Downloading cache from S3: ${cacheKey}`);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cacheKey
    });

    try {
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error('No body in S3 response');
      }

      const writeStream = createWriteStream(localPath);
      await pipeline(response.Body as NodeJS.ReadableStream, writeStream);
      core.info(`Successfully downloaded cache: ${cacheKey}`);
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.name === 'NoSuchKey'
      ) {
        throw new Error(`Cache not found: ${cacheKey}`);
      }
      throw new Error(
        `Failed to download cache from S3: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a cache exists in S3
   */
  async cacheExists(cacheKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: cacheKey
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NoSuchKey' || error.name === 'NotFound')
      ) {
        return false;
      }
      throw new Error(
        `Failed to check cache existence: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get cache metadata
   */
  async getCacheMetadata(cacheKey: string): Promise<CacheMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: cacheKey
      });
      const response = await this.client.send(command);
      return {
        key: cacheKey,
        size: response.ContentLength || 0,
        lastModified: response.LastModified
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NoSuchKey' || error.name === 'NotFound')
      ) {
        return null;
      }
      throw new Error(
        `Failed to get cache metadata: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Find the first existing cache from a list of keys
   */
  async findFirstExistingCache(
    cacheKeys: string[]
  ): Promise<{ key: string; isExactMatch: boolean } | null> {
    for (let i = 0; i < cacheKeys.length; i++) {
      const key = cacheKeys[i];
      const exists = await this.cacheExists(key);
      if (exists) {
        core.info(`Found cache: ${key}`);
        return {
          key,
          isExactMatch: i === 0 // First key is the exact match
        };
      }
    }
    return null;
  }
}
