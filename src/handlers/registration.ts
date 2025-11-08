import type { Context } from 'hono';
import type { Env, AssetMetadata, VariantName } from '../types';
import { validateRegistrationBody } from '../utils/validation';
import { calculateDefaultVariant, hasVariants } from '../utils/variants';
import { buildVariantUrls } from '../utils/response';

export async function handleRegistration(c: Context<{ Bindings: Env }>) {
  const assetId = c.req.param('assetId');

  try {
    const body = await c.req.json();

    // Validate request body
    const validation = validateRegistrationBody(body);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    // Build metadata
    const metadata: AssetMetadata = {
      storage_type: body.url ? 'url' : 'r2',
      url: body.url,
      r2_key: body.r2_key,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
      is_image: body.is_image || false,
      original_width: body.original_width,
      original_height: body.original_height,
      variants: body.variants,
      default_variant: body.default_variant,
      created_at: body.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Auto-calculate default variant if not provided and has variants
    if (hasVariants(metadata) && !metadata.default_variant) {
      metadata.default_variant = calculateDefaultVariant(metadata);
    }

    // Store in KV
    await c.env.ASSET_MAP.put(assetId, JSON.stringify(metadata));

    // Build response
    const response: any = {
      success: true,
      assetId,
      cdnUrl: `https://cdn.arke.institute/asset/${assetId}`,
      storage_type: metadata.storage_type,
    };

    // Add variant URLs if applicable
    if (hasVariants(metadata)) {
      const availableVariants = Object.keys(metadata.variants!) as VariantName[];
      response.defaultUrl = `https://cdn.arke.institute/asset/${assetId}/${metadata.default_variant}`;
      response.variants = buildVariantUrls(assetId, availableVariants);
    } else {
      // Non-variant asset (backwards compatible)
      response.sourceUrl = body.url;
      response.r2_key = body.r2_key;
    }

    return c.json(response, 201);

  } catch (error) {
    console.error('Error registering asset:', error);
    return c.json({
      error: 'Registration failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
