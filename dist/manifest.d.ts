import { CacheManifest } from './types';
/**
 * Create a cache manifest from resolved file paths
 */
export declare function createManifest(cacheKey: string, paths: string[], workingDir?: string): CacheManifest;
/**
 * Save manifest to a file
 */
export declare function saveManifest(manifest: CacheManifest, directory: string): string;
/**
 * Load manifest from a file
 */
export declare function loadManifest(directory: string): CacheManifest;
/**
 * Restore files from extracted archive to their original locations
 */
export declare function restoreFromManifest(manifest: CacheManifest, extractedDir: string, targetDir?: string): Promise<void>;
/**
 * Validate manifest paths exist
 */
export declare function validateManifestPaths(manifest: CacheManifest, baseDir: string): {
    valid: number;
    missing: number;
};
