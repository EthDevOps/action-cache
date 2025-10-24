import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { ActionInputs } from './types';
import { S3CacheClient } from './s3';
import {
  extractTarArchive,
  buildCacheKey,
  generateRestoreKeys,
  getTempDir
} from './cache';
import { loadManifest, restoreFromManifest } from './manifest';

/**
 * Restore cache from S3
 */
export async function restoreCache(inputs: ActionInputs): Promise<void> {
  const startTime = Date.now();

  try {
    // Build the primary cache key
    const primaryKey = buildCacheKey(inputs.key);
    core.info(`Primary cache key: ${primaryKey}`);

    // Generate restore keys (including fallbacks)
    const restoreKeys = generateRestoreKeys(primaryKey, inputs.restoreKeys);
    core.info(`Checking ${restoreKeys.length} cache keys...`);
    restoreKeys.forEach((key, i) => {
      core.info(`  ${i + 1}. ${key}`);
    });

    // Initialize S3 client
    const s3Client = new S3CacheClient(
      inputs.s3Endpoint,
      inputs.s3AccessKeyId,
      inputs.s3SecretAccessKey,
      inputs.s3Bucket,
      inputs.s3Region
    );

    // Find the first existing cache
    const cacheResult = await s3Client.findFirstExistingCache(restoreKeys);

    if (!cacheResult) {
      core.info('No cache found');
      core.setOutput('cache-hit', 'false');
      return;
    }

    const { key: foundKey, isExactMatch } = cacheResult;
    core.info(`Cache found: ${foundKey}`);
    core.info(`Exact match: ${isExactMatch}`);
    core.setOutput('cache-hit', isExactMatch.toString());
    core.setOutput('cache-key', foundKey);

    // Get cache metadata
    const metadata = await s3Client.getCacheMetadata(foundKey);
    if (metadata) {
      const sizeMB = (metadata.size / 1024 / 1024).toFixed(2);
      core.info(`Cache size: ${sizeMB} MB`);
    }

    // Create temporary directory for cache operations
    const tempDir = getTempDir();
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Download cache from S3
      const archivePath = path.join(tempDir, path.basename(foundKey));
      await s3Client.downloadFile(foundKey, archivePath);

      // Create extraction directory
      const extractDir = path.join(tempDir, 'extract');
      fs.mkdirSync(extractDir, { recursive: true });

      // Extract tar archive
      await extractTarArchive(archivePath, extractDir);

      // Load manifest
      core.info('Loading cache manifest...');
      const manifest = loadManifest(extractDir);
      core.info(`Manifest contains ${manifest.paths.length} paths`);

      // Restore files to their original locations
      const workingDir = process.cwd();
      await restoreFromManifest(manifest, extractDir, workingDir);

      // Calculate and report statistics
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      core.info('');
      core.info('Cache restored successfully!');
      core.info(`  Key: ${foundKey}`);
      core.info(`  Duration: ${duration}s`);
      core.info(`  Paths restored: ${manifest.paths.length}`);
      core.info(`  Exact match: ${isExactMatch}`);
    } finally {
      // Clean up temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    // Don't fail the build if cache restore fails
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to restore cache: ${message}`);

    if (error instanceof Error && error.stack) {
      core.debug(error.stack);
    }

    core.setOutput('cache-hit', 'false');
  }
}
