import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";

import { Public } from "../../../core/decorators";
import {
  Transaction,
  TransactionDocument,
} from "../../transactions/schemas/transaction.schema";
import { FiatWalletService } from "../../wallet/services/fiat-wallet.service";
import { NombaService } from "../../fiat-ramp/services/nomba.service";
import {
  TransactionType,
  TransactionStatus,
  LedgerAccountType,
} from "../../../shared/enums";
import {
  LEDGER_ACCOUNTS,
  FIAT_RAMP_EVENTS,
} from "../../fiat-ramp/constants/fiat-ramp.constants";

/** Fastify request with the rawBody Buffer stored by main.ts content parser. */
type WebhookRequest = FastifyRequest & { rawBody?: Buffer };

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly fiatWalletService: FiatWalletService,
    private readonly nombaService: NombaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  //  NOMBA WEBHOOK — on-ramp inflow notification
  //
  //  Triggered when a user pays NGN into their Nomba virtual account.
  //  Flow:
  //   1. Verify HMAC signature
  //   2. Verify transaction with Nomba API (don't trust webhook payload alone)
  //   3. Identify which user's wallet received the payment
  //   4. Record double-entry ledger (NGN inflow)
  //   5. Emit event (Paycrest swap will be triggered from here or separately)
  // ────────────────────────────────────────────────────────────────────────────

  @Public()
  @Post("nomba")
  @HttpCode(HttpStatus.OK)
  async handleNombaWebhook(
    @Req() req: WebhookRequest,
    @Headers("x-nomba-signature") signature: string,
    @Headers("x-nomba-timestamp") timestamp: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error("Nomba webhook: rawBody missing — check main.ts content parser setup");
      throw new BadRequestException("Raw body unavailable");
    }

    const webhookSecret = this.configService.get<string>("nomba.webhookSecret", "");
    if (!this.verifyNombaSignature(rawBody, signature, timestamp, webhookSecret)) {
      this.logger.warn("Nomba webhook: invalid HMAC — request rejected");
      throw new BadRequestException("Invalid signature");
    }

    const payload = req.body as any;
    const eventType: string = payload?.event || payload?.type || "";
    this.logger.log(`Nomba webhook received: event="${eventType}"`);

    // ⚠️ Verify exact event name(s) in Nomba dashboard / docs
    const isPaymentSuccess =
      eventType === "payment_success" ||
      eventType === "transaction.successful" ||
      payload?.data?.status === "successful" ||
      payload?.status === "successful";

    if (!isPaymentSuccess) {
      this.logger.log(`Nomba webhook: non-payment event "${eventType}" — ignored`);
      return { received: true };
    }

    // ⚠️ Verify exact field names for reference in Nomba docs
    const accountReference: string =
      payload?.data?.accountReference ||
      payload?.accountReference ||
      "";

    const transactionReference: string =
      payload?.data?.transactionId ||
      payload?.data?.reference ||
      payload?.transactionId ||
      "";

    if (!transactionReference) {
      this.logger.warn("Nomba webhook: no transactionReference found in payload");
      return { received: true };
    }

    // Step 1: Find the user's fiat wallet by virtual account reference
    if (!accountReference) {
      this.logger.warn("Nomba webhook: no accountReference found, cannot identify user");
      return { received: true };
    }

    const fiatWallet = await this.fiatWalletService.findByAccountReference(accountReference);
    if (!fiatWallet) {
      this.logger.warn(
        `Nomba webhook: no fiat wallet found for accountReference="${accountReference}"`,
      );
      return { received: true };
    }

    const userId = fiatWallet.userId.toString();

    // Step 2: Independently verify the payment with Nomba (security — don't trust payload alone)
    let verified: Awaited<ReturnType<NombaService["verifyTransaction"]>>;
    try {
      verified = await this.nombaService.verifyTransaction(transactionReference);
    } catch (err: any) {
      this.logger.error(
        `Nomba webhook: verification API call failed for ref="${transactionReference}": ${err.message}`,
      );
      // Return 200 so Nomba doesn't retry — log for manual investigation
      return { received: true };
    }

    if (!verified.isSuccessful) {
      this.logger.warn(
        `Nomba webhook: Nomba reports transaction "${transactionReference}" is not successful`,
      );
      return { received: true };
    }

    // Convert kobo → NGN (Nomba amounts are in kobo)
    const ngnAmount = (verified.amount / 100).toFixed(2);
    this.logger.log(
      `Nomba webhook: ₦${ngnAmount} confirmed for user=${userId}, ref="${transactionReference}"`,
    );

    // Step 3: Record double-entry ledger
    // DEBIT  (+): platform:nomba:settlement  [ASSET — company holds cash]
    // CREDIT (-): user:fiat_wallet:{userId}  [LIABILITY — we owe user the NGN]
    try {
      await this.fiatWalletService.recordLedgerTransaction(
        userId,
        TransactionType.FIAT_DEPOSIT,
        "NGN",
        ngnAmount,
        [
          {
            accountType: LedgerAccountType.ASSET,
            accountRef: LEDGER_ACCOUNTS.NOMBA_SETTLEMENT,
            amount: ngnAmount,                            // positive = DEBIT
          },
          {
            accountType: LedgerAccountType.LIABILITY,
            accountRef: LEDGER_ACCOUNTS.userFiatWallet(userId),
            amount: (-parseFloat(ngnAmount)).toFixed(2), // negative = CREDIT
          },
        ],
        {
          nombaReference: transactionReference,
          accountReference,
        },
      );

      this.eventEmitter.emit(FIAT_RAMP_EVENTS.DEPOSIT_CONFIRMED, {
        userId,
        ngnAmount,
        nombaReference: transactionReference,
      });

      this.logger.log(
        `Nomba webhook: ✅ Ledger updated — ₦${ngnAmount} credited to user=${userId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Nomba webhook: ledger recording failed for user=${userId}: ${err.message}`,
      );
    }

    return { received: true };
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  PAYCREST WEBHOOK — swap settlement & off-ramp events
  //
  //  Handles:
  //  - payment_order.settled   → on-ramp cNGN delivered, debit user NGN balance
  //  - payment_order.validated → off-ramp NGN landed in our Nomba, call Nomba Payout
  //  - payment_order.refunded  → order failed, update tx status
  //  - payment_order.expired   → order expired, update tx status
  // ────────────────────────────────────────────────────────────────────────────

  @Public()
  @Post("paycrest")
  @HttpCode(HttpStatus.OK)
  async handlePaycrestWebhook(
    @Req() req: WebhookRequest,
    @Headers("x-paycrest-signature") signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error("Paycrest webhook: rawBody missing — check main.ts content parser");
      throw new BadRequestException("Raw body unavailable");
    }

    const apiKey = this.configService.get<string>("paycrest.apiKey", "");
    if (!this.verifyPaycrestSignature(rawBody, signature, apiKey)) {
      this.logger.warn("Paycrest webhook: invalid HMAC — request rejected");
      throw new BadRequestException("Invalid signature");
    }

    const payload = req.body as any;
    const event: string = payload?.event || "";
    const data = payload?.data;

    this.logger.log(`Paycrest webhook received: event="${event}", orderId="${data?.id}"`);

    if (!data?.id) {
      this.logger.warn("Paycrest webhook: no order ID in payload");
      return { received: true };
    }

    // Find transaction by Paycrest order ID
    const transaction = await this.transactionModel.findOne({
      paycrestOrderId: data.id,
    });

    if (!transaction) {
      this.logger.warn(`Paycrest webhook: no transaction found for orderId="${data.id}"`);
      return { received: true };
    }

    const transactionId = transaction._id.toString();
    const userId = transaction.userId.toString();

    switch (event) {
      // ── ON-RAMP: cNGN delivered to user's Base wallet ──────────────────────
      // Paycrest swapped our NGN → cNGN and sent it to the user's baseAddress.
      // We now debit the user's NGN fiat balance (it has been converted to cNGN).
      case "payment_order.settled": {
        if (transaction.type === TransactionType.FIAT_DEPOSIT) {
          if (transaction.status === TransactionStatus.SWAP_SETTLED) {
            this.logger.log(`Paycrest webhook: already settled tx=${transactionId} — idempotent`);
            break;
          }

          try {
            await this.transactionModel.findByIdAndUpdate(transactionId, {
              status: TransactionStatus.SWAP_SETTLED,
              confirmedAt: new Date(),
            });

            // Ledger: user's NGN fiat balance decreases (it became cNGN on-chain)
            // DEBIT  (+): user:fiat_wallet:{userId}  [LIABILITY decreases — we no longer owe fiat]
            // CREDIT (-): platform:nomba:settlement  [ASSET decreases — cash sent to Paycrest]
            const ngnAmount = transaction.fiatAmount || "0";
            await this.fiatWalletService.recordLedgerTransaction(
              userId,
              TransactionType.FIAT_DEPOSIT,
              "NGN",
              ngnAmount,
              [
                {
                  accountType: LedgerAccountType.LIABILITY,
                  accountRef: LEDGER_ACCOUNTS.userFiatWallet(userId),
                  amount: ngnAmount,                            // positive = DEBIT (liability ↓)
                },
                {
                  accountType: LedgerAccountType.ASSET,
                  accountRef: LEDGER_ACCOUNTS.NOMBA_SETTLEMENT,
                  amount: (-parseFloat(ngnAmount)).toFixed(2), // negative = CREDIT (asset ↓)
                },
              ],
              { paycrestOrderId: data.id, swapSettledAt: new Date().toISOString() },
            );

            this.eventEmitter.emit(FIAT_RAMP_EVENTS.DEPOSIT_SETTLED, {
              transactionId,
              userId,
            });

            this.logger.log(
              `Paycrest webhook: ✅ On-ramp settled — cNGN delivered to user=${userId}, tx=${transactionId}`,
            );
          } catch (err: any) {
            this.logger.error(
              `Paycrest webhook: on-ramp ledger update failed tx=${transactionId}: ${err.message}`,
            );
          }
        }
        break;
      }

      // ── OFF-RAMP: Paycrest validated — NGN in our Nomba account ────────────
      // Paycrest received the user's cNGN and placed NGN in our corporate Nomba account.
      // We now call Nomba Payout to forward NGN to the user's personal bank.
      case "payment_order.validated": {
        if (transaction.type === TransactionType.FIAT_WITHDRAWAL) {
          if (transaction.status === TransactionStatus.PAYOUT_PENDING ||
              transaction.status === TransactionStatus.COMPLETED) {
            this.logger.log(`Paycrest webhook: payout already in progress tx=${transactionId} — idempotent`);
            break;
          }

          await this.transactionModel.findByIdAndUpdate(transactionId, {
            status: TransactionStatus.PAYOUT_PENDING,
          });

          const meta = transaction.metadata as any;

          try {
            // Call Nomba Payout to send NGN to user's personal bank account
            const payout = await this.nombaService.sendPayout({
              amount: parseFloat(transaction.fiatAmount || "0"),
              destinationBank: meta?.institutionCode || "",
              destinationAccount: meta?.accountNumber || "",
              destinationAccountName: meta?.accountName || "",
              narration: `Etibé withdrawal ${transactionId}`,
              reference: transactionId,
            });

            // Ledger: user's fiat liability clears, platform asset reduces
            // DEBIT  (+): user:fiat_wallet:{userId}  [LIABILITY decreases]
            // CREDIT (-): platform:nomba:settlement  [ASSET decreases — cash paid out]
            const ngnAmount = transaction.fiatAmount || "0";
            await this.fiatWalletService.recordLedgerTransaction(
              userId,
              TransactionType.FIAT_WITHDRAWAL,
              "NGN",
              ngnAmount,
              [
                {
                  accountType: LedgerAccountType.LIABILITY,
                  accountRef: LEDGER_ACCOUNTS.userFiatWallet(userId),
                  amount: ngnAmount,                            // positive = DEBIT (liability ↓)
                },
                {
                  accountType: LedgerAccountType.ASSET,
                  accountRef: LEDGER_ACCOUNTS.NOMBA_SETTLEMENT,
                  amount: (-parseFloat(ngnAmount)).toFixed(2), // negative = CREDIT (asset ↓)
                },
              ],
              {
                paycrestOrderId: data.id,
                npayboutReference: payout.reference,
                payoutStatus: payout.status,
              },
            );

            await this.transactionModel.findByIdAndUpdate(transactionId, {
              status: TransactionStatus.COMPLETED,
              confirmedAt: new Date(),
            });

            this.eventEmitter.emit(FIAT_RAMP_EVENTS.WITHDRAWAL_CONFIRMED, {
              transactionId,
              userId,
            });

            this.logger.log(
              `Paycrest webhook: ✅ Off-ramp complete — ₦${ngnAmount} sent to user's bank, tx=${transactionId}`,
            );
          } catch (err: any) {
            this.logger.error(
              `Paycrest webhook: off-ramp payout failed tx=${transactionId}: ${err.message}`,
            );
            await this.transactionModel.findByIdAndUpdate(transactionId, {
              status: TransactionStatus.FAILED,
              failureReason: `Nomba payout failed: ${err.message}`,
            });
            this.eventEmitter.emit(FIAT_RAMP_EVENTS.WITHDRAWAL_FAILED, {
              transactionId,
              userId,
              error: err.message,
            });
          }
        }
        break;
      }

      // ── REFUNDED / EXPIRED ─────────────────────────────────────────────────
      case "payment_order.refunded":
      case "payment_order.expired": {
        if (
          transaction.status !== TransactionStatus.REVERSED &&
          transaction.status !== TransactionStatus.EXPIRED
        ) {
          const newStatus =
            event === "payment_order.expired"
              ? TransactionStatus.EXPIRED
              : TransactionStatus.REVERSED;

          await this.transactionModel.findByIdAndUpdate(transactionId, {
            status: newStatus,
            failureReason: `Paycrest order ${event.replace("payment_order.", "")}`,
          });

          this.eventEmitter.emit(FIAT_RAMP_EVENTS.WITHDRAWAL_FAILED, {
            transactionId,
            userId,
            event,
          });

          this.logger.warn(
            `Paycrest webhook: tx=${transactionId} marked ${newStatus} (event: ${event})`,
          );
        }
        break;
      }

      default:
        this.logger.log(`Paycrest webhook: unhandled event="${event}" — ignored`);
    }

    return { received: true };
  }

  // ── SIGNATURE VERIFICATION ─────────────────────────────────────────────────

  /**
   * Verify Nomba webhook HMAC-SHA256 signature.
   * Common pattern: HMAC("timestamp.rawBody", webhookSecret)
   * ⚠️ Verify exact format against Nomba docs / dashboard.
   */
  private verifyNombaSignature(
    rawBody: Buffer,
    signature: string,
    timestamp: string,
    secret: string,
  ): boolean {
    if (!signature || !secret) return false;
    try {
      const requestPayload = JSON.parse(rawBody.toString("utf8"));
      const data = requestPayload.data || {};
      const merchant = data.merchant || {};
      const transaction = data.transaction || {};

      const eventType = requestPayload.event_type || "";
      const requestId = requestPayload.requestId || "";
      const userId = merchant.userId || "";
      const walletId = merchant.walletId || "";
      const transactionId = transaction.transactionId || "";
      const transactionType = transaction.type || "";
      const transactionTime = transaction.time || "";
      let transactionResponseCode = transaction.responseCode || "";
      if (transactionResponseCode === "null") {
        transactionResponseCode = "";
      }

      const hashingPayload = `${eventType}:${requestId}:${userId}:${walletId}:${transactionId}:${transactionType}:${transactionTime}:${transactionResponseCode}:${timestamp}`;

      const computed = createHmac("sha256", secret)
        .update(hashingPayload)
        .digest("base64");
        
      return computed === signature;
    } catch (ex: any) {
      this.logger.error(`Error verifying Nomba signature: ${ex.message}`);
      return false;
    }
  }

  /**
   * Verify Paycrest webhook HMAC-SHA256 signature.
   * Header: X-Paycrest-Signature
   * Key: PAYCREST_API_KEY (sender API key)
   */
  private verifyPaycrestSignature(
    rawBody: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !secret) return false;
    try {
      const computed = createHmac("sha256", secret.trim())
        .update(rawBody)
        .digest("hex")
        .toLowerCase();
      const sig = signature.toLowerCase().trim();
      if (computed.length !== sig.length) return false;
      return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(sig, "utf8"));
    } catch {
      return false;
    }
  }
}
