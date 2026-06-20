# 🏦 Fiat On/Off Ramp — Implementation Guide (Updated)
# Part 1 of 2

> Based on the lead engineer's handover doc (`fiat_wallet_handover.md`) and codebase map.
>
> **Key difference from original guide**: The lead engineer already built the
> `FiatWalletService`, `FiatWallet` schema, `LedgerPosting` schema, and double-entry
> ledger system. Your job is to wire the Nomba + Paycrest integrations ON TOP of that.
>
> ➡️ Continue in `FIAT_RAMP_GUIDE_PART2.md`

---

## ✅ What Is Already Built (Do NOT rebuild these)

| File | What it does |
|---|---|
| `wallet/schemas/fiat-wallet.schema.ts` | `FiatWallet` document with NGN balance + Nomba virtual account |
| `transactions/schemas/ledger-posting.schema.ts` | Single debit/credit posting (double-entry accounting) |
| `transactions/schemas/transaction.schema.ts` | Modified — already has `postings[]` embedded |
| `wallet/services/fiat-wallet.service.ts` | `getOrCreateFiatWallet()`, `getFiatBalance()`, `recordLedgerTransaction()` |
| `shared/enums/ledger.enums.ts` | `LedgerAccountType` (ASSET/LIABILITY/REVENUE/EXPENSE) + `PostingDirection` |
| `wallet/wallet.module.ts` | Already imports `FiatWallet` schema + exports `FiatWalletService` |

**The ledger system is your foundation. Every fiat money movement must go through
`FiatWalletService.recordLedgerTransaction()`.**

---

## 📐 Architecture Overview

### How the Money Flows

```
ON-RAMP (NGN → cNGN on Base)
──────────────────────────────
1. User pays NGN to their Nomba virtual account
   (account number already in fiat-wallet.schema.ts)
2. Nomba fires webhook → POST /fiat/nomba/webhook
3. Backend verifies HMAC signature
4. Backend queries Nomba to confirm payment is real
5. recordLedgerTransaction():
   - DEBIT  (+) platform:nomba:settlement   [ASSET]
   - CREDIT (-) user:fiat_wallet:{userId}   [LIABILITY]
   → user's NGN balance increases in FiatWallet
6. Backend calls Paycrest POST /v2/sender/orders
   (swap NGN → cNGN, send cNGN to user's baseAddress)
7. Backend calls Nomba Payout API to send NGN to Paycrest's bank account
   (with order ID in narration)
8. When cNGN lands in user's EVM wallet → recordLedgerTransaction():
   - DEBIT  (+) user:fiat_wallet:{userId}   [LIABILITY decreases]
   - CREDIT (-) platform:nomba:settlement   [ASSET decreases]
   → user's NGN balance decreases (it became cNGN)

OFF-RAMP (cNGN → NGN)
──────────────────────────────
1. User sends cNGN to Paycrest's smart contract
2. Paycrest fires webhook → NGN lands in our Nomba account
3. Backend calls Nomba Payout API → NGN sent to user's bank
4. recordLedgerTransaction():
   - DEBIT  (+) user:fiat_wallet:{userId}   [LIABILITY decreases]
   - CREDIT (-) platform:nomba:settlement   [ASSET decreases]
```

---

## Phase 1 — Environment & Config

### Step 1.1 — Add to `.env`

```env
# Nomba (note: lead engineer uses NOMBA_API_URL not NOMBA_BASE_URL)
NOMBA_API_URL=https://sandboxapi.nomba.com
NOMBA_CLIENT_ID=your-nomba-client-id
NOMBA_CLIENT_SECRET=your-nomba-client-secret
NOMBA_ACCOUNT_ID=your-nomba-corporate-account-id
NOMBA_WEBHOOK_SECRET=your-webhook-verification-signing-key

# Paycrest (note: lead engineer uses PAYCREST_API_URL + PAYCREST_PARTNER_ID)
PAYCREST_API_URL=https://api.paycrest.io/v2
PAYCREST_API_KEY=your-paycrest-sender-api-key
PAYCREST_PARTNER_ID=your-paycrest-partner-id
```

### Step 1.2 — Add to `src/config/app.config.ts`

```typescript
export const nombaConfig = registerAs("nomba", () => ({
  apiUrl: process.env.NOMBA_API_URL || "https://sandboxapi.nomba.com",
  clientId: process.env.NOMBA_CLIENT_ID,
  clientSecret: process.env.NOMBA_CLIENT_SECRET,
  accountId: process.env.NOMBA_ACCOUNT_ID,
  webhookSecret: process.env.NOMBA_WEBHOOK_SECRET,
}));

export const paycrestConfig = registerAs("paycrest", () => ({
  apiUrl: process.env.PAYCREST_API_URL || "https://api.paycrest.io/v2",
  apiKey: process.env.PAYCREST_API_KEY,
  partnerId: process.env.PAYCREST_PARTNER_ID,
}));
```

