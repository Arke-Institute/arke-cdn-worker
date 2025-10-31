# arke-cdn-worker

## Purpose

Provides stable, permanent URLs for archival assets via `cdn.arke.institute/asset/{assetId}`. Acts as an indirection layer between manifests and storage backends, enabling storage mobility without breaking links.

## Architecture

**Deployment**: Cloudflare Worker at `cdn.arke.institute`

**Runtime**: V8 isolate, handles streaming from R2/S3 to client

**Bindings**:
- KV namespace (`ASSET_MAP`) - asset ID → storage location mapping
- R2 bucket (`ARKE_ARCHIVE`) - direct access to arke-archive bucket
- Optional: S3 credentials (future)

## Responsibilities

- **Health Check**
  - `GET /` - Returns service status and version

- **Asset Retrieval**
  - `GET /asset/:assetId` - Retrieve asset by ID
  - `GET /asset/:assetId/*` - Retrieve asset with optional trailing path (vanity filename)
  - Look up `assetId` in KV
  - KV entry contains: storage type (url or r2), location (URL or R2 key), content-type, size
  - **URL mode**: Fetch object from external storage URL (IPFS, R2 public URL, S3, etc.)
  - **R2 mode**: Fetch directly from arke-archive R2 bucket using R2 key
  - Stream to client with correct headers

- **Asset Registration**
  - `POST /asset/:assetId` - Register an asset that's already stored somewhere
  - Request body: `{ url?, r2_key?, content_type?, size_bytes? }`
  - Must specify exactly one of: `url` (for external storage) or `r2_key` (for R2 bucket)
  - Stores metadata in KV with storage type
  - Returns CDN URL and source information

- **HTTP Headers**
  - `Content-Type` from metadata or storage response
  - `Cache-Control: public, max-age=31536000, immutable` (assets never change)
  - `X-Asset-Id` header for tracking
  - `Content-Length` when size is known

- **Storage Abstraction**
  - **Two modes supported**:
    - **URL mode**: Fetch from any HTTP-accessible storage (IPFS, R2 public URLs, S3 signed URLs, etc.)
    - **R2 mode**: Direct access to arke-archive R2 bucket (more efficient, no public URLs needed)
  - Manifests only store `https://cdn.arke.institute/asset/{assetId}`
  - Backend changes don't break links

- **Access Control (Future)**
  - Check embargo dates
  - Verify permissions for private collections
  - Token-based access for restricted materials

## Interfaces

**Called By**:
- Public internet (users viewing archival materials)
- IIIF viewers (if we expose assets as IIIF)
- Manifests (asset URLs embedded in component lists)

**Calls**:
- KV API (lookup asset metadata)
- R2 API (fetch object bytes)
- S3 API (future)

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Framework**: Hono or raw Workers API
- **Storage**: Cloudflare R2 (primary), S3 (future)
- **Caching**: CF edge cache + browser cache

## Data Contract

### KV Entry Format
```typescript
// Key: assetId (ULID)
// Value: JSON string
{
  storage_type: "url" | "r2",  // Which storage mode to use
  url?: string,                 // For URL mode: the actual URL where the asset is stored (IPFS, R2, S3, etc.)
  r2_key?: string,              // For R2 mode: the key in the arke-archive bucket
  content_type?: string,        // e.g., "image/tiff"
  size_bytes?: number,
  created_at?: string,          // ISO 8601
  // Future fields:
  access_level?: "public" | "restricted" | "private",
  embargo_until?: string        // ISO 8601
}
```

### Asset URL Format
```
https://cdn.arke.institute/asset/{assetId}
https://cdn.arke.institute/asset/{assetId}/download  (force download)
https://cdn.arke.institute/asset/{assetId}/{filename} (vanity filename)
```

### Response Headers
```http
HTTP/1.1 200 OK
Content-Type: image/tiff
Content-Length: 12345678
Cache-Control: public, max-age=31536000, immutable
X-Asset-Id: 01K8ABCDEF...
```

## Implementation Status

### ✅ Completed
- Basic Hono framework setup
- Health check endpoint (`GET /`)
- Asset retrieval endpoints (`GET /asset/:assetId` and `GET /asset/:assetId/*`)
- Asset registration endpoint (`POST /asset/:assetId`)
- KV-based metadata storage
- **Dual storage mode support**:
  - URL-based storage (supports any HTTP-accessible storage: IPFS, public R2 URLs, S3, etc.)
  - Direct R2 bucket access (arke-archive bucket via ARKE_ARCHIVE binding)
- CORS middleware
- Error handling (404, 503, 500)
- Proper caching headers
- Input validation (ensures exactly one storage method)
- Cloudflare deployment at `cdn.arke.institute`
- KV namespace and R2 bucket bindings configured

### 📋 Planned Features
- Access control and embargo support
- Asset deletion/update endpoints
- Cache purge API
- Rate limiting
- IIIF Image API support
- Advanced error handling and retry logic
- Monitoring and analytics

