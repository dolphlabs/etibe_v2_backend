# Handover Documentation: Fiat Wallet & Double-Entry Ledger System

This document provides a detailed description of what has been implemented for the **Fiat Wallet** and **Double-Entry Ledger** system, what remains to be built, and the environment configuration required for the integration.

---

## 🛠️ What has been Implemented

### 1. Database Schema Design

- **[ledger-posting.schema.ts](https://github.com/dolphlabs/etibe_v2_backend/src/modules/transactions/schemas/ledger-posting.schema.ts):** Represents single debit/credit postings utilizing `Decimal128` to maintain financial precision:
  - `accountType`: `ASSET`, `LIABILITY`, `REVENUE`, or `EXPENSE`.
  - `accountRef`: Specific account identifier (e.g., `user:fiat_wallet:userId` or `platform:nomba:settlement`).
  - `amount`: Positive for debits (inflow/increase), negative for credits (outflow/decrease).
  - `direction`: `DEBIT` or `CREDIT`.
- **[transaction.schema.ts](https://github.com/dolphlabs/etibe_v2_backend/src/modules/transactions/schemas/transaction.schema.ts) (Modified):** Integrated an array of `postings` directly inside the transaction document. Storing all postings in a single document guarantees atomic updates—preventing unbalanced ledgers without requiring multi-document MongoDB transactions.
- **[fiat-wallet.schema.ts](https://github.com/dolphlabs/etibe_v2_backend/src/modules/wallet/schemas/fiat-wallet.schema.ts):** Represents fiat balances and banking credentials (e.g., Nomba virtual accounts mapping: Wema Bank, Providus Bank, etc.).

### 2. Service Layer & Logic (`FiatWalletService`)

- **[fiat-wallet.service.ts](https://github.com/dolphlabs/etibe_v2_backend/src/modules/wallet/services/fiat-wallet.service.ts):**
  - `getOrCreateFiatWallet(userId)`: Dynamically checks for existing wallets. If missing, it creates a new wallet pre-mapped with sandbox Nomba virtual account placeholders.
  - `getFiatBalance(userId)`: Returns the cached balance.
  - `recordLedgerTransaction(...)`: Runs Mongoose transaction sessions to write ledger postings and simultaneously increment/decrement user fiat wallet balances. It checks that `debits + credits === 0.00` using integer math (cents conversion) to avoid floating-point rounding errors.

### 3. Unit Tests

- **[fiat-wallet.service.spec.ts](https://github.com/dolphlabs/etibe_v2_backend/src/modules/wallet/services/fiat-wallet.service.spec.ts):** Written 5 core tests verifying wallet checks, double-entry validation logic, and cash balance caching updates.

---

## 🏗️ What is Left to Implement (Developer Handover Tasks)

### 1. Nomba Webhook Integration (On-Ramp Inflow)

- **Endpoint**: Create `POST /fiat/nomba/webhook` (or similar endpoint) to receive `payment_success` notifications.
- **Webhook Security**: Verify the HMAC SHA256 header signature sent by Nomba using the `NOMBA_WEBHOOK_SECRET` key.
- **Verification**: Query Nomba's transaction status endpoint (`/v1/transactions/accounts/single`) to confirm payment validity before allocating funds.
- **Ledger Posting**: On success, call `FiatWalletService.recordLedgerTransaction` to log:
  - **Debit (+)**: `platform:nomba:settlement` (Asset account increases - company holds the funds)
  - **Credit (-)**: `user:fiat_wallet:userId` (Liability account increases - we owe the user NGN)

### 2. Paycrest Swap Execution (On-Ramp to cNGN)

- **Rate Check**: Query Paycrest rates `GET /v2/rates/...` to fetch current quote.
- **Swap Order**: Initiate order creation via Paycrest `POST /v2/sender/orders` mapping user's `baseAddress` as receiver.
- **Payment Settlement**: Call **Nomba Payout API** to payout NGN from the company's settlement balance to Paycrest's target bank account, including the order identifier in the bank narration.
- **Ledger Entry**: Once the swap completes and cNGN is distributed to the user's EVM wallet:
  - **Debit (+)**: `user:fiat_wallet:userId` (Liability decreases - we no longer owe user fiat)
  - **Credit (-)**: `platform:nomba:settlement` (Asset decreases - cash sent to Paycrest)

### 3. Fiat Withdrawal (Off-Ramp)

- **Crypto off-ramp**: Initiate Paycrest order to swap cNGN to NGN. The user sends cNGN to the smart contract, and Paycrest transfers NGN into our corporate bank account or Nomba pool.
- **Fiat distribution**: Call **Nomba Payout API** to send NGN from the pooled balance directly to the user's personal bank account.
- **Ledger Posting**: Record the payout as:
  - **Debit (+)**: `user:fiat_wallet:userId` (Liability decreases)
  - **Credit (-)**: `platform:nomba:settlement` (Asset decreases)

---

## ⚙️ Environment Variables (Env Keys)

Add the following keys to your `.env` or `.env.local` configuration:

```env
# Nomba API configuration
NOMBA_API_URL=https://sandboxapi.nomba.com
NOMBA_CLIENT_ID=your-nomba-client-id
NOMBA_CLIENT_SECRET=your-nomba-client-secret
NOMBA_ACCOUNT_ID=your-nomba-corporate-account-id
NOMBA_WEBHOOK_SECRET=your-webhook-verification-signing-key

# Paycrest API configuration
PAYCREST_API_URL=https://api.paycrest.io/v2
PAYCREST_API_KEY=your-paycrest-sender-api-key
PAYCREST_PARTNER_ID=your-paycrest-partner-id
```
