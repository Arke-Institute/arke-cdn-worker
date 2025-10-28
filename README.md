# arke-cdn-worker

## Purpose

Provides stable, permanent URLs for archival assets via `cdn.arke.institute/asset/{assetId}`. Acts as an indirection layer between manifests and storage backends, enabling storage mobility without breaking links.

## Architecture

**Deployment**: Cloudflare Worker at `cdn.arke.institute`

**Runtime**: V8 isolate, handles streaming from R2/S3 to client

**Bindings**:
- KV namespace (`ASSET_MAP`) - asset ID → storage location mapping
- R2 bucket(s) (`ARCHIVE_BUCKET`) - current storage backend
- Optional: S3 credentials (future)

## Responsibilities

- **Asset Retrieval**
  - `GET /asset/:assetId`
  - Look up `assetId` in KV
  - KV entry contains: backend type, bucket, key, sha256, content-type
  - Fetch object from storage backend
  - Stream to client with correct headers

- **HTTP Headers**
  - `Content-Type` from metadata
  - `ETag` from sha256 hash
  - `Cache-Control: public, max-age=31536000, immutable` (assets never change)
  - `Content-Disposition` for downloads (optional)

- **Storage Abstraction**
  - Current: R2
  - Future: S3, IPFS Gateway, hybrid
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
  backend: "r2" | "s3" | "ipfs",
  bucket: string,           // e.g., "arke-archive"
  key: string,              // e.g., "archive/01K8ABCDEF.tiff"
  sha256: string,           // hex digest for ETag and fixity
  content_type: string,     // e.g., "image/tiff"
  size_bytes: number,
  created_at: string,       // ISO 8601
  access_level?: "public" | "restricted" | "private",
  embargo_until?: string    // ISO 8601 (future)
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
ETag: "abc123...sha256"
Cache-Control: public, max-age=31536000, immutable
X-Asset-Id: 01K8ABCDEF...
X-Storage-Backend: r2
```

## Next Steps

### Phase 1: Basic R2 Streaming
1. Set up Cloudflare Worker project
2. Configure KV and R2 bindings
3. Implement `GET /asset/:assetId`
4. Look up asset in KV
5. Stream from R2 to response
6. Set correct headers

### Phase 2: Error Handling
1. Handle missing asset (404)
2. Handle missing KV entry (404)
3. Handle R2 fetch errors (503)
4. Add retry logic
5. Logging and metrics

### Phase 3: Caching
1. Leverage CF edge cache (automatic)
2. Set optimal cache headers
3. Implement cache purge API (for corrections)

### Phase 4: Multiple Backends
1. Add S3 support
2. Implement backend abstraction layer
3. Handle fallback (R2 → S3 → IPFS)

### Phase 5: Access Control
1. Parse JWT tokens from query params or headers
2. Check access_level from KV metadata
3. Enforce embargo dates
4. Return 403 for unauthorized access

### Phase 6: IIIF Support (Optional)
1. Implement IIIF Image API endpoint
2. Tile generation for large images
3. Integrate with external IIIF processor

## Key Code Structure

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/asset\/([0-9A-HJKMNP-TV-Z]{26})/);

    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const assetId = match[1];

    // Look up in KV
    const metadataJson = await env.ASSET_MAP.get(assetId);
    if (!metadataJson) {
      return new Response('Asset not found', { status: 404 });
    }

    const metadata = JSON.parse(metadataJson);

    // Fetch from backend
    const object = await fetchFromBackend(env, metadata);
    if (!object) {
      return new Response('Storage error', { status: 503 });
    }

    // Stream to client
    return new Response(object.body, {
      headers: {
        'Content-Type': metadata.content_type,
        'ETag': `"${metadata.sha256}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Asset-Id': assetId,
        'X-Storage-Backend': metadata.backend
      }
    });
  }
};

async function fetchFromBackend(env: Env, metadata: AssetMetadata): Promise<R2ObjectBody | null> {
  switch (metadata.backend) {
    case 'r2':
      return await env.ARCHIVE_BUCKET.get(metadata.key);

    case 's3':
      // Future: fetch from S3
      throw new Error('S3 backend not implemented');

    case 'ipfs':
      // Future: fetch from IPFS gateway
      throw new Error('IPFS backend not implemented');

    default:
      throw new Error(`Unknown backend: ${metadata.backend}`);
  }
}
```

## Configuration (wrangler.toml)

```toml
name = "arke-cdn-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "ASSET_MAP"
id = "..."

[[r2_buckets]]
binding = "ARCHIVE_BUCKET"
bucket_name = "arke-archive"

[vars]
ALLOWED_ORIGINS = "*"  # CORS (adjust for production)
```

## Key Design Decisions

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
