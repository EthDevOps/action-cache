import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { ActionInputs } from './types';
import { S3CacheClient } from './s3';
import {
  resolveGlobPatterns,
  createTarArchive,
  buildCacheKey,
  getTempDir
} from './cache';
import { createManifest, saveManifest, validateManifestPaths } from './manifest';

/**
 * Save cache to S3
 */
export async function saveCache(inputs: ActionInputs): Promise<void> {
  const startTime = Date.now();

  try {
    // Build the cache key
    const cacheKey = buildCacheKey(inputs.key);
    core.info(`Cache key: ${cacheKey}`);
    core.setOutput('cache-key', cacheKey);

    // Resolve glob patterns to actual file paths
    core.info('Resolving paths to cache...');
    const resolvedPaths = await resolveGlobPatterns(inputs.paths);

    if (resolvedPaths.length === 0) {
      core.warning('No paths found to cache');
      return;
    }

    core.info(`Found ${resolvedPaths.length} paths to cache`);

    // Validate that paths exist
    const workingDir = process.cwd();
    const existingPaths = resolvedPaths.filter(p => {
      const fullPath = path.isAbsolute(p) ? p : path.join(workingDir, p);
      return fs.existsSync(fullPath);
    });

    if (existingPaths.length === 0) {
      core.warning('No existing paths found to cache');
      return;
    }

    if (existingPaths.length < resolvedPaths.length) {
      core.warning(
        `${resolvedPaths.length - existingPaths.length} paths not found and will be skipped`
      );
    }

    // Create manifest
    core.info('Creating cache manifest...');
    const manifest = createManifest(cacheKey, existingPaths, workingDir);

    // Create temporary directory for cache operations
    const tempDir = getTempDir();
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Save manifest to working directory temporarily
      const manifestPath = saveManifest(manifest, workingDir);
      const manifestRelativePath = path.relative(workingDir, manifestPath);

      // Convert all paths to relative paths (glob returns absolute paths)
      const relativePaths = existingPaths.map(p =>
        path.isAbsolute(p) ? path.relative(workingDir, p) : p
      );

      // Add manifest to the list of files to archive
      const allPaths = [...relativePaths, manifestRelativePath];

      // Create tar archive
      const archivePath = path.join(tempDir, path.basename(cacheKey));

      let compressionFormat: 'lz4' | 'gzip';
      try {
        compressionFormat = await createTarArchive(allPaths, archivePath, workingDir);
      } finally {
        // Clean up manifest from working directory
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
      }

      // Initialize S3 client
      const s3Client = new S3CacheClient(
        inputs.s3Endpoint,
        inputs.s3AccessKeyId,
        inputs.s3SecretAccessKey,
        inputs.s3Bucket,
        inputs.s3Region
      );

      // Check if cache already exists
      const cacheExists = await s3Client.cacheExists(cacheKey);
      if (cacheExists) {
        core.info('Cache already exists, overwriting...');
      }

      // Upload to S3
      await s3Client.uploadFile(archivePath, cacheKey);

      // Calculate and report statistics
      const stats = fs.statSync(archivePath);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      core.info('');
      core.info('Cache saved successfully!');
      core.info(`  Size: ${sizeMB} MB`);
      core.info(`  Compression: ${compressionFormat}`);
      core.info(`  Duration: ${duration}s`);
      core.info(`  Paths cached: ${existingPaths.length}`);
    } finally {
      // Clean up temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    // Don't fail the build if cache save fails
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to save cache: ${message}`);

    if (error instanceof Error && error.stack) {
      core.debug(error.stack);
    }
  }
}
