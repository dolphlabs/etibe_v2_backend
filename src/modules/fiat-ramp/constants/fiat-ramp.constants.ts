export const NOMBA_TOKEN_CACHE_KEY = "nomba:access_token";
export const EXCHANGE_RATE_CACHE_KEY = "fiat:rate:cNGN:NGN";
export const EXCHANGE_RATE_TTL_MS = 30_000; // 30 seconds

export const MIN_DEPOSIT_NGN = 500;
export const MAX_DEPOSIT_NGN = 5_000_000;
export const MIN_WITHDRAWAL_CNGN = 500; // cNGN has same value as NGN

// Ledger account references — must match what FiatWalletService expects
export const LEDGER_ACCOUNTS = {
  NOMBA_SETTLEMENT: "platform:nomba:settlement",
  userFiatWallet: (userId: string) => `user:fiat_wallet:${userId}`,
};

export const FIAT_RAMP_EVENTS = {
  DEPOSIT_CONFIRMED: "fiat_ramp.deposit.confirmed",
  DEPOSIT_FAILED: "fiat_ramp.deposit.failed",
  WITHDRAWAL_CONFIRMED: "fiat_ramp.withdrawal.confirmed",
  WITHDRAWAL_FAILED: "fiat_ramp.withdrawal.failed",
};
