export interface ActionInputs {
  action: 'save' | 'restore';
  key: string;
  restoreKeys: string[];
  paths: string[];
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
  s3Region: string;
}

export interface CacheManifest {
  version: string;
  cacheKey: string;
  createdAt: string;
  paths: ManifestEntry[];
}

export interface ManifestEntry {
  originalPath: string;
  archivedPath: string;
  isDirectory: boolean;
}

export interface CacheMetadata {
  key: string;
  size: number;
  lastModified?: Date;
}
