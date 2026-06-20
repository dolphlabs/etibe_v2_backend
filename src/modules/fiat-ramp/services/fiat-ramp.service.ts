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
import { EventEmitter2 } from "@nestjs/event-emitter";
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
   * The wallet holds a Nomba virtual account (the deposit account number).
   */
  async getMyFiatWallet(userId: string) {
    return this.fiatWalletService.getOrCreateFiatWallet(userId);
  }

  async getMyFiatBalance(userId: string) {
    return { balance: await this.fiatWalletService.getFiatBalance(userId), currency: "NGN" };
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
}
