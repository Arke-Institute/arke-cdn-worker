import type { ImageVariant } from '../types';

/**
 * Validate that a variant has required fields
 */
export function validateVariant(variant: any): variant is ImageVariant {
  // Must have either r2_key or url
  const hasStorage = variant.r2_key || variant.url;

  // Must have dimensions and size
  const hasMetadata =
    typeof variant.width === 'number' &&
    typeof variant.height === 'number' &&
    typeof variant.size_bytes === 'number';

  return hasStorage && hasMetadata;
}

/**
 * Validate registration request body
 */
export function validateRegistrationBody(body: any): { valid: boolean; error?: string } {
  // For non-image assets (backwards compatible)
  if (!body.is_image) {
    // Old format: must have url or r2_key
    if (!body.url && !body.r2_key) {
      return { valid: false, error: 'Either url or r2_key is required' };
    }
    if (body.url && body.r2_key) {
      return { valid: false, error: 'Cannot specify both url and r2_key for non-image assets' };
    }
    return { valid: true };
  }

  // For image assets with variants
  if (body.variants) {
    // Validate each variant
    for (const [variantName, variant] of Object.entries(body.variants)) {
      if (!validateVariant(variant)) {
        return {
          valid: false,
          error: `Invalid variant '${variantName}': must have (r2_key or url) and (width, height, size_bytes)`
        };
      }
    }

    // Should have at least one variant
    if (Object.keys(body.variants).length === 0) {
      return { valid: false, error: 'Image assets with variants must have at least one variant' };
    }
  } else {
    // Image without variants - must have url or r2_key (backwards compatible)
    if (!body.url && !body.r2_key) {
      return { valid: false, error: 'Either url, r2_key, or variants is required' };
    }
  }

  return { valid: true };
}
