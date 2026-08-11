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
    this.apiUrl = this.configService.get<string>(
      "nomba.apiUrl",
      "https://sandbox.nomba.com",
    );
    this.clientId = this.configService.get<string>("nomba.clientId", "");
    this.clientSecret = this.configService.get<string>(
      "nomba.clientSecret",
      "",
    );
    this.accountId = this.configService.get<string>("nomba.accountId", "");
  }

  /**
   * Fetch and cache an OAuth2 access token.
   * ⚠️ Verify endpoint path against developer.nomba.com
   */
  async getAccessToken(): Promise<string> {
    const cached = await this.cacheManager.get<string>(NOMBA_TOKEN_CACHE_KEY);
    if (cached) return cached;

    const response = await fetch(`${this.apiUrl}/v1/auth/token/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accountId: this.accountId, // required header per Nomba API
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        `Nomba auth failed (${response.status}): ${err.description || err.message || response.statusText}`,
      );
    }

    const json = await response.json();
    // Nomba wraps the token: { code, description, data: { access_token, expiresAt } }
    const token: string | undefined = json.data?.access_token;
    if (!token) {
      throw new Error(
        `Nomba auth response missing access_token (code: ${json.code}, description: ${json.description})`,
      );
    }

    // expiresAt is an ISO timestamp; cache with a 60s safety buffer
    const expiresAtMs = json.data?.expiresAt ? Date.parse(json.data.expiresAt) : NaN;
    const ttlMs = Number.isFinite(expiresAtMs)
      ? Math.max(expiresAtMs - Date.now() - 60_000, 60_000)
      : 20 * 60_000; // fallback: 20 minutes

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
   * Create a real virtual account for a user.
   * POST /v1/accounts/virtual (per developer.nomba.com)
   */
  async createVirtualAccount(params: {
    accountRef: string; // 16-64 chars, unique per wallet
    accountName: string; // 8-64 chars
    bvn?: string;
    expiryDate?: string; // "YYYY-MM-DD HH:MM:SS"
  }): Promise<{
    accountReference: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  }> {
    const headers = await this.authedHeaders();

    const response = await fetch(`${this.apiUrl}/v1/accounts/virtual`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountRef: params.accountRef,
        accountName: params.accountName,
        ...(params.bvn ? { bvn: params.bvn } : {}),
        ...(params.expiryDate ? { expiryDate: params.expiryDate } : {}),
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      this.logger.error(
        `Nomba virtual account creation failed (${response.status}): ${JSON.stringify(err)}`,
      );
      throw new Error(
        `Nomba virtual account creation failed: ${err.description || err.message || response.statusText}`,
      );
    }

    const json = await response.json();
    const data = json.data;

    if (!data?.bankAccountNumber) {
      throw new Error(
        "Nomba virtual account response missing bankAccountNumber",
      );
    }

    this.logger.log(
      `Nomba virtual account created: ${data.bankName} ${data.bankAccountNumber} (ref: ${data.accountRef})`,
    );

    return {
      accountReference: data.accountRef,
      bankName: data.bankName,
      accountNumber: data.bankAccountNumber,
      accountName: data.bankAccountName || params.accountName,
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
      `${this.apiUrl}/v1/transactions/accounts/single?transactionId=${transactionReference}`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(
        `Nomba transaction verification failed: ${response.status}`,
      );
    }

    const json = await response.json();
    const data = json.data;

    return {
      isSuccessful:
        data?.status === "successful" || data?.status === "SUCCESSFUL",
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
    amount: number; // NGN amount (NOT kobo for payouts — verify in docs)
    destinationBank: string; // Bank code or sort code
    destinationAccount: string;
    destinationAccountName: string;
    narration: string;
    reference: string; // your internal transaction ID (idempotency)
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

    this.logger.log(
      `Nomba payout: ₦${params.amount} to ${params.destinationAccount}, ref:${params.reference}`,
    );

    const response = await fetch(`${this.apiUrl}/v1/accounts/transfer`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        `Nomba payout failed: ${err.message || response.statusText}`,
      );
    }

    const json = await response.json();
    return {
      reference: json.data?.reference || params.reference,
      status: json.data?.status,
    };
  }
}
