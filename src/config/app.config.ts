import { registerAs } from "@nestjs/config";

export const appConfig = registerAs("app", () => ({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  apiPrefix: process.env.API_PREFIX || "api",
  apiVersion: process.env.API_VERSION || "v1",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",
  appUrl: process.env.APP_URL || "http://localhost:3000",
}));

export const databaseConfig = registerAs("database", () => ({
  uri: process.env.MONGODB_URI || "mongodb://localhost:27017/etibe",
}));

export const redisConfig = registerAs("redis", () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
  ttl: parseInt(process.env.REDIS_TTL || "3600", 10),
}));

export const securityConfig = registerAs("security", () => ({
  throttleTtl: parseInt(process.env.THROTTLE_TTL || "60000", 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT || "100", 10),
}));

export const loggingConfig = registerAs("logging", () => ({
  level: process.env.LOG_LEVEL || "info",
}));

export const nearConfig = registerAs("near", () => ({
  networkId: process.env.NEAR_NETWORK_ID || "testnet",
  nodeUrl:
    process.env.NEAR_NODE_URL ||
    (process.env.NEAR_NETWORK_ID === "mainnet"
      ? "https://rpc.mainnet.near.org"
      : "https://rpc.testnet.near.org"),
  walletUrl:
    process.env.NEAR_WALLET_URL ||
    (process.env.NEAR_NETWORK_ID === "mainnet"
      ? "https://wallet.near.org"
      : "https://testnet.mynearwallet.com"),
  helperUrl:
    process.env.NEAR_HELPER_URL ||
    (process.env.NEAR_NETWORK_ID === "mainnet"
      ? "https://helper.mainnet.near.org"
      : "https://helper.testnet.near.org"),
  explorerUrl:
    process.env.NEAR_EXPLORER_URL ||
    (process.env.NEAR_NETWORK_ID === "mainnet"
      ? "https://nearblocks.io"
      : "https://testnet.nearblocks.io"),
  contractId: process.env.NEAR_CONTRACT_ID || "etibe.testnet",
  masterAccountId: process.env.NEAR_MASTER_ACCOUNT_ID || "etibe.testnet",
  masterPrivateKey: process.env.NEAR_MASTER_PRIVATE_KEY,
}));

export const sessionConfig = registerAs("session", () => ({
  ttl: parseInt(process.env.SESSION_TTL || "604800", 10),
  secret:
    process.env.SESSION_SECRET ||
    "change-this-to-a-very-long-random-string-in-production",
  cookieName: process.env.SESSION_COOKIE_NAME || "etibe_session",
  cookieSecure: process.env.NODE_ENV === "production",
  cookieSameSite: "lax" as const,
}));

export const cloudinaryConfig = registerAs("cloudinary", () => ({
  secret: process.env.CLOUDINARY_SECRET,
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
}));

export const resendConfig = registerAs("resend", () => ({
  apiKey: process.env.RESEND_API_KEY,
  fromEmail: process.env.RESEND_FROM_EMAIL || "noreply@etibe.app",
  fromName: process.env.RESEND_FROM_NAME || "Etibé",
}));

export const vaultConfig = registerAs("vault", () => ({
  masterKey: process.env.MASTER_ENCRYPTION_KEY,
}));