## API Endpoints

### `GET /`
Health check endpoint.

**Response:**
```json
{
  "service": "arke-cdn-worker",
  "status": "healthy",
  "version": "1.0.0"
}
```

### `GET /asset/:assetId`
Retrieve an asset by its ID.

**Parameters:**
- `assetId` - The unique asset identifier

**Response:**
- `200 OK` - Asset content with appropriate Content-Type
- `404 Not Found` - Asset not found in KV
- `503 Service Unavailable` - Failed to fetch from storage backend
- `500 Internal Server Error` - Other errors

**Headers:**
- `Content-Type` - From metadata or storage response
- `Cache-Control: public, max-age=31536000, immutable`
- `X-Asset-Id` - The asset ID
- `Content-Length` - Size in bytes (if known)

### `GET /asset/:assetId/*`
Retrieve an asset with optional trailing path (e.g., vanity filename).

Same behavior as `GET /asset/:assetId`, but allows URLs like `/asset/abc123/photo.jpg`.

### `POST /asset/:assetId`
Register an asset that's already stored somewhere (external URL or R2 bucket).

**Parameters:**
- `assetId` - The unique asset identifier to register

**Request Body (URL mode):**
```json
{
  "url": "https://gateway.pinata.cloud/ipfs/QmXxx...",
  "content_type": "image/jpeg",
  "size_bytes": 1234567
}
```

**Request Body (R2 mode):**
```json
{
  "r2_key": "archive/2025/document.pdf",
  "content_type": "application/pdf",
  "size_bytes": 2345678
}
```

**Response:**
```json
{
  "success": true,
  "assetId": "01K8ABCDEF...",
  "cdnUrl": "https://cdn.arke.institute/asset/01K8ABCDEF...",
  "storage_type": "r2",
  "r2_key": "archive/2025/document.pdf"
}
```

**Status Codes:**
- `201 Created` - Asset registered successfully
- `400 Bad Request` - Missing both `url` and `r2_key`, or both provided
- `500 Internal Server Error` - Registration failed

**Validation:**
- Must specify exactly one of: `url` or `r2_key`
- Cannot specify both
- Cannot omit both

## Configuration (wrangler.jsonc)

```jsonc
{
  "name": "arke-cdn-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",

  "kv_namespaces": [
    {
      "binding": "ASSET_MAP",
      "id": "73d7b2b3c6ca4f02ac0b1e1997f7fa9d"
    }
  ],

  "r2_buckets": [
    {
      "binding": "ARKE_ARCHIVE",
      "bucket_name": "arke-archive"
    }
  ],

  "routes": [
    {
      "pattern": "cdn.arke.institute",
      "custom_domain": true
    }
  ],

  "vars": {
    "ALLOWED_ORIGINS": "*"
  }
}
```

## Usage Examples

### Register an asset from external URL
```bash
curl -X POST https://cdn.arke.institute/asset/my-document \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://gateway.pinata.cloud/ipfs/QmXxx...",
    "content_type": "application/pdf",
    "size_bytes": 1234567
  }'
```

### Register an asset from R2 bucket
```bash
curl -X POST https://cdn.arke.institute/asset/my-document \
  -H "Content-Type: application/json" \
  -d '{
    "r2_key": "archive/2025/document.pdf",
    "content_type": "application/pdf",
    "size_bytes": 2345678
  }'
```

### Retrieve an asset
```bash
curl https://cdn.arke.institute/asset/my-document
# or with vanity filename
curl https://cdn.arke.institute/asset/my-document/document.pdf
```

## Key Design Decisions

- **Dual storage modes**: Support both external URLs and direct R2 access for flexibility
- **KV for lookups**: Fast edge lookups, globally replicated
- **Streaming**: No memory limits, handle multi-GB assets
- **Immutable URLs**: Assets never change, aggressive caching
- **Backend abstraction**: Easy to migrate storage later
- **No transformations**: Serve original bytes (use IIIF for tiles/transforms)

## Performance Characteristics

- **Lookup latency**: < 50ms (KV is edge-replicated)
- **First byte**: < 100ms (R2 is fast)
- **Streaming**: Full throughput (no Worker bottleneck)
- **Cache hit rate**: ~90%+ for popular assets (CF edge cache)
- **Bandwidth**: Unlimited (CF doesn't charge egress to internet)

## Cost Model

- **KV reads**: $0.50 per million (after first 10M free)
- **R2 reads**: $0.36 per million (Class A ops)
- **R2 egress**: FREE to Cloudflare Workers
- **Workers requests**: $0.50 per million (after first 10M free)

**Example**: 1M asset requests/month:
- KV reads: $0.50
- R2 reads: $0.36
- Workers: $0.50
- **Total**: ~$1.36/month

## Open Questions

- Should we support range requests (HTTP 206)?
- Image transformations (resize, format convert)?
- Video streaming (HLS, DASH)?
- Rate limiting per asset or per IP?
- Watermarking for restricted materials?
