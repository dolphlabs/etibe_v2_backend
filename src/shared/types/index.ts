/**
 * Standard API response envelope structure.
 * All API responses follow this consistent format.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: ResponseMeta;
  error?: ErrorDetails;
}

/**
 * Metadata for paginated responses.
 */
export interface ResponseMeta {
  timestamp?: string;
  path?: string;
  pagination?: PaginationMeta;
  requestId?: string;
}

/**
 * Pagination metadata structure.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Error details structure for failed responses.
 */
export interface ErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * Paginated result wrapper for repository queries.
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Base query options for repository methods.
 */
export interface QueryOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  select?: string[];
  populate?: string | string[] | PopulateOptions[];
}

/**
 * Populate options for Mongoose queries.
 */
export interface PopulateOptions {
  path: string;
  select?: string;
  populate?: PopulateOptions[];
}

/**
 * Soft delete interface for documents.
 */
export interface SoftDeletable {
  deletedAt?: Date | null;
  isDeleted: boolean;
}

/**
 * Base document interface with timestamps.
 */
export interface BaseDocument extends SoftDeletable {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}
