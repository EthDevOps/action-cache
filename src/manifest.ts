import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { CacheManifest, ManifestEntry } from './types';

const MANIFEST_VERSION = '1.0';
const MANIFEST_FILENAME = 'cache-manifest.json';

/**
 * Create a cache manifest from resolved file paths
 */
export function createManifest(
  cacheKey: string,
  paths: string[],
  workingDir: string = process.cwd()
): CacheManifest {
  const entries: ManifestEntry[] = paths.map(filePath => {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workingDir, filePath);
    const relativePath = path.relative(workingDir, absolutePath);

    let isDirectory = false;
    try {
      const stats = fs.statSync(absolutePath);
      isDirectory = stats.isDirectory();
    } catch (error) {
      core.warning(
        `Could not stat path: ${absolutePath} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      originalPath: relativePath,
      archivedPath: relativePath,
      isDirectory
    };
  });

  return {
    version: MANIFEST_VERSION,
    cacheKey: cacheKey.replace('.tar.lz4', ''),
    createdAt: new Date().toISOString(),
    paths: entries
  };
}

/**
 * Save manifest to a file
 */
export function saveManifest(manifest: CacheManifest, directory: string): string {
  const manifestPath = path.join(directory, MANIFEST_FILENAME);
  const json = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(manifestPath, json, 'utf8');
  core.debug(`Manifest saved to: ${manifestPath}`);
  return manifestPath;
}

/**
 * Load manifest from a file
 */
export function loadManifest(directory: string): CacheManifest {
  const manifestPath = path.join(directory, MANIFEST_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const json = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(json) as CacheManifest;

  // Validate manifest version
  if (manifest.version !== MANIFEST_VERSION) {
    core.warning(
      `Manifest version mismatch: expected ${MANIFEST_VERSION}, got ${manifest.version}`
    );
  }

  return manifest;
}

/**
 * Restore files from extracted archive to their original locations
 */
export async function restoreFromManifest(
  manifest: CacheManifest,
  extractedDir: string,
  targetDir: string = process.cwd()
): Promise<void> {
  core.info(`Restoring ${manifest.paths.length} paths from manifest`);

  for (const entry of manifest.paths) {
    const sourcePath = path.join(extractedDir, entry.archivedPath);
    const targetPath = path.join(targetDir, entry.originalPath);

    // Skip if source doesn't exist
    if (!fs.existsSync(sourcePath)) {
      core.warning(`Source path not found in archive: ${entry.archivedPath}`);
      continue;
    }

    // Create parent directory if it doesn't exist
    const targetParent = path.dirname(targetPath);
    if (!fs.existsSync(targetParent)) {
      fs.mkdirSync(targetParent, { recursive: true });
    }

    // Copy file or directory
    try {
      if (entry.isDirectory) {
        copyRecursive(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
      core.debug(`Restored: ${entry.originalPath}`);
    } catch (error) {
      core.warning(
        `Failed to restore ${entry.originalPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  core.info('Cache restoration complete');
}

/**
 * Recursively copy a directory
 */
function copyRecursive(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

/**
 * Validate manifest paths exist
 */
export function validateManifestPaths(
  manifest: CacheManifest,
  baseDir: string
): { valid: number; missing: number } {
  let valid = 0;
  let missing = 0;

  for (const entry of manifest.paths) {
    const fullPath = path.join(baseDir, entry.originalPath);
    if (fs.existsSync(fullPath)) {
      valid++;
    } else {
      missing++;
      core.debug(`Path not found: ${entry.originalPath}`);
    }
  }

  return { valid, missing };
}
