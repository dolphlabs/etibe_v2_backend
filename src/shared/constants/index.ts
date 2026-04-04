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

export const BASE_CONFIG = {
  SEPOLIA_RPC: "https://sepolia.base.org",
  MAINNET_RPC: "https://mainnet.base.org",
  CHAIN_ID_MAINNET: 8453,
  CHAIN_ID_SEPOLIA: 84532,
} as const;

export const BASE_TOKEN_CONTRACTS = {
  mainnet: {
    CNGN: "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  sepolia: {
    CNGN: "0xa1F8BD1892C85746AE71B97C31B1965C4641f1F0",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
} as const;
