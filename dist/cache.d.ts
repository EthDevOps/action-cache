/**
 * Resolve glob patterns to actual file paths
 */
export declare function resolveGlobPatterns(patterns: string[]): Promise<string[]>;
/**
 * Generate a unique temporary directory path
 */
export declare function getTempDir(): string;
/**
 * Create a tar archive from paths
 * Uses lz4 compression via tar's --use-compress-program option
 */
export declare function createTarArchive(paths: string[], outputPath: string, workingDir?: string): Promise<void>;
/**
 * Extract a tar archive
 */
export declare function extractTarArchive(archivePath: string, targetDir: string): Promise<void>;
/**
 * Build cache key from template and environment variables
 */
export declare function buildCacheKey(keyTemplate: string): string;
/**
 * Generate restore keys from a primary key
 * Creates fallback keys by progressively removing path components
 */
export declare function generateRestoreKeys(primaryKey: string, additionalKeys: string[]): string[];
