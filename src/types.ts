export type VariantName = 'thumb' | 'medium' | 'large' | 'original';

export interface ImageVariant {
  // Storage (one required)
  r2_key?: string;
  url?: string;

  // Metadata
  width: number;
  height: number;
  size_bytes: number;
  content_type?: string; // Usually same as parent, but allow override
}

export interface AssetMetadata {
  // Storage type (backwards compatible)
  storage_type: 'url' | 'r2';

  // Original/primary asset (backwards compatible - still used for non-image assets)
  url?: string;
  r2_key?: string;
  content_type?: string;
  size_bytes?: number;

  // Image-specific metadata (NEW)
  is_image?: boolean;
  original_width?: number;
  original_height?: number;

  // Image variants (NEW - optional, flexible)
  // Can have 0, 1, 2, 3, or all 4 variants
  variants?: {
    thumb?: ImageVariant;
    medium?: ImageVariant;
    large?: ImageVariant;
    original?: ImageVariant;
  };

  // Default variant (NEW - optional, auto-calculated if not provided)
  default_variant?: VariantName;

  // Standard fields
  created_at?: string;
  updated_at?: string;
}

export interface Env {
  ASSET_MAP: KVNamespace;
  ARKE_ARCHIVE: R2Bucket;
  ALLOWED_ORIGINS?: string;
}
