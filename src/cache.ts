import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import { CacheManifest, ManifestEntry } from './types';

/**
 * Resolve glob patterns to actual file paths
 */
export async function resolveGlobPatterns(patterns: string[]): Promise<string[]> {
  const allPaths: string[] = [];

  for (const pattern of patterns) {
    const globber = await glob.create(pattern, {
      followSymbolicLinks: false
    });
    const paths = await globber.glob();
    allPaths.push(...paths);
  }

  // Remove duplicates and sort
  return [...new Set(allPaths)].sort();
}

/**
 * Generate a unique temporary directory path
 */
export function getTempDir(): string {
  const tempDir = process.env.RUNNER_TEMP || '/tmp';
  const uniqueId = `cache-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return path.join(tempDir, uniqueId);
}

/**
 * Create a tar archive from paths
 * Uses lz4 compression via tar's --use-compress-program option
 * Returns the compression format used
 */
export async function createTarArchive(
  paths: string[],
  outputPath: string,
  workingDir: string = process.cwd()
): Promise<'lz4' | 'gzip'> {
  core.info(`Creating tar archive: ${outputPath}`);
  core.info(`Archiving ${paths.length} paths`);

  // Create a file list for tar to read from
  const fileListPath = `${outputPath}.filelist`;
  fs.writeFileSync(fileListPath, paths.join('\n'));

  try {
    // Use lz4 if available, otherwise fall back to gzip
    let compressionCmd = 'lz4 -c';
    let compressionFormat: 'lz4' | 'gzip' = 'lz4';
    try {
      await exec.exec('which', ['lz4'], { silent: true });
      core.info('Using lz4 compression');
    } catch {
      core.info('lz4 not found, using gzip compression');
      compressionCmd = 'gzip';
      compressionFormat = 'gzip';
    }

    // Create tar archive with compression
    // Note: Options like --no-recursion must come before positional arguments
    const exitCode = await exec.exec(
      'tar',
      [
        '--no-recursion',
        '-C',
        workingDir,
        `--use-compress-program=${compressionCmd}`,
        '-cf',
        outputPath,
        '--files-from',
        fileListPath
      ],
      {
        silent: false
      }
    );

    if (exitCode !== 0) {
      throw new Error(`tar command failed with exit code ${exitCode}`);
    }

    const stats = fs.statSync(outputPath);
    core.info(`Archive created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    core.info(`Compression format: ${compressionFormat}`);

    return compressionFormat;
  } finally {
    // Clean up file list
    if (fs.existsSync(fileListPath)) {
      fs.unlinkSync(fileListPath);
    }
  }
}

/**
 * Detect compression format from file magic bytes
 */
function detectCompressionFormat(filePath: string): 'lz4' | 'gzip' {
  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  // Check for LZ4 magic bytes: 0x04 0x22 0x4D 0x18
  if (
    buffer[0] === 0x04 &&
    buffer[1] === 0x22 &&
    buffer[2] === 0x4d &&
    buffer[3] === 0x18
  ) {
    return 'lz4';
  }

  // Check for gzip magic bytes: 0x1F 0x8B
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return 'gzip';
  }

  // Default to gzip if unknown
  core.warning('Unknown compression format, defaulting to gzip');
  return 'gzip';
}

/**
 * Extract a tar archive
 */
export async function extractTarArchive(
  archivePath: string,
  targetDir: string
): Promise<void> {
  core.info(`Extracting tar archive: ${archivePath}`);

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Detect compression type from file magic bytes
  const compressionFormat = detectCompressionFormat(archivePath);
  core.info(`Detected compression format: ${compressionFormat}`);

  let compressionCmd: string;
  if (compressionFormat === 'lz4') {
    // Verify lz4 is available
    try {
      await exec.exec('which', ['lz4'], { silent: true });
      compressionCmd = 'lz4 -d';
    } catch {
      throw new Error(
        'Archive is LZ4 compressed but lz4 command not found. Please install lz4.'
      );
    }
  } else {
    compressionCmd = 'gzip -d';
  }

  const exitCode = await exec.exec(
    'tar',
    [
      '-C',
      targetDir,
      `--use-compress-program=${compressionCmd}`,
      '-xf',
      archivePath
    ],
    {
      silent: false
    }
  );

  if (exitCode !== 0) {
    throw new Error(`tar extraction failed with exit code ${exitCode}`);
  }

  core.info('Archive extracted successfully');
}

/**
 * Build cache key from template and environment variables
 */
export function buildCacheKey(keyTemplate: string): string {
  // Get GitHub context from environment
  const org = (process.env.GITHUB_REPOSITORY || '').split('/')[0];
  const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1];
  const branch = (process.env.GITHUB_REF || '').replace('refs/heads/', '');
  const workflow = process.env.GITHUB_WORKFLOW || '';

  // Replace placeholders in the key template
  let key = keyTemplate
    .replace(/\$\{\{\s*github\.repository_owner\s*\}\}/g, org)
    .replace(/\$\{\{\s*github\.repository\s*\}\}/g, repo)
    .replace(/\$\{\{\s*github\.ref_name\s*\}\}/g, branch)
    .replace(/\$\{\{\s*github\.workflow\s*\}\}/g, workflow);

  // Build the full cache key: <org>/<repo>/<branch>/<workflow>/<user-key>
  const cacheKey = `${org}/${repo}/${branch}/${workflow}/${key}`;

  // Add .tar.lz4 extension (used for both lz4 and gzip - actual format is detected from magic bytes on restore)
  return `${cacheKey}.tar.lz4`;
}

/**
 * Generate restore keys from a primary key
 * Creates fallback keys by progressively removing path components
 */
export function generateRestoreKeys(
  primaryKey: string,
  additionalKeys: string[]
): string[] {
  const keys = [primaryKey];

  // Add user-provided restore keys
  for (const key of additionalKeys) {
    if (key && key !== primaryKey) {
      keys.push(buildCacheKey(key));
    }
  }

  // Generate hierarchical fallback keys
  // For example: org/repo/feature/workflow/key -> org/repo/main/workflow/key
  const parts = primaryKey.replace('.tar.lz4', '').split('/');
  if (parts.length >= 4) {
    // Try with main branch
    const mainKey = [...parts];
    mainKey[2] = 'main'; // Replace branch with 'main'
    keys.push(mainKey.join('/') + '.tar.lz4');
  }

  return keys;
}
