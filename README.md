# arke-cdn-worker

URL: https://cdn.arke.institute/

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
  - `GET /asset/:assetId` - Retrieve asset by ID (returns default variant for images)
  - `GET /asset/:assetId/:variant` - Retrieve specific image variant (thumb, medium, large, original)
  - `GET /asset/:assetId/:variant/:filename` - Retrieve variant with vanity filename
  - Look up `assetId` in KV
  - KV entry contains: storage type, locations, variants (for images), content-type, size
  - **URL mode**: Fetch object from external storage URL (IPFS, R2 public URL, S3, etc.)
  - **R2 mode**: Fetch directly from arke-archive R2 bucket using R2 key
  - **Variant support**: Pre-generated image variants for optimal delivery
  - Stream to client with correct headers

- **Asset Registration**
  - `POST /asset/:assetId` - Register an asset with optional pre-generated variants
  - **Non-image assets**: `{ url?, r2_key?, content_type?, size_bytes? }`
  - **Image assets with variants**: `{ is_image: true, variants: {...}, original_width, original_height }`
  - Flexible variant support: can register 0-4 variants (thumb, medium, large, original)
  - Auto-calculates default variant (prefers medium, falls back to original for small images)
  - Stores metadata in KV with storage type
  - Returns CDN URLs for all available variants

- **Image Variants**
  - **thumb**: 200px longest edge - thumbnails for previews
  - **medium**: 1288px longest edge - OCR optimized, default for most use cases
  - **large**: 2400px longest edge - high quality display
  - **original**: Unmodified source image
  - Smart fallback: if requested variant doesn't exist, serves best available alternative
  - Variants are optional - images can be registered with any subset of variants

- **HTTP Headers**
  - `Content-Type` from metadata or storage response
  - `Cache-Control: public, max-age=31536000, immutable` (assets never change)
  - `X-Asset-Id` header for tracking
  - `X-Variant` header indicating which variant was served (for images)
  - `X-Variant-Dimensions` actual dimensions of served variant
  - `X-Original-Dimensions` original image dimensions
  - `Content-Length` when size is known

- **Storage Abstraction**
  - **Two modes supported**:
    - **URL mode**: Fetch from any HTTP-accessible storage (IPFS, R2 public URLs, S3 signed URLs, etc.)
    - **R2 mode**: Direct access to arke-archive R2 bucket (more efficient, no public URLs needed)
  - Both modes work for variants - each variant can have its own r2_key or url
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

### KV Entry Format (Non-Image Assets)
```typescript
// Key: assetId (ULID)
// Value: JSON string
{
  storage_type: "url" | "r2",
  url?: string,
  r2_key?: string,
  content_type?: string,
  size_bytes?: number,
  is_image: false,
  created_at?: string,
  updated_at?: string
}
```

### KV Entry Format (Image Assets with Variants)
```typescript
{
  storage_type: "url" | "r2",
  content_type: "image/jpeg",
  is_image: true,
  original_width: 4416,
  original_height: 3708,
  default_variant: "medium",  // Auto-calculated if not provided

  variants: {
    thumb?: {
      r2_key?: string,      // or url
      url?: string,
      width: 200,
      height: 168,
      size_bytes: 15000
    },
    medium?: {
      r2_key: "archive/2025/ABC123/medium.jpg",
      width: 1288,
      height: 1082,
      size_bytes: 245000
    },
    large?: {
      r2_key: "archive/2025/ABC123/large.jpg",
      width: 2400,
      height: 2016,
      size_bytes: 890000
    },
    original?: {
      r2_key: "archive/2025/ABC123/original.jpg",
      width: 4416,
      height: 3708,
      size_bytes: 4900000
    }
  },

  created_at: "2025-03-07T10:00:00Z",
  updated_at: "2025-03-07T10:00:00Z"
}
```

### Asset URL Format
```
# Non-image assets or default variant
https://cdn.arke.institute/asset/{assetId}

# Specific image variants
https://cdn.arke.institute/asset/{assetId}/thumb
https://cdn.arke.institute/asset/{assetId}/medium
https://cdn.arke.institute/asset/{assetId}/large
https://cdn.arke.institute/asset/{assetId}/original

# With vanity filenames
https://cdn.arke.institute/asset/{assetId}/medium/photo.jpg
https://cdn.arke.institute/asset/{assetId}/thumb/photo.jpg
```

### Response Headers (Non-Image)
```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 12345678
Cache-Control: public, max-age=31536000, immutable
X-Asset-Id: 01K8ABCDEF...
```

