export const PAYOUT_QUEUE_NAME = "etibe-payouts";

export enum PayoutJobType {
  SCHEDULED_PAYOUT = "SCHEDULED_PAYOUT",
  RETRY_PAYOUT = "RETRY_PAYOUT",
}

export const generatePayoutJobId = (
  circleId: string,
  roundNumber: number
): string => `payout:${circleId}:${roundNumber}`;

export const PAYOUT_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffType: "exponential" as const,
  backoffDelay: 5000,
  backoffMultiplier: 2,
};

export const PAYOUT_JOB_OPTIONS = {
  removeOnComplete: {
    count: 100,
    age: 7 * 24 * 60 * 60,
  },
  removeOnFail: false,
  attempts: PAYOUT_RETRY_CONFIG.maxAttempts,
  backoff: {
    type: PAYOUT_RETRY_CONFIG.backoffType,
    delay: PAYOUT_RETRY_CONFIG.backoffDelay,
  },
};

// Events
export const CIRCLE_EVENTS = {
  CIRCLE_ACTIVATED: "circle.activated",
  PAYOUT_COMPLETED: "payout.completed",
  PAYOUT_FAILED: "payout.failed",
  ROUND_ADVANCED: "round.advanced",
};

export interface PayoutJobData {
  circleId: string;
  roundNumber: number;
  recipientUserId: string;
  recipientNearAccountId?: string;
  recipientBaseAddress?: string;
  payoutAmount: string;
  currency: string;
  chain: "BASE" | "NEAR";
  scheduledPayoutDate: string;
  contractAddress: string;
  retryCount?: number;
}

export interface PayoutResult {
  success: boolean;
  txHash?: string;
  errorMessage?: string;
  timestamp: string;
  circleId: string;
  roundNumber: number;
  recipientUserId: string;
  amount: string;
  currency: string;
}
