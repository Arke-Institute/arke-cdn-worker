import type { AssetMetadata, VariantName, ImageVariant } from '../types';
import { VARIANT_NAMES, VARIANT_SIZES } from '../constants';

/**
 * Check if a string is a valid variant name
 */
export function isValidVariantName(name: string): name is VariantName {
  return VARIANT_NAMES.includes(name);
}

/**
 * Calculate the default variant for an asset
 * Logic:
 *  - If medium exists: use medium
 *  - Else if original exists and width <= 1288: use original
 *  - Else if original exists: use original
 *  - Else: use first available variant
 */
export function calculateDefaultVariant(metadata: AssetMetadata): VariantName {
  // Explicit default takes precedence
  if (metadata.default_variant) {
    return metadata.default_variant;
  }

  // No variants - shouldn't happen for images, but handle gracefully
  if (!metadata.variants) {
    return 'original';
  }

  // Prefer medium if it exists
  if (metadata.variants.medium) {
    return 'medium';
  }

  // If original is small (≤ 1288px), use it
  if (metadata.variants.original && metadata.original_width && metadata.original_width <= VARIANT_SIZES.medium) {
    return 'original';
  }

  // Fallback chain: large -> original -> thumb
  if (metadata.variants.large) return 'large';
  if (metadata.variants.original) return 'original';
  if (metadata.variants.thumb) return 'thumb';

  // Should never reach here, but TypeScript needs it
  return 'original';
}

/**
 * Get the variant to serve, with intelligent fallback
 *
 * Fallback logic:
 *  - thumb: thumb -> medium -> original
 *  - medium: medium -> original
 *  - large: large -> medium -> original
 *  - original: original (no fallback)
 */
export function getVariantToServe(
  metadata: AssetMetadata,
  requestedVariant: VariantName
): { variant: ImageVariant; actualVariant: VariantName } | null {

  if (!metadata.variants) {
    return null;
  }

  // Define fallback chains
  const fallbackChains: Record<VariantName, VariantName[]> = {
    thumb: ['thumb', 'medium', 'original'],
    medium: ['medium', 'original'],
    large: ['large', 'medium', 'original'],
    original: ['original'],
  };

  const chain = fallbackChains[requestedVariant];

  for (const variantName of chain) {
    const variant = metadata.variants[variantName];
    if (variant) {
      return { variant, actualVariant: variantName };
    }
  }

  return null;
}

/**
 * Extract storage info from a variant
 */
export function getVariantStorage(variant: ImageVariant): { type: 'url' | 'r2'; location: string } | null {
  if (variant.r2_key) {
    return { type: 'r2', location: variant.r2_key };
  }
  if (variant.url) {
    return { type: 'url', location: variant.url };
  }
  return null;
}

/**
 * Check if asset has any variants (is an image with variants)
 */
export function hasVariants(metadata: AssetMetadata): boolean {
  return !!(metadata.is_image && metadata.variants && Object.keys(metadata.variants).length > 0);
}
