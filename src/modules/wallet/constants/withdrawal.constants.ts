export const WITHDRAWAL_QUEUE_NAME = "etibe-withdrawals";

export enum WithdrawalJobType {
  USER_WITHDRAWAL = "USER_WITHDRAWAL",
  RETRY_WITHDRAWAL = "RETRY_WITHDRAWAL",
}
export const generateWithdrawalJobId = (
  userId: string,
  idempotencyKey: string
): string => `withdrawal:${userId}:${idempotencyKey}`;

export const WITHDRAWAL_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffType: "exponential" as const,
  backoffDelay: 5000,
  backoffMultiplier: 2,
};

export const WITHDRAWAL_JOB_OPTIONS = {
  removeOnComplete: {
    count: 100,
    age: 7 * 24 * 60 * 60, // 7 days
  },
  removeOnFail: false,
  attempts: WITHDRAWAL_RETRY_CONFIG.maxAttempts,
  backoff: {
    type: WITHDRAWAL_RETRY_CONFIG.backoffType,
    delay: WITHDRAWAL_RETRY_CONFIG.backoffDelay,
  },
};

export const WITHDRAWAL_EVENTS = {
  WITHDRAWAL_INITIATED: "withdrawal.initiated",
  WITHDRAWAL_PROCESSING: "withdrawal.processing",
  WITHDRAWAL_COMPLETED: "withdrawal.completed",
  WITHDRAWAL_FAILED: "withdrawal.failed",
};

export const ASSET_DECIMALS: Record<string, number> = {
  NEAR: 24,
  USDT: 6,
  USDC: 6,
};

export const MIN_WITHDRAWAL_AMOUNTS: Record<string, number> = {
  NEAR: 0.01,
  USDT: 0.1,
  USDC: 0.1,
};

export const MAX_WITHDRAWAL_AMOUNTS: Record<string, number> = {
  NEAR: 10000,
  USDT: 100000,
  USDC: 100000,
};

export const STORAGE_DEPOSIT_AMOUNT = "1250000000000000000000"; // 0.00125 NEAR

export const GAS_FOR_FT_TRANSFER = "30000000000000"; // 30 TGas
export const GAS_FOR_STORAGE_DEPOSIT = "10000000000000"; // 10 TGas

export interface WithdrawalJobData {
  transactionId: string;
  userId: string;
  userNearAccountId: string;
  destinationAddress: string;
  amount: string;
  asset: "NEAR" | "USDT" | "USDC";
  idempotencyKey: string;
  retryCount?: number;
  requiresStorageDeposit?: boolean;
}

export interface WithdrawalResult {
  success: boolean;
  txHash?: string;
  errorMessage?: string;
  timestamp: string;
  transactionId: string;
  userId: string;
  amount: string;
  asset: string;
  destinationAddress: string;
}

export const WITHDRAWAL_OTP_PREFIX = "withdrawal_otp:";
export const WITHDRAWAL_OTP_EXPIRY_SECONDS = 300; // 5 minutes
export const WITHDRAWAL_OTP_MAX_ATTEMPTS = 3;