### Response Headers (Image Variant)
```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 245000
Cache-Control: public, max-age=31536000, immutable
X-Asset-Id: 01K8ABCDEF...
X-Variant: medium
X-Variant-Dimensions: 1288x1082
X-Original-Dimensions: 4416x3708
```

## Implementation Status

### ✅ Completed
- Modular TypeScript architecture with handlers and utilities
- Health check endpoint (`GET /`)
- Asset retrieval with variant support (`GET /asset/:assetId/:variant?`)
- Asset registration with variants (`POST /asset/:assetId`)
- KV-based metadata storage with variant tracking
- **Image variant system**:
  - Pre-generated variants (thumb, medium, large, original)
  - Smart default selection (medium preferred, original fallback)
  - Intelligent fallback chain for missing variants
  - Flexible variant support (0-4 variants allowed)
- **Dual storage mode support**:
  - URL-based storage (supports any HTTP-accessible storage: IPFS, public R2 URLs, S3, etc.)
  - Direct R2 bucket access (arke-archive bucket via ARKE_ARCHIVE binding)
  - Works for both variants and non-variant assets
- CORS middleware
- Comprehensive error handling (404, 503, 500, 400)
- Enhanced response headers (variant info, dimensions)
- Input validation for variants and storage
- Backwards compatibility with non-variant assets
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
  "version": "2.0.0",
  "features": ["variants", "r2", "url-storage"]
}
```

### `GET /asset/:assetId`
Retrieve an asset by its ID.

**Parameters:**
- `assetId` - The unique asset identifier

**Behavior:**
- For **non-image assets**: Returns the original asset
- For **image assets with variants**: Returns the default variant (usually `medium`)

**Response:**
- `200 OK` - Asset content with appropriate Content-Type
- `404 Not Found` - Asset not found in KV
- `503 Service Unavailable` - Failed to fetch from storage backend
- `500 Internal Server Error` - Other errors

**Headers (Non-Image):**
- `Content-Type` - From metadata or storage response
- `Cache-Control: public, max-age=31536000, immutable`
- `X-Asset-Id` - The asset ID
- `Content-Length` - Size in bytes (if known)

**Headers (Image with Variants):**
- Same as above, plus:
- `X-Variant` - Which variant was served (e.g., "medium")
- `X-Variant-Dimensions` - Dimensions of served variant (e.g., "1288x1082")
- `X-Original-Dimensions` - Original image dimensions (e.g., "4416x3708")

### `GET /asset/:assetId/:variant`
Retrieve a specific image variant.

**Parameters:**
- `assetId` - The unique asset identifier
- `variant` - One of: `thumb`, `medium`, `large`, `original`

**Behavior:**
- Returns the requested variant if available
- Falls back intelligently if variant doesn't exist:
  - `thumb` → `medium` → `original`
  - `medium` → `original`
  - `large` → `medium` → `original`
  - `original` → (no fallback)

**Response:**
- `200 OK` - Variant content
- `400 Bad Request` - Variant requested for non-image asset
- `404 Not Found` - Asset not found or no suitable variant available

### `GET /asset/:assetId/:variant/:filename`
Retrieve a variant with vanity filename (e.g., `/asset/ABC123/medium/photo.jpg`).

Same behavior as `GET /asset/:assetId/:variant`, filename is ignored but allows semantic URLs.

### `POST /asset/:assetId`
Register an asset with optional pre-generated variants.

**Parameters:**
- `assetId` - The unique asset identifier to register

**Request Body (Non-Image Asset):**
```json
{
  "r2_key": "archive/2025/document.pdf",
  "content_type": "application/pdf",
  "size_bytes": 2345678
}
```

**Request Body (Image with All Variants):**
```json
{
  "is_image": true,
  "content_type": "image/jpeg",
  "original_width": 4416,
  "original_height": 3708,
  "variants": {
    "thumb": {
      "r2_key": "archive/2025/ABC123/thumb.jpg",
      "width": 200,
      "height": 168,
      "size_bytes": 15000
    },
    "medium": {
      "r2_key": "archive/2025/ABC123/medium.jpg",
      "width": 1288,
      "height": 1082,
      "size_bytes": 245000
    },
    "large": {
      "r2_key": "archive/2025/ABC123/large.jpg",
      "width": 2400,
      "height": 2016,
      "size_bytes": 890000
    },
    "original": {
      "r2_key": "archive/2025/ABC123/original.jpg",
      "width": 4416,
      "height": 3708,
      "size_bytes": 4900000
    }
  }
}
```

**Request Body (Image with Partial Variants):**
```json
{
  "is_image": true,
  "content_type": "image/jpeg",
  "original_width": 800,
  "original_height": 600,
  "variants": {
    "original": {
      "r2_key": "archive/2025/SMALL/original.jpg",
      "width": 800,
      "height": 600,
      "size_bytes": 120000
    }
  }
}
```

**Response (Non-Image):**
```json
{
  "success": true,
  "assetId": "DEF456",
  "cdnUrl": "https://cdn.arke.institute/asset/DEF456",
  "storage_type": "r2",
  "r2_key": "archive/2025/document.pdf"
}
```

**Response (Image with Variants):**
```json
{
  "success": true,
  "assetId": "ABC123",
  "cdnUrl": "https://cdn.arke.institute/asset/ABC123",
  "storage_type": "r2",
  "defaultUrl": "https://cdn.arke.institute/asset/ABC123/medium",
  "variants": {
    "thumb": "https://cdn.arke.institute/asset/ABC123/thumb",
    "medium": "https://cdn.arke.institute/asset/ABC123/medium",
    "large": "https://cdn.arke.institute/asset/ABC123/large",
    "original": "https://cdn.arke.institute/asset/ABC123/original"
  }
}
```

**Status Codes:**
- `201 Created` - Asset registered successfully
- `400 Bad Request` - Invalid request body or variant data
- `500 Internal Server Error` - Registration failed

**Validation:**
- **Non-image**: Must have `url` or `r2_key` (not both)
- **Image with variants**: Each variant must have (`r2_key` or `url`) and (`width`, `height`, `size_bytes`)
- Variants are optional - can have 0-4 variants
- `default_variant` is auto-calculated if not provided

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

### Register a non-image asset
```bash
curl -X POST https://cdn.arke.institute/asset/my-document \
  -H "Content-Type: application/json" \
  -d '{
    "r2_key": "archive/2025/document.pdf",
    "content_type": "application/pdf",
    "size_bytes": 2345678
  }'
