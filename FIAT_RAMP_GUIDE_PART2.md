# 🏦 Fiat On/Off Ramp — Implementation Guide (Updated)
# Part 2 of 2

> ⬅️ Start from `FIAT_RAMP_IMPLEMENTATION_GUIDE.md` (Part 1)

---

## Phase 4 — FiatRampService (Core Logic)

### Step 4.1 — `src/modules/fiat-ramp/services/fiat-ramp.service.ts`

```typescript
import {
  Injectable, Logger, BadRequestException,
  NotFoundException, Inject,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";

import { User, UserDocument } from "../../users/schemas/user.schema";
import { Transaction, TransactionDocument } from "../../transactions/schemas/transaction.schema";
import { FiatWalletService } from "../../wallet/services/fiat-wallet.service";
import { NombaService } from "./nomba.service";
import { PaycrestService } from "./paycrest.service";
import { VaultService } from "../../blockchain/services/vault.service";
import { AddBankAccountDto } from "../dto/bank-account.dto";
import { InitiateWithdrawalDto } from "../dto/fiat-ramp.dto";
import {
  TransactionType, TransactionStatus, Currency, LedgerAccountType, PostingDirection,
} from "../../../shared/enums";
import {
  LEDGER_ACCOUNTS, FIAT_RAMP_EVENTS,
  MIN_DEPOSIT_NGN, MAX_DEPOSIT_NGN, MIN_WITHDRAWAL_CNGN,
} from "../constants/fiat-ramp.constants";

const WITHDRAWAL_OTP_PREFIX = "fiat_ramp_withdrawal_otp:";
const WITHDRAWAL_OTP_TTL_MS = 300_000; // 5 minutes

@Injectable()
export class FiatRampService {
  private readonly logger = new Logger(FiatRampService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly fiatWalletService: FiatWalletService,
    private readonly nombaService: NombaService,
    private readonly paycrestService: PaycrestService,
    private readonly vaultService: VaultService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ── BANK ACCOUNTS ──────────────────────────────────────────────

  async addBankAccount(userId: string, dto: AddBankAccountDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const exists = user.bankDetails?.some(
      (b) => b.accountNumber === dto.accountNumber && b.institutionCode === dto.institutionCode,
    );
    if (exists) throw new BadRequestException("This bank account is already saved");

    const verified = await this.paycrestService.verifyAccount(dto.institutionCode, dto.accountNumber);
    const institutions = await this.paycrestService.getSupportedInstitutions("NGN");
    const inst = institutions.find((i: any) => i.code === dto.institutionCode);
    const bankName = inst?.name || dto.institutionCode;

    user.bankDetails = user.bankDetails || [];
    user.bankDetails.push({
      institutionCode: dto.institutionCode,
      bankName,
      accountNumber: dto.accountNumber,
      accountName: verified.accountName,
      isVerified: true,
    });
    await user.save();

    return { institutionCode: dto.institutionCode, bankName, accountNumber: dto.accountNumber, accountName: verified.accountName };
  }

  async getBankAccounts(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    return user.bankDetails || [];
  }

  async removeBankAccount(userId: string, accountNumber: string) {
    await this.userModel.findByIdAndUpdate(userId, { $pull: { bankDetails: { accountNumber } } });
  }

  // ── FIAT WALLET ─────────────────────────────────────────────────

  async getMyFiatWallet(userId: string) {
    return this.fiatWalletService.getOrCreateFiatWallet(userId);
  }

  async getMyFiatBalance(userId: string) {
    return this.fiatWalletService.getFiatBalance(userId);
  }

  // ── ON-RAMP QUOTE ───────────────────────────────────────────────

  async getOnRampQuote(ngnAmount: number) {
    if (ngnAmount < MIN_DEPOSIT_NGN) throw new BadRequestException(`Minimum deposit is ₦${MIN_DEPOSIT_NGN}`);
    if (ngnAmount > MAX_DEPOSIT_NGN) throw new BadRequestException(`Maximum is ₦${MAX_DEPOSIT_NGN.toLocaleString()}`);
    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const cNgnAmount = ngnAmount / rate;
    return { ngnAmount, estimatedCNgnAmount: cNgnAmount, exchangeRate: rate };
  }

  // ── OFF-RAMP (cNGN → NGN) ───────────────────────────────────────

  async getOffRampQuote(cNgnAmount: number) {
    if (cNgnAmount < MIN_WITHDRAWAL_CNGN) throw new BadRequestException(`Minimum is ${MIN_WITHDRAWAL_CNGN} cNGN`);
    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const ngnAmount = cNgnAmount * rate;
    return { cNgnAmount, estimatedNgnAmount: ngnAmount, exchangeRate: rate };
  }

  async requestWithdrawalOtp(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    const otp = this.vaultService.generateSecureOtp(6);
    const key = `${WITHDRAWAL_OTP_PREFIX}${user.email.toLowerCase()}`;
    await this.cacheManager.set(key, { otp, attempts: 0 }, WITHDRAWAL_OTP_TTL_MS);
    // TODO: send email via MailService (same pattern as existing withdrawal OTP)
    this.logger.log(`Withdrawal OTP generated for user ${userId}`);
    return { success: true, message: "OTP sent to your email. Valid for 5 minutes." };
  }

  /**
   * OFF-RAMP FLOW:
   * 1. Verify OTP
   * 2. Ensure fiat wallet has enough NGN balance
   * 3. Create Paycrest off-ramp order
   *    → response has receiveAddress (smart contract)
   * 4. User sends cNGN on-chain to that receiveAddress (handled by frontend)
   * 5. Paycrest webhook fires → NGN sent to our Nomba account
   * 6. We call Nomba Payout → NGN sent to user's bank
   * 7. recordLedgerTransaction()
   *
   * NOTE: Steps 4-7 are event-driven (webhook). This method only handles steps 1-3.
   */
  async initiateOffRamp(userId: string, dto: InitiateWithdrawalDto) {
    await this.verifyWithdrawalOtp(userId, dto.otp);

    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    if (!user.baseAddress) throw new BadRequestException("Base wallet not set up.");

    if (dto.cNgnAmount < MIN_WITHDRAWAL_CNGN) throw new BadRequestException(`Minimum is ${MIN_WITHDRAWAL_CNGN} cNGN`);

    // Get rate
    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const ngnAmount = dto.cNgnAmount * rate;

    // Check NGN balance
    const balance = await this.fiatWalletService.getFiatBalance(userId);
    if (parseFloat(balance) < ngnAmount) {
      throw new BadRequestException("Insufficient NGN balance");
    }

    // Create a PENDING transaction record
    const transaction = await this.transactionModel.create({
      userId: new Types.ObjectId(userId),
      type: TransactionType.FIAT_WITHDRAWAL,
      status: TransactionStatus.PENDING,
      amount: dto.cNgnAmount.toString(),
      currency: Currency.CNGN,
      chain: "BASE",
      baseAddress: user.baseAddress,
      fiatAmount: ngnAmount.toFixed(2),
      fiatCurrency: "NGN",
      exchangeRate: rate,
      metadata: {
        institutionCode: dto.institutionCode,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
      },
    });

    const transactionId = transaction._id.toString();

    // Create Paycrest off-ramp order
    const order = await this.paycrestService.createOrder({
      amount: dto.cNgnAmount.toString(),
      source: {
        type: "crypto",
        currency: "cNGN",
        network: "base",
        refundAddress: user.baseAddress, // cNGN refunded here if order fails
      },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: {
          institution: dto.institutionCode,
          accountIdentifier: dto.accountNumber,
          accountName: dto.accountName,
          memo: `Etibé withdrawal - ${transactionId}`,
        },
      },
      reference: transactionId,
    });

    await this.transactionModel.findByIdAndUpdate(transactionId, {
      paycrestOrderId: order.id,
      paycrestReceiveAddress: order.providerAccount.receiveAddress,
      status: TransactionStatus.SWAP_PENDING,
    });

    this.logger.log(`Off-ramp initiated: User ${userId}, ${dto.cNgnAmount} cNGN → ₦${ngnAmount.toFixed(2)}, Order:${order.id}`);

    return {
      transactionId,
      paycrestOrderId: order.id,
      receiveAddress: order.providerAccount.receiveAddress,  // frontend sends cNGN here
      cNgnAmount: dto.cNgnAmount,
      estimatedNgnAmount: ngnAmount,
      exchangeRate: rate,
      message: "Send cNGN to the receiveAddress to complete your withdrawal.",
    };
  }

  private async verifyWithdrawalOtp(userId: string, otp: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    const key = `${WITHDRAWAL_OTP_PREFIX}${user.email.toLowerCase()}`;
    const stored = await this.cacheManager.get<{ otp: string; attempts: number }>(key);
    if (!stored) throw new BadRequestException("OTP expired. Please request a new one.");
    if (stored.attempts >= 3) {
      await this.cacheManager.del(key);
      throw new BadRequestException("Too many attempts. Request a new OTP.");
    }
    if (stored.otp !== otp) {
      await this.cacheManager.set(key, { ...stored, attempts: stored.attempts + 1 }, WITHDRAWAL_OTP_TTL_MS);
      throw new BadRequestException("Invalid OTP");
    }
    await this.cacheManager.del(key);
  }
}
```

