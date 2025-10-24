import * as core from '@actions/core';
import { ActionInputs } from './types';
import { saveCache } from './save';
import { restoreCache } from './restore';

/**
 * Parse action inputs from GitHub Actions environment
 */
function getInputs(): ActionInputs {
  // Get action type
  const action = core.getInput('action', { required: true }).toLowerCase();
  if (action !== 'save' && action !== 'restore') {
    throw new Error(`Invalid action: ${action}. Must be 'save' or 'restore'`);
  }

  // Get cache key
  const key = core.getInput('key', { required: true });
  if (!key) {
    throw new Error('Cache key is required');
  }

  // Get restore keys (optional, for restore action)
  const restoreKeysInput = core.getInput('restore-keys', { required: false });
  const restoreKeys = restoreKeysInput
    ? restoreKeysInput
        .split('\n')
        .map(k => k.trim())
        .filter(k => k.length > 0)
    : [];

  // Get paths to cache
  const pathsInput = core.getInput('path', { required: true });
  if (!pathsInput) {
    throw new Error('Paths to cache are required');
  }

  // Parse paths (support both newline and comma-separated)
  const paths = pathsInput
    .split(/[\n,]/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (paths.length === 0) {
    throw new Error('At least one path must be specified');
  }

  // Get S3 configuration
  const s3Endpoint = core.getInput('s3-endpoint', { required: false }) ||
    'https://s3-dcl1.ethquokkaops.io';
  const s3AccessKeyId = core.getInput('cache-username', { required: true });
  const s3SecretAccessKey = core.getInput('cache-password', {
    required: true
  });
  const s3Bucket = core.getInput('s3-bucket', { required: false }) ||
    'github-actions-cache';
  const s3Region = core.getInput('s3-region', { required: false }) || 'us-east-1';

  // Mask sensitive values
  core.setSecret(s3AccessKeyId);
  core.setSecret(s3SecretAccessKey);

  return {
    action: action as 'save' | 'restore',
    key,
    restoreKeys,
    paths,
    s3Endpoint,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3Bucket,
    s3Region
  };
}

/**
 * Main entry point
 */
async function run(): Promise<void> {
  try {
    // Parse inputs
    const inputs = getInputs();

    // Log configuration (without sensitive data)
    core.info('S3 Cache Action');
    core.info(`Action: ${inputs.action}`);
    core.info(`S3 Endpoint: ${inputs.s3Endpoint}`);
    core.info(`S3 Bucket: ${inputs.s3Bucket}`);
    core.info(`S3 Region: ${inputs.s3Region}`);
    core.info(`Paths: ${inputs.paths.join(', ')}`);
    core.info('');

    // Route to appropriate action
    if (inputs.action === 'save') {
      await saveCache(inputs);
    } else if (inputs.action === 'restore') {
      await restoreCache(inputs);
    } else {
      throw new Error(`Invalid action: ${inputs.action}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);

    if (error instanceof Error && error.stack) {
      core.debug(error.stack);
    }
  }
}

// Run the action
run();
