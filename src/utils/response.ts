import type { VariantName } from '../types';
import { CACHE_CONTROL } from '../constants';

/**
 * Build variant URLs for registration response
 */
export function buildVariantUrls(assetId: string, availableVariants: VariantName[]): Record<string, string> {
  const urls: Record<string, string> = {};

  for (const variant of availableVariants) {
    urls[variant] = `https://cdn.arke.institute/asset/${assetId}/${variant}`;
  }

  return urls;
}

/**
 * Build response headers for asset retrieval
 */
export function buildAssetHeaders(
  contentType: string,
  contentLength: number | undefined,
  assetId: string,
  actualVariant?: VariantName,
  variantDimensions?: { width: number; height: number },
  originalDimensions?: { width: number; height: number }
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': CACHE_CONTROL,
    'X-Asset-Id': assetId,
  };

  if (contentLength) {
    headers['Content-Length'] = contentLength.toString();
  }

  if (actualVariant) {
    headers['X-Variant'] = actualVariant;
  }

  if (variantDimensions) {
    headers['X-Variant-Dimensions'] = `${variantDimensions.width}x${variantDimensions.height}`;
  }

  if (originalDimensions) {
    headers['X-Original-Dimensions'] = `${originalDimensions.width}x${originalDimensions.height}`;
  }

  return headers;
}