> Note: `Currency.CNGN` — add `CNGN = "CNGN"` to the `Currency` enum in `circle.enums.ts` if not already there.

---

## Phase 5 — FiatRampController & Module

### Step 5.1 — `src/modules/fiat-ramp/controllers/fiat-ramp.controller.ts`

```typescript
import {
  Controller, Post, Get, Delete,
  Body, Param, HttpCode, HttpStatus, UseGuards,
} from "@nestjs/common";
import { FiatRampService } from "../services/fiat-ramp.service";
import { PaycrestService } from "../services/paycrest.service";
import { VerifiedUserGuard } from "../../circles/guards/verified-user.guard";
import { CurrentUserId } from "../../auth/decorators";
import { AddBankAccountDto } from "../dto/bank-account.dto";
import { InitiateWithdrawalDto, GetRateDto } from "../dto/fiat-ramp.dto";

@Controller("fiat")
@UseGuards(VerifiedUserGuard)
export class FiatRampController {
  constructor(
    private readonly fiatRampService: FiatRampService,
    private readonly paycrestService: PaycrestService,
  ) {}

  // Fiat Wallet
  @Get("wallet")
  getMyWallet(@CurrentUserId() userId: string) {
    return this.fiatRampService.getMyFiatWallet(userId);
  }

  @Get("balance")
  getBalance(@CurrentUserId() userId: string) {
    return this.fiatRampService.getMyFiatBalance(userId);
  }

  // Bank Accounts
  @Get("banks")
  getSupportedBanks() {
    return this.paycrestService.getSupportedInstitutions("NGN");
  }

  @Post("bank-accounts")
  @HttpCode(HttpStatus.CREATED)
  addBankAccount(@Body() dto: AddBankAccountDto, @CurrentUserId() userId: string) {
    return this.fiatRampService.addBankAccount(userId, dto);
  }

  @Get("bank-accounts")
  getBankAccounts(@CurrentUserId() userId: string) {
    return this.fiatRampService.getBankAccounts(userId);
  }

  @Delete("bank-accounts/:accountNumber")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBankAccount(@Param("accountNumber") accountNumber: string, @CurrentUserId() userId: string) {
    return this.fiatRampService.removeBankAccount(userId, accountNumber);
  }

  // On-ramp
  @Post("deposit/quote")
  @HttpCode(HttpStatus.OK)
  getDepositQuote(@Body() dto: GetRateDto) {
    return this.fiatRampService.getOnRampQuote(dto.amount);
  }

  // Off-ramp
  @Post("withdraw/quote")
  @HttpCode(HttpStatus.OK)
  getWithdrawQuote(@Body() dto: GetRateDto) {
    return this.fiatRampService.getOffRampQuote(dto.amount);
  }

  @Post("withdraw/request-otp")
  @HttpCode(HttpStatus.OK)
  requestOtp(@CurrentUserId() userId: string) {
    return this.fiatRampService.requestWithdrawalOtp(userId);
  }

  @Post("withdraw/initiate")
  @HttpCode(HttpStatus.CREATED)
  initiateWithdrawal(@Body() dto: InitiateWithdrawalDto, @CurrentUserId() userId: string) {
    return this.fiatRampService.initiateOffRamp(userId, dto);
  }
}
```

