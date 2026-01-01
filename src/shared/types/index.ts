export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: ResponseMeta;
  error?: ErrorDetails;
}

export interface ResponseMeta {
  timestamp?: string;
  path?: string;
  pagination?: PaginationMeta;
  requestId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface QueryOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  select?: string[];
  populate?: string | string[] | PopulateOptions[];
}

export interface PopulateOptions {
  path: string;
  select?: string;
  populate?: PopulateOptions[];
}

export interface SoftDeletable {
  deletedAt?: Date | null;
  isDeleted: boolean;
}

export interface BaseDocument extends SoftDeletable {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}

export * from "./session.types";