### Step 1.3 — Add to `src/config/env.validation.ts` (inside `EnvironmentVariables` class)

```typescript
@IsOptional() @IsString() NOMBA_API_URL?: string;
@IsOptional() @IsString() NOMBA_CLIENT_ID?: string;
@IsOptional() @IsString() NOMBA_CLIENT_SECRET?: string;
@IsOptional() @IsString() NOMBA_ACCOUNT_ID?: string;
@IsOptional() @IsString() NOMBA_WEBHOOK_SECRET?: string;

@IsOptional() @IsString() PAYCREST_API_URL?: string;
@IsOptional() @IsString() PAYCREST_API_KEY?: string;
@IsOptional() @IsString() PAYCREST_PARTNER_ID?: string;
```

### Step 1.4 — Register configs in `src/app.module.ts`

In `ConfigModule.forRoot({ load: [...] })`, add:
```typescript
nombaConfig,
paycrestConfig,
```

Also add to feature module imports (you'll create these):
```typescript
import { FiatRampModule } from "./modules/fiat-ramp";
import { WebhooksModule } from "./modules/webhooks";

// inside imports array:
FiatRampModule,
WebhooksModule,
```

---

## Phase 2 — Schema Updates

### Step 2.1 — Update `src/shared/enums/circle.enums.ts`

**Add to `TransactionType`:**
```typescript
FIAT_DEPOSIT = "FIAT_DEPOSIT",       // NGN on-ramp (Nomba → Paycrest swap)
FIAT_WITHDRAWAL = "FIAT_WITHDRAWAL", // cNGN off-ramp (Paycrest → Nomba payout)
NOMBA_PAYOUT = "NOMBA_PAYOUT",       // Nomba → user's personal bank account
```

**Add to `TransactionStatus`:**
```typescript
SWAP_PENDING = "SWAP_PENDING",   // Paycrest order created, waiting for cNGN delivery
SWAP_SETTLED = "SWAP_SETTLED",   // cNGN delivered to user's wallet
PAYOUT_PENDING = "PAYOUT_PENDING", // Nomba payout initiated
EXPIRED = "EXPIRED",             // order expired before completion
```

### Step 2.2 — Update `src/modules/transactions/schemas/transaction.schema.ts`

The `postings[]` array is already there. You only need to add fiat-specific tracking fields.

Add these fields inside the `Transaction` class (after `failureReason`):

```typescript
@Prop({ trim: true, index: true })
nombaReference?: string; // Nomba payment/transaction reference

@Prop({ trim: true, index: true })
paycrestOrderId?: string; // Paycrest order UUID

@Prop({ trim: true })
paycrestReceiveAddress?: string; // gateway contract address (offramp)

@Prop({ type: Number })
exchangeRate?: number; // locked NGN/cNGN rate at time of order

@Prop({ trim: true })
fiatAmount?: string; // NGN amount (separate from crypto `amount`)

@Prop({ default: "NGN", trim: true })
fiatCurrency?: string;
```

Add those same fields to the `TransactionDocument` interface.

### Step 2.3 — Update `src/modules/users/schemas/user.schema.ts`

Add a saved bank accounts sub-schema for off-ramp payouts.

Add this **above** the `User` class:

```typescript
@Schema({ _id: false })
export class BankDetail {
  @Prop({ required: true, trim: true })
  institutionCode!: string; // Paycrest institution code e.g. "GTBINGLA"

  @Prop({ required: true, trim: true })
  bankName!: string;

  @Prop({ required: true, trim: true })
  accountNumber!: string;

  @Prop({ required: true, trim: true })
  accountName!: string; // resolved from Paycrest verify-account

  @Prop({ default: false })
  isVerified!: boolean;
}

const BankDetailSchema = SchemaFactory.createForClass(BankDetail);
```

Add inside the `User` class:
```typescript
@Prop({ type: [BankDetailSchema], default: [] })
bankDetails?: BankDetail[];
```

Add to the `UserDocument` interface:
```typescript
bankDetails?: BankDetail[];
```

---

## Phase 3 — Create the FiatRamp Module Structure

```
src/modules/fiat-ramp/
  fiat-ramp.module.ts
  index.ts
  constants/
    fiat-ramp.constants.ts
  controllers/
    fiat-ramp.controller.ts
  dto/
    bank-account.dto.ts
    fiat-ramp.dto.ts
  services/
    nomba.service.ts
    paycrest.service.ts
    fiat-ramp.service.ts
    index.ts
```

### Step 3.1 — `src/modules/fiat-ramp/constants/fiat-ramp.constants.ts`

```typescript
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
```

### Step 3.2 — `src/modules/fiat-ramp/dto/bank-account.dto.ts`

```typescript
import { IsString, IsNotEmpty, Matches } from "class-validator";

export class AddBankAccountDto {
  @IsString() @IsNotEmpty()
  institutionCode!: string; // Paycrest institution code e.g. "GTBINGLA"

  @IsString() @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: "Must be exactly 10 digits" })
  accountNumber!: string;
}
```

### Step 3.3 — `src/modules/fiat-ramp/dto/fiat-ramp.dto.ts`

```typescript
import { IsNumber, IsPositive, IsString, IsNotEmpty } from "class-validator";

export class GetRateDto {
  @IsNumber() @IsPositive()
  amount!: number; // NGN amount for on-ramp quote
}

export class InitiateWithdrawalDto {
  @IsNumber() @IsPositive()
  cNgnAmount!: number; // amount of cNGN to swap to NGN

  @IsString() @IsNotEmpty()
  institutionCode!: string;

  @IsString() @IsNotEmpty()
  accountNumber!: string;

  @IsString() @IsNotEmpty()
  accountName!: string;

  @IsString() @IsNotEmpty()
  otp!: string;
}
```

---

### Step 3.4 — `src/modules/fiat-ramp/services/nomba.service.ts`

> Nomba uses **OAuth2 Client Credentials**. Token must be fetched and cached.

```typescript
import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { NOMBA_TOKEN_CACHE_KEY } from "../constants/fiat-ramp.constants";

@Injectable()
export class NombaService {
  private readonly logger = new Logger(NombaService.name);
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accountId: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.apiUrl = this.configService.get<string>("nomba.apiUrl", "https://sandboxapi.nomba.com");
    this.clientId = this.configService.get<string>("nomba.clientId", "");
    this.clientSecret = this.configService.get<string>("nomba.clientSecret", "");
    this.accountId = this.configService.get<string>("nomba.accountId", "");
  }

  /**
   * Fetch and cache an OAuth2 access token.
   * ⚠️ Verify endpoint path against developer.nomba.com
   */
  async getAccessToken(): Promise<string> {
    const cached = await this.cacheManager.get<string>(NOMBA_TOKEN_CACHE_KEY);
    if (cached) return cached;

    const response = await fetch(`${this.apiUrl}/auth/token/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Nomba auth failed: ${err.message || response.statusText}`);
    }

    const json = await response.json();
    const token = json.access_token;
    const ttlMs = (json.expires_in - 60) * 1000; // 60s safety buffer
    await this.cacheManager.set(NOMBA_TOKEN_CACHE_KEY, token, ttlMs);
    this.logger.log("Nomba token refreshed");
    return token;
  }

  private async authedHeaders() {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accountId: this.accountId,
    };
  }

  /**
   * Verify a transaction is valid by querying Nomba.
   * Called from webhook handler before crediting the user.
   * GET /v1/transactions/accounts/single?transactionId=...
   * ⚠️ Verify exact path in Nomba docs.
   */
  async verifyTransaction(transactionReference: string): Promise<{
    isSuccessful: boolean;
    amount: number; // NGN amount in kobo
    narration?: string;
    accountReference?: string; // virtual account reference
  }> {
    const headers = await this.authedHeaders();
    const response = await fetch(
      `${this.apiUrl}/transactions/accounts/single?transactionId=${transactionReference}`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(`Nomba transaction verification failed: ${response.status}`);
    }

    const json = await response.json();
    const data = json.data;

    return {
      isSuccessful: data?.status === "successful" || data?.status === "SUCCESSFUL",
      amount: data?.amount,
      narration: data?.narration,
      accountReference: data?.accountReference,
    };
  }

  /**
   * Send a payout from the company Nomba account to a target bank account.
   * Used in:
   * - On-ramp: pay NGN to Paycrest's bank (to trigger cNGN swap)
   * - Off-ramp: pay NGN to user's personal bank account
   *
   * ⚠️ Verify exact endpoint and payload format in Nomba docs.
   * Common path: POST /v1/accounts/transfer
   */
  async sendPayout(params: {
    amount: number;         // NGN amount (NOT kobo for payouts — verify in docs)
    destinationBank: string; // Bank code or sort code
    destinationAccount: string;
    destinationAccountName: string;
    narration: string;
    reference: string;      // your internal transaction ID (idempotency)
  }): Promise<{ reference: string; status: string }> {
    const headers = await this.authedHeaders();

    const payload = {
      amount: params.amount,
      destinationBank: params.destinationBank,
      destinationAccount: params.destinationAccount,
      destinationAccountName: params.destinationAccountName,
      narration: params.narration,
      reference: params.reference,
    };

    this.logger.log(`Nomba payout: ₦${params.amount} to ${params.destinationAccount}, ref:${params.reference}`);

    const response = await fetch(`${this.apiUrl}/accounts/transfer`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Nomba payout failed: ${err.message || response.statusText}`);
    }

    const json = await response.json();
    return {
      reference: json.data?.reference || params.reference,
      status: json.data?.status,
    };
  }
}
```

---

### Step 3.5 — `src/modules/fiat-ramp/services/paycrest.service.ts`

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface PaycrestOrderResponse {
  id: string;
  status: string;
  providerAccount: {
    // On-ramp (fiat→crypto): virtual bank account to pay into
    institution?: string;
    accountIdentifier?: string;
    accountName?: string;
    amountToTransfer?: string;
    // Off-ramp (crypto→fiat): smart contract to send tokens to
    receiveAddress?: string;
    validUntil?: string;
  };
  amount: string;
  rate?: string;
}

@Injectable()
export class PaycrestService {
  private readonly logger = new Logger(PaycrestService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly partnerId: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>("paycrest.apiUrl", "https://api.paycrest.io/v2");
    this.apiKey = this.configService.get<string>("paycrest.apiKey", "");
    this.partnerId = this.configService.get<string>("paycrest.partnerId", "");
  }

  private get headers() {
    return {
      "API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  /**
   * Get current NGN/cNGN exchange rate.
   * GET /v2/rates/{network}/{from}/{amount}/{to}
   */
  async getRate(network = "base", from = "cNGN", amount = "1", to = "NGN"): Promise<number> {
    const url = `${this.apiUrl}/rates/${network}/${from}/${amount}/${to}`;
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) throw new Error(`Paycrest rate error: ${response.status}`);
    const json = await response.json();
    const rate = parseFloat(json.data?.sell?.rate || json.data?.rate);
    if (!rate || isNaN(rate)) throw new Error("Invalid rate from Paycrest");
    return rate;
  }

  /**
   * Create a swap order.
   * POST /v2/sender/orders
   *
   * ON-RAMP (NGN → cNGN):
   *   source: { type: "fiat", currency: "NGN" }
   *   destination: { type: "crypto", currency: "cNGN", recipient: { address: userBaseAddress, network: "base" } }
   *   → response.providerAccount has Paycrest's bank account (pay NGN here via Nomba)
   *
   * OFF-RAMP (cNGN → NGN):
   *   source: { type: "crypto", currency: "cNGN", network: "base" }
   *   destination: { type: "fiat", currency: "NGN", recipient: { institution, accountIdentifier, accountName } }
   *   → response.providerAccount.receiveAddress = smart contract to send cNGN to
   */
  async createOrder(dto: {
    amount: string;
    source: any;
    destination: any;
    reference: string; // your transaction ID (idempotency key)
  }): Promise<PaycrestOrderResponse> {
    this.logger.log(`Creating Paycrest order ref:${dto.reference}, amount:${dto.amount}`);

    const response = await fetch(`${this.apiUrl}/sender/orders`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(dto),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Paycrest order failed: ${err.message || response.statusText}`);
    }

    const json = await response.json();
    this.logger.log(`Paycrest order created: ${json.data?.id}`);
    return json.data as PaycrestOrderResponse;
  }

  async getOrder(orderId: string): Promise<PaycrestOrderResponse> {
    const r = await fetch(`${this.apiUrl}/sender/orders/${orderId}`, { headers: this.headers });
    if (!r.ok) throw new Error(`Failed to get order ${orderId}`);
    return (await r.json()).data as PaycrestOrderResponse;
  }

  /**
   * Verify a Nigerian bank account before saving it.
   * POST /v2/verify-account
   */
  async verifyAccount(institution: string, accountIdentifier: string) {
    const r = await fetch(`${this.apiUrl}/verify-account`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ institution, accountIdentifier }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`Account verification failed: ${err.message || r.statusText}`);
    }
    const json = await r.json();
    const accountName = typeof json.data === "string" ? json.data : json.data?.accountName;
    return { accountName, accountIdentifier };
  }

  async getSupportedInstitutions(currency = "NGN"): Promise<any[]> {
    const r = await fetch(`${this.apiUrl}/institutions/${currency}`, { headers: this.headers });
    if (!r.ok) throw new Error("Failed to fetch banks");
    return (await r.json()).data || [];
  }
}
```

---

> ➡️ Continue in `FIAT_RAMP_GUIDE_PART2.md` for FiatRampService, Controller, Webhooks, and checklist.