### Step 5.2 — `src/modules/fiat-ramp/fiat-ramp.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { User, UserSchema } from "../users/schemas/user.schema";
import { Transaction, TransactionSchema } from "../transactions/schemas/transaction.schema";
import { WalletModule } from "../wallet/wallet.module"; // imports FiatWalletService
import { BlockchainModule } from "../blockchain";
import { FiatRampController } from "./controllers/fiat-ramp.controller";
import { FiatRampService } from "./services/fiat-ramp.service";
import { NombaService } from "./services/nomba.service";
import { PaycrestService } from "./services/paycrest.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    ConfigModule,
    WalletModule,     // ← gives us FiatWalletService via exports
    BlockchainModule, // ← gives us VaultService
  ],
  controllers: [FiatRampController],
  providers: [FiatRampService, NombaService, PaycrestService],
  exports: [FiatRampService, NombaService, PaycrestService],
})
export class FiatRampModule {}
```

### Step 5.3 — `src/modules/fiat-ramp/index.ts`

```typescript
export { FiatRampModule } from "./fiat-ramp.module";
export { FiatRampService } from "./services/fiat-ramp.service";
export { NombaService } from "./services/nomba.service";
export { PaycrestService } from "./services/paycrest.service";
```

---

## Phase 6 — Webhooks Module

### ⚠️ MUST DO FIRST: Fastify Raw Body Fix

In `src/main.ts`, right after `NestFactory.create(...)` and before `app.register(...)`:

```typescript
// Raw body needed for HMAC webhook signature verification
fastifyAdapter.getInstance().addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  function (req: any, body: Buffer, done: any) {
    req.rawBody = body; // stored for HMAC check
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (e) {
      done(e, undefined);
    }
  }
);
```

---

### Step 6.1 — Create folder

```
src/modules/webhooks/
  webhooks.module.ts
  index.ts
  controllers/
    webhooks.controller.ts
