export const APP_CONSTANTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  REQUEST_ID_HEADER: "x-request-id",
  DEVICE_ID_HEADER: "x-device-id",
  INVITE_CODE_LENGTH: 8,
  SESSION_TTL_DAYS: 7,
} as const;

export const COLLECTION_NAMES = {
  USERS: "users",
  CIRCLES: "circles",
  TRANSACTIONS: "transactions",
  INVITATIONS: "invitations",
  NOTIFICATIONS: "notifications",
} as const;

export const CACHE_KEYS = {
  USER: "user",
  USERS_LIST: "users:list",
  CIRCLE: "circle",
  CIRCLES_LIST: "circles:list",
  USER_CIRCLES: "user:circles",
  CIRCLE_MEMBERS: "circle:members",
  TRANSACTION: "transaction",
  SESSION: "session",
} as const;

export const CACHE_TTL = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 3600,
  VERY_LONG: 86400,
  SESSION: 604800, // 7 days
} as const;

export const NEAR_CONFIG = {
  TESTNET_RPC: "https://rpc.testnet.near.org",
  MAINNET_RPC: "https://rpc.mainnet.near.org",
} as const;
