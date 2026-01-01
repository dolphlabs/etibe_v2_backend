import { registerAs } from "@nestjs/config";

export const appConfig = registerAs("app", () => ({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  apiPrefix: process.env.API_PREFIX || "api",
  apiVersion: process.env.API_VERSION || "v1",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",
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