```

### Step 6.2 — `src/modules/webhooks/controllers/webhooks.controller.ts`

```typescript
import {
  Controller, Post, Headers, Req,
  HttpCode, HttpStatus, Logger, BadRequestException,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import { Public } from "../../auth/decorators";
import { Transaction, TransactionDocument } from "../../transactions/schemas/transaction.schema";
import { User, UserDocument } from "../../users/schemas/user.schema";
import { FiatWalletService } from "../../wallet/services/fiat-wallet.service";
import { NombaService } from "../../fiat-ramp/services/nomba.service";
import {
  TransactionType, TransactionStatus, LedgerAccountType, PostingDirection,
} from "../../../shared/enums";
import { LEDGER_ACCOUNTS, FIAT_RAMP_EVENTS } from "../../fiat-ramp/constants/fiat-ramp.constants";

type WebhookRequest = FastifyRequest & { rawBody?: Buffer };

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly fiatWalletService: FiatWalletService,
    private readonly nombaService: NombaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  //  NOMBA WEBHOOK — On-Ramp inflow
  //  Flow: User pays NGN to virtual account → Nomba fires this webhook
  //  Then: We call Paycrest to swap NGN → cNGN (see handover doc)
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
    if (!rawBody) throw new BadRequestException("Raw body unavailable");

    const secret = this.configService.get<string>("nomba.webhookSecret", "");
    if (!this.verifyNombaSignature(rawBody, signature, timestamp, secret)) {
      this.logger.warn("Nomba webhook: invalid HMAC signature — rejected");
      throw new BadRequestException("Invalid signature");
    }

    const payload = req.body as any;
    this.logger.log(`Nomba webhook received: event=${payload?.event || payload?.type}`);

    // ⚠️ Verify exact event name and field names against Nomba docs
    const isSuccess =
      payload?.event === "payment_success" ||
      payload?.event === "transaction.successful" ||
      payload?.data?.status === "successful";

    if (!isSuccess) {
      this.logger.log("Nomba webhook: not a success event, ignoring");
      return { received: true };
    }

    // Get the account reference to identify which user received money
    const accountReference =
      payload?.data?.accountReference ||
      payload?.accountReference;

    const transactionReference =
      payload?.data?.transactionId ||
      payload?.data?.reference ||
      payload?.transactionId;

    if (!accountReference && !transactionReference) {
      this.logger.warn("Nomba webhook: no reference found in payload");
      return { received: true };
    }

    // Step 1: Find the user's fiat wallet by virtual account reference
    const fiatWallet = await (this.fiatWalletService as any).fiatWalletModel?.findOne({
      "virtualAccount.accountReference": accountReference,
    });

    // Alternative: query directly if you have access to fiatWalletModel
    // For now, get userId from the fiat wallet
    if (!fiatWallet) {
      this.logger.warn(`Nomba webhook: no fiat wallet for accountReference ${accountReference}`);
      return { received: true };
    }

    const userId = fiatWallet.userId.toString();

    // Step 2: Verify transaction with Nomba (don't trust webhook blindly)
    let verifiedTx: Awaited<ReturnType<NombaService["verifyTransaction"]>>;
    try {
      verifiedTx = await this.nombaService.verifyTransaction(transactionReference);
      if (!verifiedTx.isSuccessful) {
        this.logger.warn(`Nomba webhook: transaction ${transactionReference} not confirmed by Nomba`);
        return { received: true };
      }
    } catch (err: any) {
      this.logger.error(`Nomba webhook: verification call failed: ${err.message}`);
      return { received: true };
    }

    // Convert kobo to NGN
    const ngnAmount = (verifiedTx.amount / 100).toFixed(2);

    // Step 3: Record ledger entry (NGN inflow)
    // DEBIT: platform:nomba:settlement (ASSET increases — company holds cash)
    // CREDIT: user:fiat_wallet:userId (LIABILITY increases — we owe user NGN)
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
            amount: ngnAmount,          // positive = DEBIT
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

      this.logger.log(`Nomba webhook: ✅ ₦${ngnAmount} ledger entry recorded for user ${userId}`);

      this.eventEmitter.emit(FIAT_RAMP_EVENTS.DEPOSIT_CONFIRMED, {
        userId,
        ngnAmount,
        transactionReference,
      });

      // NOTE: Paycrest swap (NGN → cNGN) is triggered separately from the
      // on-ramp initiation flow, not from this webhook.
      // This webhook only confirms the NGN arrived. The Paycrest order
      // was created when the user called POST /fiat/deposit/initiate.
    } catch (err: any) {
      this.logger.error(`Nomba webhook: ledger entry failed for user ${userId}: ${err.message}`);
    }

    return { received: true };
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  PAYCREST WEBHOOK — Swap / Off-ramp events
  // ────────────────────────────────────────────────────────────────────────────

  @Public()
  @Post("paycrest")
  @HttpCode(HttpStatus.OK)
  async handlePaycrestWebhook(
    @Req() req: WebhookRequest,
    @Headers("x-paycrest-signature") signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException("Raw body unavailable");

    const apiKey = this.configService.get<string>("paycrest.apiKey", "");
    if (!this.verifyPaycrestSignature(rawBody, signature, apiKey)) {
      this.logger.warn("Paycrest webhook: invalid HMAC signature — rejected");
      throw new BadRequestException("Invalid signature");
    }

    const payload = req.body as any;
    const event: string = payload?.event;
    const data = payload?.data;

    this.logger.log(`Paycrest webhook: ${event}, order:${data?.id}`);

    // Find the transaction by Paycrest order ID
    const transaction = await this.transactionModel.findOne({ paycrestOrderId: data?.id });
    if (!transaction) {
      this.logger.warn(`Paycrest webhook: no transaction for order ${data?.id}`);
      return { received: true };
    }

    const transactionId = transaction._id.toString();
    const userId = transaction.userId.toString();

    switch (event) {
      // ── ON-RAMP: cNGN delivered to user's wallet ──────────────────────
      case "payment_order.settled": {
        if (data?.direction === "onramp" || transaction.type === TransactionType.FIAT_DEPOSIT) {
          // cNGN has been sent to user's baseAddress on-chain by Paycrest
          // Now debit the user's NGN fiat balance (it became cNGN)
          if (transaction.status !== TransactionStatus.SWAP_SETTLED) {
            try {
              await this.transactionModel.findByIdAndUpdate(transactionId, {
                status: TransactionStatus.SWAP_SETTLED,
                confirmedAt: new Date(),
              });

              // Ledger: user's fiat balance decreases (NGN became cNGN)
              // DEBIT  (+): user:fiat_wallet:userId (LIABILITY decreases)
              // CREDIT (-): platform:nomba:settlement (ASSET decreases)
              await this.fiatWalletService.recordLedgerTransaction(
                userId,
                TransactionType.FIAT_DEPOSIT, // settlement of the on-ramp
                "NGN",
                transaction.fiatAmount || "0",
                [
                  {
                    accountType: LedgerAccountType.LIABILITY,
                    accountRef: LEDGER_ACCOUNTS.userFiatWallet(userId),
                    amount: transaction.fiatAmount || "0", // positive = DEBIT (liability decreases)
                  },
                  {
                    accountType: LedgerAccountType.ASSET,
                    accountRef: LEDGER_ACCOUNTS.NOMBA_SETTLEMENT,
                    amount: `-${transaction.fiatAmount || "0"}`, // negative = CREDIT (asset decreases)
                  },
                ],
                { paycrestOrderId: data?.id, swapSettledAt: new Date().toISOString() },
              );

              this.eventEmitter.emit(FIAT_RAMP_EVENTS.DEPOSIT_CONFIRMED, { transactionId, userId });
              this.logger.log(`Paycrest webhook: ✅ On-ramp settled tx:${transactionId}`);
            } catch (err: any) {
              this.logger.error(`On-ramp ledger update failed tx:${transactionId}: ${err.message}`);
            }
          }
        }
        break;
      }

      // ── OFF-RAMP: NGN arrived in Nomba account → pay user ────────────
      case "payment_order.validated": {
        if (transaction.type === TransactionType.FIAT_WITHDRAWAL) {
          // Paycrest has paid NGN to our Nomba account.
          // Now call Nomba Payout to send NGN to user's personal bank.
          if (transaction.status !== TransactionStatus.PAYOUT_PENDING) {
            try {
              await this.transactionModel.findByIdAndUpdate(transactionId, {
                status: TransactionStatus.PAYOUT_PENDING,
              });

              const meta = transaction.metadata as any;

              const payout = await this.nombaService.sendPayout({
                amount: parseFloat(transaction.fiatAmount || "0"),
                destinationBank: meta.institutionCode,
                destinationAccount: meta.accountNumber,
                destinationAccountName: meta.accountName,
                narration: `Etibé withdrawal - ${transactionId}`,
                reference: transactionId,
              });

              // Record ledger: NGN leaves platform, user liability clears
              await this.fiatWalletService.recordLedgerTransaction(
                userId,
                TransactionType.FIAT_WITHDRAWAL,
                "NGN",
                transaction.fiatAmount || "0",
                [
                  {
                    accountType: LedgerAccountType.LIABILITY,
                    accountRef: LEDGER_ACCOUNTS.userFiatWallet(userId),
                    amount: transaction.fiatAmount || "0", // DEBIT: liability decreases
                  },
                  {
                    accountType: LedgerAccountType.ASSET,
                    accountRef: LEDGER_ACCOUNTS.NOMBA_SETTLEMENT,
                    amount: `-${transaction.fiatAmount || "0"}`, // CREDIT: asset decreases
                  },
                ],
                { paycrestOrderId: data?.id, npayboutReference: payout.reference },
              );

              await this.transactionModel.findByIdAndUpdate(transactionId, {
                status: TransactionStatus.COMPLETED,
                confirmedAt: new Date(),
              });

              this.eventEmitter.emit(FIAT_RAMP_EVENTS.WITHDRAWAL_CONFIRMED, { transactionId, userId });
              this.logger.log(`Paycrest webhook: ✅ Off-ramp payout sent tx:${transactionId}`);
            } catch (err: any) {
              this.logger.error(`Off-ramp payout failed tx:${transactionId}: ${err.message}`);
              await this.transactionModel.findByIdAndUpdate(transactionId, {
                status: TransactionStatus.FAILED,
                failureReason: err.message,
              });
            }
          }
        }
        break;
      }

      case "payment_order.refunded":
      case "payment_order.expired": {
        await this.transactionModel.findByIdAndUpdate(transactionId, {
          status: TransactionStatus.REVERSED,
          failureReason: `Paycrest event: ${event}`,
        });
        this.logger.warn(`Paycrest webhook: ${event} for tx:${transactionId}`);
        break;
      }

      default:
        this.logger.log(`Paycrest webhook: unhandled event ${event}`);
    }

    return { received: true };
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────

  private verifyNombaSignature(rawBody: Buffer, signature: string, timestamp: string, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      // Common Nomba pattern: HMAC-SHA256("timestamp.rawBody", secret)
      // ⚠️ Verify exact format in Nomba docs
      const signedPayload = timestamp ? `${timestamp}.${rawBody.toString("utf8")}` : rawBody;
      const computed = createHmac("sha256", secret).update(signedPayload).digest("hex").toLowerCase();
      const sig = signature.toLowerCase().trim();
      if (computed.length !== sig.length) return false;
      return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(sig, "utf8"));
    } catch { return false; }
  }

  private verifyPaycrestSignature(rawBody: Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      const computed = createHmac("sha256", secret.trim()).update(rawBody).digest("hex").toLowerCase();
      const sig = signature.toLowerCase().trim();
      if (computed.length !== sig.length) return false;
      return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(sig, "utf8"));
    } catch { return false; }
  }
}
```

### Step 6.3 — `src/modules/webhooks/webhooks.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { Transaction, TransactionSchema } from "../transactions/schemas/transaction.schema";
import { User, UserSchema } from "../users/schemas/user.schema";
import { WalletModule } from "../wallet/wallet.module";   // FiatWalletService
import { FiatRampModule } from "../fiat-ramp";             // NombaService
import { WebhooksController } from "./controllers/webhooks.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
    WalletModule,
    FiatRampModule,
  ],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
