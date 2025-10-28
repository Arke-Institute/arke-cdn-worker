import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  ASSET_MAP: KVNamespace;
  ALLOWED_ORIGINS?: string;
}

interface AssetMetadata {
  url: string; // The actual URL where the asset is stored (IPFS, R2, S3, etc.)
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

    // Fetch from the stored URL
    const response = await fetch(metadata.url);

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch asset from storage' }, 503);
    }

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': metadata.content_type || response.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Asset-Id': assetId
    };

    if (metadata.size_bytes) {
      headers['Content-Length'] = metadata.size_bytes.toString();
    }

    // Stream to client
    return new Response(response.body, { headers });

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

    // Fetch from the stored URL
    const response = await fetch(metadata.url);

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch asset from storage' }, 503);
    }

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': metadata.content_type || response.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Asset-Id': assetId
    };

    if (metadata.size_bytes) {
      headers['Content-Length'] = metadata.size_bytes.toString();
    }

    // Stream to client
    return new Response(response.body, { headers });

  } catch (error) {
    console.error('Error fetching asset:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Asset registration endpoint
// Register an asset that's already stored somewhere (IPFS, R2, S3, etc.)
app.post('/asset/:assetId', async (c) => {
  const assetId = c.req.param('assetId');

  try {
    const body = await c.req.json<{
      url: string;
      content_type?: string;
      size_bytes?: number;
    }>();

    if (!body.url) {
      return c.json({ error: 'URL is required' }, 400);
    }

    // Create minimal metadata
    const metadata: AssetMetadata = {
      url: body.url,
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
      sourceUrl: body.url
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
