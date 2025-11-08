import type { Context } from 'hono';
import type { Env, AssetMetadata, VariantName } from '../types';
import { isValidVariantName, getVariantToServe, calculateDefaultVariant, hasVariants, getVariantStorage } from '../utils/variants';
import { buildAssetHeaders } from '../utils/response';
import { DEFAULT_CONTENT_TYPE } from '../constants';

export async function handleRetrieval(c: Context<{ Bindings: Env }>) {
  const assetId = c.req.param('assetId');
  const trailingPath = c.req.param('path') || ''; // e.g., "medium" or "medium/photo.jpg" or ""

  try {
    // Look up metadata
    const metadataJson = await c.env.ASSET_MAP.get(assetId);

    if (!metadataJson) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const metadata: AssetMetadata = JSON.parse(metadataJson);

    // Parse requested variant from trailing path
    const pathParts = trailingPath.split('/').filter(Boolean);
    const firstPart = pathParts[0] || '';

    // Check if this is a variant request
    const isVariantRequest = isValidVariantName(firstPart);

    // Determine which variant to serve
    let variantToServe: VariantName | null = null;

    if (hasVariants(metadata)) {
      if (isVariantRequest) {
        // Explicit variant requested
        variantToServe = firstPart as VariantName;
      } else {
        // No variant specified - use default
        variantToServe = calculateDefaultVariant(metadata);
      }

      // Get variant with fallback
      const result = getVariantToServe(metadata, variantToServe);

      if (!result) {
        return c.json({
          error: 'No suitable variant found',
          requested: variantToServe
        }, 404);
      }

      const { variant, actualVariant } = result;

      // Get storage location
      const storage = getVariantStorage(variant);
      if (!storage) {
        return c.json({ error: 'Invalid variant storage configuration' }, 500);
      }

      // Fetch variant
      let body: ReadableStream | null;
      let contentType: string;

      if (storage.type === 'r2') {
        const r2Object = await c.env.ARKE_ARCHIVE.get(storage.location);
        if (!r2Object) {
          return c.json({ error: 'Variant not found in R2 storage' }, 404);
        }
        body = r2Object.body;
        contentType = variant.content_type || metadata.content_type || r2Object.httpMetadata?.contentType || DEFAULT_CONTENT_TYPE;
      } else {
        // URL storage
        const response = await fetch(storage.location);
        if (!response.ok) {
          return c.json({ error: 'Failed to fetch variant from storage' }, 503);
        }
        body = response.body;
        contentType = variant.content_type || metadata.content_type || response.headers.get('Content-Type') || DEFAULT_CONTENT_TYPE;
      }

      // Build headers with variant info
      const headers = buildAssetHeaders(
        contentType,
        variant.size_bytes,
        assetId,
        actualVariant,
        { width: variant.width, height: variant.height },
        metadata.original_width && metadata.original_height
          ? { width: metadata.original_width, height: metadata.original_height }
          : undefined
      );

      return new Response(body, { headers });

    } else {
      // Non-variant asset (backwards compatible path)

      // Reject variant requests for non-variant assets
      if (isVariantRequest) {
        return c.json({
          error: 'Variants not available for this asset type',
          assetId
        }, 400);
      }

      // Serve original asset
      let body: ReadableStream | null;
      let contentType: string;
      let contentLength: number | undefined;

      if (metadata.storage_type === 'r2' && metadata.r2_key) {
        const r2Object = await c.env.ARKE_ARCHIVE.get(metadata.r2_key);
        if (!r2Object) {
          return c.json({ error: 'Asset not found in R2 storage' }, 404);
        }
        body = r2Object.body;
        contentType = metadata.content_type || r2Object.httpMetadata?.contentType || DEFAULT_CONTENT_TYPE;
        contentLength = metadata.size_bytes || r2Object.size;

      } else if (metadata.storage_type === 'url' && metadata.url) {
        const response = await fetch(metadata.url);
        if (!response.ok) {
          return c.json({ error: 'Failed to fetch asset from storage' }, 503);
        }
        body = response.body;
        contentType = metadata.content_type || response.headers.get('Content-Type') || DEFAULT_CONTENT_TYPE;
        contentLength = metadata.size_bytes;

      } else {
        return c.json({ error: 'Invalid asset metadata: missing storage configuration' }, 500);
      }

      const headers = buildAssetHeaders(contentType, contentLength, assetId);

      return new Response(body, { headers });
    }

  } catch (error) {
    console.error('Error fetching asset:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