```

### Step 6.4 — `src/modules/webhooks/index.ts`

```typescript
export { WebhooksModule } from "./webhooks.module";
```

---

## ⚠️ Important Note on the Nomba Webhook Handler

The webhook handler currently finds the user's fiat wallet by `virtualAccount.accountReference`.
But `FiatWalletService` doesn't expose the model directly. You have two clean options:

**Option A**: Add a `findByAccountReference(ref: string)` method to `FiatWalletService`:
```typescript
async findByAccountReference(accountReference: string): Promise<FiatWalletDocument | null> {
  return this.fiatWalletModel.findOne({
    "virtualAccount.accountReference": accountReference,
  });
}
```
Then call it in the webhook controller via `this.fiatWalletService.findByAccountReference(...)`.

**Option B**: Add `FiatWallet` model directly to `WebhooksModule` and inject it in the controller.

**Option A is cleaner** — add it to `fiat-wallet.service.ts`.

---

## Final Checklist

- [ ] `.env` — Nomba + Paycrest vars added (use lead engineer's exact key names)
- [ ] `app.config.ts` — `nombaConfig` + `paycrestConfig` added
- [ ] `env.validation.ts` — optional fields added
- [ ] `app.module.ts` — configs in `load[]`, `FiatRampModule` + `WebhooksModule` imported
- [ ] `circle.enums.ts` — `FIAT_DEPOSIT`, `FIAT_WITHDRAWAL`, `NOMBA_PAYOUT`, `SWAP_PENDING`, `SWAP_SETTLED`, `PAYOUT_PENDING`, `EXPIRED` added; `CNGN` added to `Currency`
- [ ] `transaction.schema.ts` — 6 new fiat fields added (`nombaReference`, `paycrestOrderId`, etc.)
- [ ] `user.schema.ts` — `BankDetail` sub-schema + `bankDetails[]` field added
- [ ] `fiat-ramp/constants/fiat-ramp.constants.ts` created
- [ ] `fiat-ramp/dto/bank-account.dto.ts` created
- [ ] `fiat-ramp/dto/fiat-ramp.dto.ts` created
- [ ] `fiat-ramp/services/nomba.service.ts` created (OAuth2 token management)
- [ ] `fiat-ramp/services/paycrest.service.ts` created
- [ ] `fiat-ramp/services/fiat-ramp.service.ts` created
- [ ] `fiat-ramp/controllers/fiat-ramp.controller.ts` created
- [ ] `fiat-ramp/fiat-ramp.module.ts` + `index.ts` created
- [ ] `findByAccountReference()` method added to `FiatWalletService`
- [ ] **`main.ts` — raw body parser added (CRITICAL)**
- [ ] `webhooks/controllers/webhooks.controller.ts` created
- [ ] `webhooks/webhooks.module.ts` + `index.ts` created
- [ ] Webhook URLs registered in Nomba dashboard + Paycrest dashboard
- [ ] ngrok running for local testing

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/fiat/wallet` | JWT | Get/create fiat wallet (with virtual account) |
| `GET` | `/api/v1/fiat/balance` | JWT | Get current NGN balance |
| `GET` | `/api/v1/fiat/banks` | JWT | List supported banks (from Paycrest) |
| `POST` | `/api/v1/fiat/bank-accounts` | JWT | Verify + save personal bank account |
| `GET` | `/api/v1/fiat/bank-accounts` | JWT | List saved bank accounts |
| `DELETE` | `/api/v1/fiat/bank-accounts/:accountNumber` | JWT | Remove a bank account |
| `POST` | `/api/v1/fiat/deposit/quote` | JWT | Get NGN→cNGN rate quote |
| `POST` | `/api/v1/fiat/withdraw/quote` | JWT | Get cNGN→NGN rate quote |
| `POST` | `/api/v1/fiat/withdraw/request-otp` | JWT | Send withdrawal OTP |
| `POST` | `/api/v1/fiat/withdraw/initiate` | JWT | Create Paycrest order + return receiveAddress |
| `POST` | `/api/v1/webhooks/nomba` | HMAC | Nomba payment notification |
| `POST` | `/api/v1/webhooks/paycrest` | HMAC | Paycrest swap/payout events |

---

## Local Webhook Testing

```bash
npx ngrok http 3000
# Register in dashboards:
# Nomba:    https://<ngrok-url>/api/v1/webhooks/nomba
# Paycrest: https://<ngrok-url>/api/v1/webhooks/paycrest
```
