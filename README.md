# S3 Cache Action

A GitHub Action for caching dependencies and build outputs to S3-compatible storage (AWS S3, MinIO, etc.).

## ⚠️ Important: For Ethereum Foundation Users

**If you are part of the Ethereum Foundation**, please contact the **EthDevOps team** to obtain cache credentials before using this action.

- 📧 Contact: `~devops` channel in Mattermost or create a ticket in `ethereum/devops`
- 🔑 Required credentials: `CACHE_USERNAME` and `CACHE_PASSWORD`

Do not attempt to configure your own S3 storage unless you have specific requirements outside of the EF infrastructure.

---

## Features

- 🚀 Fast caching to S3/MinIO
- 🔄 Fallback restore keys for branch-based cache inheritance
- 📦 LZ4 compression for optimal speed (falls back to gzip if lz4 is unavailable)
- 🔐 Secure credential handling via GitHub Secrets
- 🎯 Configurable S3 endpoint (defaults to internal endpoint)
- 📝 Manifest-based restoration for accurate path mapping

## Usage

### Save Cache

```yaml
- name: Save cache
  uses: EthDevOps/action-cache@v1
  with:
    action: save
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    path: |
      node_modules
      .next/cache
    cache-username: ${{ secrets.CACHE_USERNAME }}
    cache-password: ${{ secrets.CACHE_PASSWORD }}
```

### Restore Cache

```yaml
- name: Restore cache
  uses: EthDevOps/action-cache@v1
  with:
    action: restore
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
      ${{ runner.os }}-
    path: |
      node_modules
      .next/cache
    cache-username: ${{ secrets.CACHE_USERNAME }}
    cache-password: ${{ secrets.CACHE_PASSWORD }}
```

### Complete Workflow Example

```yaml
name: CI with S3 Cache

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Restore cache
        id: cache
        uses: EthDevOps/action-cache@v1
        with:
          action: restore
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-node-
          path: node_modules
          cache-username: ${{ secrets.CACHE_USERNAME }}
          cache-password: ${{ secrets.CACHE_PASSWORD }}

      - name: Install dependencies
        if: steps.cache.outputs.cache-hit != 'true'
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Save cache
        if: always()
        uses: EthDevOps/action-cache@v1
        with:
          action: save
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          path: node_modules
          cache-username: ${{ secrets.CACHE_USERNAME }}
          cache-password: ${{ secrets.CACHE_PASSWORD }}
```

## Inputs

### Required

| Input | Description |
|-------|-------------|
| `action` | Action to perform: `save` or `restore` |
| `key` | Cache key to use for saving/restoring |
| `path` | Paths to cache (newline or comma-separated) |
| `cache-username` | Cache storage username (S3 access key ID) |
| `cache-password` | Cache storage password (S3 secret access key) |

### Optional

| Input | Description | Default |
|-------|-------------|---------|
| `restore-keys` | Fallback cache keys (newline-separated, for restore only) | - |
| `s3-endpoint` | S3 endpoint URL | `https://s3-dcl1.ethquokkaops.io` |
| `s3-bucket` | S3 bucket name | `github-actions-cache` |
| `s3-region` | S3 region | `us-east-1` |

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Boolean indicating if an exact cache match was found (restore only) |
| `cache-key` | The cache key that was used |

## Cache Key Structure

**Important:** The `key` input you provide is only the **custom suffix** part. The action automatically expands it with your repository context.

### Automatic Expansion

Your key gets automatically expanded to:
```
<org>/<repo>/<branch>/<workflow>/<your-key>.tar.lz4
```

### Example

If you provide:
```yaml
key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
# Evaluates to: "Linux-node-abc123def456"
```

In the `myorg/myrepo` repository, on the `feature-auth` branch, in the `CI` workflow, the final cache key becomes:
```
myorg/myrepo/feature-auth/CI/Linux-node-abc123def456.tar.lz4
```

This automatic namespacing prevents cache collisions between:
- Different organizations
- Different repositories
- Different branches
- Different workflows

## Fallback Keys

When restoring, the action tries keys in this order:

1. **Exact match** - Your specified key (expanded with current branch)
2. **User-provided restore keys** - From the `restore-keys` input (each expanded)
3. **Automatic fallback to main** - Same key but with `main` branch substituted

### Example

Given this workflow configuration on the `feature-auth` branch:
```yaml
key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
restore-keys: |
  ${{ runner.os }}-node-
```

The action will try these cache keys in order:
```
1. myorg/myrepo/feature-auth/CI/Linux-node-abc123def456.tar.lz4  # Exact match
2. myorg/myrepo/feature-auth/CI/Linux-node-.tar.lz4              # Restore key
3. myorg/myrepo/main/CI/Linux-node-abc123def456.tar.lz4          # Main branch fallback
```

This allows feature branches to fall back to caches from the main branch when no exact match exists.

## Compression

The action uses LZ4 compression by default for optimal speed. If LZ4 is not available in the runner, it falls back to gzip compression.

## Security

- S3 credentials are passed via GitHub Secrets and masked in logs
- Credentials are scoped to specific S3 buckets
- The action supports custom S3 endpoints for private infrastructure

## Setup

### 1. Create S3 Bucket

Create an S3 bucket for storing caches. Configure it with:
- Private access (not public)
- Lifecycle policies for automatic cleanup (optional)

### 2. Configure Secrets

Add these secrets to your GitHub repository:
- `CACHE_USERNAME`: Your S3 access key ID
- `CACHE_PASSWORD`: Your S3 secret access key

### 3. Use in Workflows

Add the action to your workflow as shown in the examples above.

## Troubleshooting

### Cache not found
- Ensure the cache key matches exactly or use restore-keys for fallbacks
- Check S3 bucket permissions

### Upload/Download failures
- Verify S3 credentials are correct
- Check S3 endpoint is accessible from GitHub runners
- Ensure bucket exists and has proper permissions

### Compression errors
- If LZ4 is not available, the action will fall back to gzip
- Install LZ4 in your runner if you need optimal compression speed

## Development

### Building the Action

This action is written in TypeScript and must be compiled before use:

```bash
# Install dependencies
npm install

# Build the action
npm run build
```

### Important: Committing Changes

**The `dist/` directory must be committed to the repository!** GitHub Actions cannot run TypeScript directly - they need the compiled JavaScript.

After making changes:
1. Make your code changes in `src/`
2. Run `npm run build` to compile
3. **Commit both `src/` and `dist/` changes**
4. Push to GitHub

The `dist/` directory contains the bundled action code (~2.2MB) that GitHub Actions will execute.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

When contributing:
1. Make changes in the `src/` directory
2. Run `npm run build` to compile
3. Commit both source and compiled code
4. Submit a pull request
