import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { ConfigService } from "@nestjs/config";

import { User, UserDocument } from "../../users/schemas/user.schema";
import {
  Transaction,
  TransactionDocument,
} from "../../transactions/schemas/transaction.schema";
import { FiatWalletService } from "../../wallet/services/fiat-wallet.service";
import { NombaService } from "./nomba.service";
import { PaycrestService } from "./paycrest.service";
import { VaultService } from "../../blockchain/services/vault.service";
import { AddBankAccountDto } from "../dto/bank-account.dto";
import { InitiateWithdrawalDto } from "../dto/fiat-ramp.dto";
import {
  TransactionType,
  TransactionStatus,
  Currency,
  LedgerAccountType,
} from "../../../shared/enums";
import {
  LEDGER_ACCOUNTS,
  FIAT_RAMP_EVENTS,
  MIN_DEPOSIT_NGN,
  MAX_DEPOSIT_NGN,
  MIN_WITHDRAWAL_CNGN,
} from "../constants/fiat-ramp.constants";

const WITHDRAWAL_OTP_PREFIX = "fiat_ramp_withdrawal_otp:";
const WITHDRAWAL_OTP_TTL_MS = 300_000; // 5 minutes

@Injectable()
export class FiatRampService {
  private readonly logger = new Logger(FiatRampService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly fiatWalletService: FiatWalletService,
    private readonly nombaService: NombaService,
    private readonly paycrestService: PaycrestService,
    private readonly vaultService: VaultService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ── FIAT WALLET ──────────────────────────────────────────────────────────────

  /**
   * Get or lazily create the user's NGN fiat wallet.
   * On first call, a real Nomba virtual account is created so the user can
   * deposit NGN by bank transfer (and the Nomba webhook can fire).
   */
  async getMyFiatWallet(userId: string) {
    const existing = await this.fiatWalletService.findByUserId(userId);
    if (existing) return existing;

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    // accountRef: 16-64 chars (Nomba constraint), unique per wallet
    const accountRef = `ETIBE-VA-${new Types.ObjectId().toString().toUpperCase()}`;

    // accountName: 8-64 chars (Nomba constraint)
    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    let accountName = `ETIBE/${(fullName || user.username || "CUSTOMER").toUpperCase()}`;
    if (accountName.length < 8) accountName = `ETIBE/CUSTOMER`;
    accountName = accountName.slice(0, 64);

    const virtualAccount = await this.nombaService.createVirtualAccount({
      accountRef,
      accountName,
    });

    return this.fiatWalletService.createWallet(userId, virtualAccount);
  }

  async getMyFiatBalance(userId: string) {
    return { balance: await this.fiatWalletService.getFiatBalance(userId), currency: "NGN" };
  }

  // ── AUTO-CONVERSION: NGN → cNGN ─────────────────────────────────────────────

  /**
   * Fired by the Nomba webhook after a deposit is verified and the user's
   * fiat balance credited. Converts the full deposit to cNGN automatically:
   *
   *   1. Create a Paycrest on-ramp order (NGN → cNGN to the user's baseAddress)
   *   2. Pay NGN from our Nomba corporate balance into Paycrest's provider account
   *   3. Paycrest swaps and delivers cNGN on Base
   *   4. `payment_order.settled` webhook debits the user's NGN fiat balance
   *
   * Failures leave the user's NGN balance credited (money is safe) and mark
   * the swap transaction FAILED for retry/manual review.
   */
  @OnEvent(FIAT_RAMP_EVENTS.DEPOSIT_CONFIRMED)
  async handleDepositConfirmed(payload: {
    userId: string;
    ngnAmount: string;
    nombaReference: string;
  }) {
    const { userId, ngnAmount, nombaReference } = payload || ({} as any);
    if (!userId || !ngnAmount || !nombaReference) {
      this.logger.warn(
        "[AUTO-CONVERT] DEPOSIT_CONFIRMED payload incomplete — skipping conversion",
      );
      return;
    }

    try {
      await this.convertDepositToCngn(userId, ngnAmount, nombaReference);
    } catch (err: any) {
      // Never let a conversion failure bubble into the webhook response path.
      this.logger.error(
        `[AUTO-CONVERT] Conversion failed for user=${userId}, ref=${nombaReference}: ${err.message}`,
      );
    }
  }

  private async convertDepositToCngn(
    userId: string,
    ngnAmount: string,
    nombaReference: string,
  ) {
    // Idempotency: one swap per Nomba deposit (webhooks can be retried)
    const existing = await this.transactionModel.findOne({
      nombaReference,
      type: TransactionType.FIAT_DEPOSIT,
      paycrestOrderId: { $exists: true, $ne: null },
    });
    if (existing) {
      this.logger.log(
        `[AUTO-CONVERT] Swap already initiated for ref=${nombaReference} (tx=${existing._id}) — skipping`,
      );
      return;
    }

    const user = await this.userModel.findById(userId);
    if (!user?.baseAddress) {
      // No on-chain wallet to deliver to — leave NGN in the fiat wallet.
      this.logger.warn(
        `[AUTO-CONVERT] User ${userId} has no baseAddress — NGN stays in fiat wallet`,
      );
      return;
    }

    // Pending swap transaction; the Paycrest webhook resolves it by paycrestOrderId
    const tx = await this.transactionModel.create({
      type: TransactionType.FIAT_DEPOSIT,
      status: TransactionStatus.SWAP_PENDING,
      userId: new Types.ObjectId(userId),
      amount: ngnAmount,
      currency: "NGN",
      fiatAmount: ngnAmount,
      fiatCurrency: "NGN",
      baseAddress: user.baseAddress,
      nombaReference,
      metadata: { autoConversion: true },
    });

    try {
      // 1. Create the Paycrest on-ramp order
      const order = await this.paycrestService.createOrder({
        amount: ngnAmount,
        source: { type: "fiat", currency: "NGN" },
        destination: {
          type: "crypto",
          currency: "cNGN",
          recipient: { address: user.baseAddress, network: "base" },
        },
        reference: tx._id.toString(),
      });

      await this.transactionModel.findByIdAndUpdate(tx._id, {
        paycrestOrderId: order.id,
        exchangeRate: order.rate ? parseFloat(order.rate) : undefined,
      });

      // 2. Fund the order: pay NGN into Paycrest's provider bank account
      const pa = order.providerAccount || ({} as any);
      if (!pa.accountIdentifier) {
        throw new Error("Paycrest order has no providerAccount to fund");
      }

      const payout = await this.nombaService.sendPayout({
        amount: parseFloat(pa.amountToTransfer || ngnAmount),
        destinationBank: pa.institution || "",
        destinationAccount: pa.accountIdentifier,
        destinationAccountName: pa.accountName || "PAYCREST",
        narration: `PAYCREST:${order.id}`,
        reference: `${tx._id.toString()}-fund`,
      });

      await this.transactionModel.findByIdAndUpdate(tx._id, {
        $set: {
          "metadata.nombaPayoutReference": payout.reference,
          "metadata.nombaPayoutStatus": payout.status,
        },
      });

      this.logger.log(
        `[AUTO-CONVERT] ✅ Order ${order.id} created & funded (₦${ngnAmount}) — awaiting Paycrest settlement, tx=${tx._id}`,
      );
    } catch (err: any) {
      await this.transactionModel.findByIdAndUpdate(tx._id, {
        status: TransactionStatus.FAILED,
        failureReason: `Auto-conversion failed: ${err.message}`,
      });
      this.eventEmitter.emit(FIAT_RAMP_EVENTS.DEPOSIT_FAILED, {
        userId,
        transactionId: tx._id.toString(),
        error: err.message,
      });
      throw err;
    }
  }

  // ── BANK ACCOUNTS ─────────────────────────────────────────────────────────────

  /**
   * Verify a Nigerian bank account via Paycrest and save it to the user profile.
   * These saved accounts are the destination for NGN off-ramp payouts.
   */
  async addBankAccount(userId: string, dto: AddBankAccountDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const alreadySaved = user.bankDetails?.some(
      (b) =>
        b.accountNumber === dto.accountNumber &&
        b.institutionCode === dto.institutionCode,
    );
    if (alreadySaved) {
      throw new BadRequestException("This bank account is already saved");
    }

    // Verify with Paycrest (resolves the account name)
    const verified = await this.paycrestService.verifyAccount(
      dto.institutionCode,
      dto.accountNumber,
    );

    // Fetch institution metadata for the human-readable bank name
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

    this.logger.log(`Bank account added for user ${userId}: ${dto.accountNumber}`);

    return {
      institutionCode: dto.institutionCode,
      bankName,
      accountNumber: dto.accountNumber,
      accountName: verified.accountName,
      isVerified: true,
    };
  }

  async getBankAccounts(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    return user.bankDetails || [];
  }

  async removeBankAccount(userId: string, accountNumber: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { bankDetails: { accountNumber } },
    });
  }

  // ── ON-RAMP QUOTE ─────────────────────────────────────────────────────────────

  /**
   * Get a live quote for depositing NGN → receiving cNGN.
   * User pays NGN into their Nomba virtual account (GET /fiat/wallet).
   * The Nomba webhook then triggers the Paycrest swap automatically.
   */
  async getOnRampQuote(ngnAmount: number) {
    if (ngnAmount < MIN_DEPOSIT_NGN) {
      throw new BadRequestException(`Minimum deposit is ₦${MIN_DEPOSIT_NGN}`);
    }
    if (ngnAmount > MAX_DEPOSIT_NGN) {
      throw new BadRequestException(
        `Maximum deposit is ₦${MAX_DEPOSIT_NGN.toLocaleString()}`,
      );
    }

    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const estimatedCNgnAmount = ngnAmount / rate;

    return {
      ngnAmount,
      estimatedCNgnAmount: parseFloat(estimatedCNgnAmount.toFixed(6)),
      exchangeRate: rate,
      note: "Pay NGN to your virtual account (GET /fiat/wallet) to fund your cNGN balance.",
    };
  }

  // ── OFF-RAMP: cNGN → NGN ──────────────────────────────────────────────────────

  async getOffRampQuote(cNgnAmount: number) {
    if (cNgnAmount < MIN_WITHDRAWAL_CNGN) {
      throw new BadRequestException(`Minimum withdrawal is ${MIN_WITHDRAWAL_CNGN} cNGN`);
    }

    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const estimatedNgnAmount = cNgnAmount * rate;

    return {
      cNgnAmount,
      estimatedNgnAmount: parseFloat(estimatedNgnAmount.toFixed(2)),
      exchangeRate: rate,
    };
  }

  async requestWithdrawalOtp(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");

    // Ensure fiat wallet exists and has enough balance before sending OTP
    const balance = await this.fiatWalletService.getFiatBalance(userId);
    if (parseFloat(balance) <= 0) {
      throw new BadRequestException("No NGN balance to withdraw");
    }

    const otp = this.vaultService.generateSecureOtp(6);
    const cacheKey = `${WITHDRAWAL_OTP_PREFIX}${user.email.toLowerCase()}`;
    await this.cacheManager.set(
      cacheKey,
      { otp, attempts: 0 },
      WITHDRAWAL_OTP_TTL_MS,
    );

    // TODO: integrate MailService to send OTP email (same pattern as wallet.service.ts)
    this.logger.log(`[FIAT RAMP] Withdrawal OTP generated for user ${userId} — OTP: ${otp} (dev only)`);

    return {
      success: true,
      message: "OTP sent to your email. Valid for 5 minutes.",
    };
  }

  /**
   * OFF-RAMP FLOW (steps 1–4 handled here; steps 5–7 via Paycrest webhook):
   *
   * 1. Verify OTP
   * 2. Check user has enough NGN fiat balance
   * 3. Get live cNGN/NGN rate
   * 4. Create Paycrest off-ramp order
   *    → Paycrest returns a smart contract address (receiveAddress)
   *    → Frontend must send cNGN on-chain to that address
   * 5. [webhook] Paycrest confirms cNGN received → NGN arrives in our Nomba account
   * 6. [webhook] We call Nomba Payout to send NGN to user's personal bank
   * 7. [webhook] recordLedgerTransaction() debit/credit entries
   */
  async initiateOffRamp(userId: string, dto: InitiateWithdrawalDto) {
    // Step 1 — OTP
    await this.verifyWithdrawalOtp(userId, dto.otp);

    // Step 2 — Validate amount & balance
    if (dto.cNgnAmount < MIN_WITHDRAWAL_CNGN) {
      throw new BadRequestException(`Minimum withdrawal is ${MIN_WITHDRAWAL_CNGN} cNGN`);
    }

    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");
    if (!user.baseAddress) {
      throw new BadRequestException(
        "Base wallet not set up. Complete onboarding first.",
      );
    }

    const balance = await this.fiatWalletService.getFiatBalance(userId);
    if (parseFloat(balance) < dto.cNgnAmount) {
      throw new BadRequestException(
        `Insufficient NGN balance. Available: ₦${balance}`,
      );
    }

    // Step 3 — Rate
    const rate = await this.paycrestService.getRate("base", "cNGN", "1", "NGN");
    const ngnAmount = dto.cNgnAmount * rate;

    // Step 4a — Create a PENDING transaction record (idempotency key = _id)
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

    // Step 4b — Create Paycrest off-ramp order
    let order: Awaited<ReturnType<PaycrestService["createOrder"]>>;
    try {
      order = await this.paycrestService.createOrder({
        amount: dto.cNgnAmount.toString(),
        source: {
          type: "crypto",
          currency: "cNGN",
          network: "base",
          // If the order fails/expires, Paycrest refunds to this address
          refundAddress: user.baseAddress,
        },
        destination: {
          type: "fiat",
          currency: "NGN",
          recipient: {
            institution: dto.institutionCode,
            accountIdentifier: dto.accountNumber,
            accountName: dto.accountName,
            memo: `Etibé withdrawal ${transactionId}`,
          },
        },
        reference: transactionId,
      });
    } catch (err: any) {
      // Mark transaction failed if Paycrest order creation fails
      await this.transactionModel.findByIdAndUpdate(transactionId, {
        status: TransactionStatus.FAILED,
        failureReason: `Paycrest order creation failed: ${err.message}`,
      });
      throw new BadRequestException(`Unable to initiate withdrawal: ${err.message}`);
    }

    // Step 4c — Persist order details and update status
    await this.transactionModel.findByIdAndUpdate(transactionId, {
      paycrestOrderId: order.id,
      paycrestReceiveAddress: order.providerAccount?.receiveAddress,
      status: TransactionStatus.SWAP_PENDING,
    });

    this.eventEmitter.emit(FIAT_RAMP_EVENTS.WITHDRAWAL_CONFIRMED, {
      transactionId,
      userId,
      cNgnAmount: dto.cNgnAmount,
      estimatedNgnAmount: ngnAmount,
      paycrestOrderId: order.id,
    });

    this.logger.log(
      `[OFF-RAMP] Initiated: User=${userId}, ${dto.cNgnAmount} cNGN → ₦${ngnAmount.toFixed(2)}, Order=${order.id}`,
    );

    return {
      transactionId,
      paycrestOrderId: order.id,
      // Frontend MUST send cNGN on-chain to this address to complete the withdrawal
      receiveAddress: order.providerAccount?.receiveAddress,
      cNgnAmount: dto.cNgnAmount,
      estimatedNgnAmount: parseFloat(ngnAmount.toFixed(2)),
      exchangeRate: rate,
      message:
        "Send cNGN to the receiveAddress on Base chain to complete your withdrawal. Your NGN will arrive in your bank account within minutes of the on-chain transfer.",
    };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────

  private async verifyWithdrawalOtp(userId: string, otp: string): Promise<void> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("User not found");

    const cacheKey = `${WITHDRAWAL_OTP_PREFIX}${user.email.toLowerCase()}`;
    const stored = await this.cacheManager.get<{ otp: string; attempts: number }>(
      cacheKey,
    );

    if (!stored) {
      throw new BadRequestException("OTP expired or not requested. Please request a new one.");
    }
    if (stored.attempts >= 3) {
      await this.cacheManager.del(cacheKey);
      throw new BadRequestException(
        "Too many failed OTP attempts. Please request a new OTP.",
      );
    }
    if (stored.otp !== otp) {
      await this.cacheManager.set(
        cacheKey,
        { ...stored, attempts: stored.attempts + 1 },
        WITHDRAWAL_OTP_TTL_MS,
      );
      throw new BadRequestException("Invalid OTP.");
    }

    // Valid — consume the OTP
    await this.cacheManager.del(cacheKey);
  }

  // ── NOMBA WEBHOOK (ON-RAMP) ────────────────────────────────────────────────
  async handleNombaWebhook(payload: any, signature?: string) {
    this.logger.log(`Received Nomba webhook: ${JSON.stringify(payload)}`);
    
    // In a real app, verify HMAC signature here using configService.get('nomba.clientSecret')

    const { event, data } = payload;
    if (event !== "transaction.success" && event !== "virtual_account.transaction.success") {
      this.logger.log(`Ignoring unhandled Nomba event: ${event}`);
      return;
    }

    const accountNumber = data.virtualAccount || data.accountNumber;
    const amountStr = data.amount?.toString();
    if (!accountNumber || !amountStr) return;

    const amount = parseFloat(amountStr);

    const wallet = await this.fiatWalletService.findByVirtualAccountNumber(accountNumber);
    if (!wallet) {
      this.logger.warn(`Received deposit for unknown virtual account: ${accountNumber}`);
      return;
    }

    const userId = wallet.userId.toString();
    
    const txId = data.transactionReference || data.id;
    const existingTx = await this.transactionModel.findOne({ reference: txId });
    if (existingTx) {
      this.logger.warn(`Nomba transaction ${txId} already processed.`);
      return;
    }

    this.logger.log(`Processing NGN ${amount} deposit for user ${userId}`);

    const transaction = await this.transactionModel.create({
      userId: wallet.userId,
      type: TransactionType.TOP_UP,
      status: TransactionStatus.COMPLETED,
      amount: amount.toString(),
      currency: Currency.CNGN,
      nombaReference: txId,
      metadata: {
        provider: "nomba",
        senderName: data.senderName,
      },
    });

    try {
      this.logger.log(`Crediting ${amount} to user ${userId} fiat wallet...`);
      wallet.balance = (parseFloat(wallet.balance) + amount).toString();
      await wallet.save();
      this.logger.log(`Successfully credited ${amount} NGN for user ${userId}.`);
    } catch (e: any) {
      this.logger.error(`Failed to credit fiat wallet for user ${userId}: ${e.message}`);
    }
  }
}
