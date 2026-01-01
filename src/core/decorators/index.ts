import { SetMetadata, applyDecorators } from "@nestjs/common";

/**
 * Metadata key for skipping response transformation.
 */
export const SKIP_RESPONSE_TRANSFORM_KEY = "skipResponseTransform";

/**
 * Decorator to skip the standardized response transformation.
 * Use this for endpoints that need to return raw data (e.g., file downloads).
 */
export const SkipResponseTransform = () =>
  SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true);

/**
 * Metadata key for public routes (no auth required).
 */
export const IS_PUBLIC_KEY = "isPublic";

/**
 * Decorator to mark an endpoint as public (no authentication required).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Decorator for pagination query parameters.
 * Combines commonly used decorators for paginated endpoints.
 */
export const Paginated = () => {
  return applyDecorators();
};

/**
 * Creates a cache key decorator for method-level caching.
 */
export const CACHE_KEY_METADATA = "cache_key";

/**
 * Decorator for custom cache key generation.
 */
export const CacheKey = (key: string) => SetMetadata(CACHE_KEY_METADATA, key);