```

### Register an image with all variants
```bash
curl -X POST https://cdn.arke.institute/asset/ABC123 \
  -H "Content-Type: application/json" \
  -d '{
    "is_image": true,
    "content_type": "image/jpeg",
    "original_width": 4416,
    "original_height": 3708,
    "variants": {
      "thumb": {
        "r2_key": "archive/2025/ABC123/thumb.jpg",
        "width": 200,
        "height": 168,
        "size_bytes": 15000
      },
      "medium": {
        "r2_key": "archive/2025/ABC123/medium.jpg",
        "width": 1288,
        "height": 1082,
        "size_bytes": 245000
      },
      "large": {
        "r2_key": "archive/2025/ABC123/large.jpg",
        "width": 2400,
        "height": 2016,
        "size_bytes": 890000
      },
      "original": {
        "r2_key": "archive/2025/ABC123/original.jpg",
        "width": 4416,
        "height": 3708,
        "size_bytes": 4900000
      }
    }
  }'
```

### Retrieve assets
```bash
# Non-image asset
curl https://cdn.arke.institute/asset/my-document

# Image - default variant (medium)
curl https://cdn.arke.institute/asset/ABC123

# Image - specific variants
curl https://cdn.arke.institute/asset/ABC123/thumb
curl https://cdn.arke.institute/asset/ABC123/medium
curl https://cdn.arke.institute/asset/ABC123/large
curl https://cdn.arke.institute/asset/ABC123/original

# With vanity filename
curl https://cdn.arke.institute/asset/ABC123/medium/photo.jpg
```

### Check response headers
```bash
curl -I https://cdn.arke.institute/asset/ABC123/medium
# Returns:
# X-Asset-Id: ABC123
# X-Variant: medium
# X-Variant-Dimensions: 1288x1082
# X-Original-Dimensions: 4416x3708
```

## Key Design Decisions

- **Pre-generated variants**: All image processing happens during ingestion, not on-demand in the CDN
- **Flexible variant support**: Can have 0-4 variants, any combination - adapts to image size
- **Smart defaults**: Auto-selects medium (1288px) or original for small images
- **Intelligent fallback**: Never fails if a variant is missing, serves best alternative
- **Dual storage modes**: Support both external URLs and direct R2 access for flexibility
- **KV for lookups**: Fast edge lookups, globally replicated
- **Streaming**: No memory limits, handle multi-GB assets
- **Immutable URLs**: Assets never change, aggressive caching
- **Backend abstraction**: Easy to migrate storage later
- **Modular architecture**: Clean separation of concerns (handlers, utils, types)

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
