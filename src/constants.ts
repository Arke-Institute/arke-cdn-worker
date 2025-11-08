export const VARIANT_SIZES = {
  thumb: 200,
  medium: 1288,
  large: 2400,
} as const;

export const VARIANT_NAMES: readonly string[] = ['thumb', 'medium', 'large', 'original'] as const;

export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
