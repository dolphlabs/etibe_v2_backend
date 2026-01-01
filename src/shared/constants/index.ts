export const APP_CONSTANTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  REQUEST_ID_HEADER: "x-request-id",
} as const;

export const COLLECTION_NAMES = {
  USERS: "users",
} as const;

export const CACHE_KEYS = {
  USER: "user",
  USERS_LIST: "users:list",
} as const;

export const CACHE_TTL = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 3600,
  VERY_LONG: 86400,
} as const;
