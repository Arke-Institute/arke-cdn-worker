import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  ASSET_MAP: KVNamespace;
  ARKE_ARCHIVE: R2Bucket;
  ALLOWED_ORIGINS?: string;
}

interface AssetMetadata {
  storage_type: 'url' | 'r2';
  url?: string; // The actual URL where the asset is stored (IPFS, R2, S3, etc.)
  r2_key?: string; // The R2 key in the arke-archive bucket
  content_type?: string;
  size_bytes?: number;
  created_at?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use('*', cors());

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    service: 'arke-cdn-worker',
    status: 'healthy',
    version: '1.0.0'
  });
});

// Asset retrieval endpoint
app.get('/asset/:assetId/*', async (c) => {
  const assetId = c.req.param('assetId');

  try {
    // Look up asset metadata in KV
    const metadataJson = await c.env.ASSET_MAP.get(assetId);

    if (!metadataJson) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const metadata: AssetMetadata = JSON.parse(metadataJson);

    let body: ReadableStream | null;
    let contentType: string;
    let contentLength: number | undefined;

    // Handle different storage types
    if (metadata.storage_type === 'r2' && metadata.r2_key) {
      // Fetch from R2 bucket
      const r2Object = await c.env.ARKE_ARCHIVE.get(metadata.r2_key);

      if (!r2Object) {
        return c.json({ error: 'Asset not found in R2 storage' }, 404);
      }

      body = r2Object.body;
      contentType = metadata.content_type || r2Object.httpMetadata?.contentType || 'application/octet-stream';
      contentLength = metadata.size_bytes || r2Object.size;

    } else if (metadata.storage_type === 'url' && metadata.url) {
      // Fetch from the stored URL
      const response = await fetch(metadata.url);

      if (!response.ok) {
        return c.json({ error: 'Failed to fetch asset from storage' }, 503);
      }

      body = response.body;
      contentType = metadata.content_type || response.headers.get('Content-Type') || 'application/octet-stream';
      contentLength = metadata.size_bytes;

    } else {
      return c.json({ error: 'Invalid asset metadata: missing storage configuration' }, 500);
    }

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Asset-Id': assetId
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength.toString();
    }

    // Stream to client
    return new Response(body, { headers });

  } catch (error) {
    console.error('Error fetching asset:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Simple version without trailing path
app.get('/asset/:assetId', async (c) => {
  const assetId = c.req.param('assetId');

  try {
    // Look up asset metadata in KV
    const metadataJson = await c.env.ASSET_MAP.get(assetId);

    if (!metadataJson) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const metadata: AssetMetadata = JSON.parse(metadataJson);

    let body: ReadableStream | null;
    let contentType: string;
    let contentLength: number | undefined;

    // Handle different storage types
    if (metadata.storage_type === 'r2' && metadata.r2_key) {
      // Fetch from R2 bucket
      const r2Object = await c.env.ARKE_ARCHIVE.get(metadata.r2_key);

      if (!r2Object) {
        return c.json({ error: 'Asset not found in R2 storage' }, 404);
      }

      body = r2Object.body;
      contentType = metadata.content_type || r2Object.httpMetadata?.contentType || 'application/octet-stream';
      contentLength = metadata.size_bytes || r2Object.size;

    } else if (metadata.storage_type === 'url' && metadata.url) {
      // Fetch from the stored URL
      const response = await fetch(metadata.url);

      if (!response.ok) {
        return c.json({ error: 'Failed to fetch asset from storage' }, 503);
      }

      body = response.body;
      contentType = metadata.content_type || response.headers.get('Content-Type') || 'application/octet-stream';
      contentLength = metadata.size_bytes;

    } else {
      return c.json({ error: 'Invalid asset metadata: missing storage configuration' }, 500);
    }

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Asset-Id': assetId
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength.toString();
    }

    // Stream to client
    return new Response(body, { headers });

  } catch (error) {
    console.error('Error fetching asset:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Asset registration endpoint
// Register an asset that's already stored somewhere (IPFS, R2, S3, etc.) or in R2
app.post('/asset/:assetId', async (c) => {
  const assetId = c.req.param('assetId');

  try {
    const body = await c.req.json<{
      url?: string;
      r2_key?: string;
      content_type?: string;
      size_bytes?: number;
    }>();

    // Validation: ensure exactly one storage method is provided
    if (!body.url && !body.r2_key) {
      return c.json({ error: 'Either url or r2_key is required' }, 400);
    }

    if (body.url && body.r2_key) {
      return c.json({ error: 'Cannot specify both url and r2_key' }, 400);
    }

    // Create metadata based on storage type
    const metadata: AssetMetadata = {
      storage_type: body.url ? 'url' : 'r2',
      url: body.url,
      r2_key: body.r2_key,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
      created_at: new Date().toISOString()
    };

    // Store metadata in KV
    await c.env.ASSET_MAP.put(assetId, JSON.stringify(metadata));

    // Return success response with CDN URL
    return c.json({
      success: true,
      assetId: assetId,
      cdnUrl: `https://cdn.arke.institute/asset/${assetId}`,
      storage_type: metadata.storage_type,
      sourceUrl: body.url,
      r2_key: body.r2_key
    }, 201);

  } catch (error) {
    console.error('Error registering asset:', error);
    return c.json({
      error: 'Registration failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
