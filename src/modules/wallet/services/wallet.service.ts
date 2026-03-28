import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { InjectQueue } from "@nestjs/bullmq";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Queue } from "bullmq";
import { Model, Types } from "mongoose";
import { Cache } from "cache-manager";

import { User, UserDocument } from "../../users/schemas/user.schema";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import { BaseAccountService } from "../../blockchain/services/base-account.service";
import { BaseTokenService } from "../../blockchain/services/base-token.service";
import { TokenService } from "../../blockchain/services/token.service";
import { VaultService } from "../../blockchain/services/vault.service";
import { MailService } from "../../auth/services/mail.service";
import {
  WITHDRAWAL_QUEUE_NAME,
  generateWithdrawalJobId,
  WITHDRAWAL_JOB_OPTIONS,
  WithdrawalJobData,
  MIN_WITHDRAWAL_AMOUNTS,
  MAX_WITHDRAWAL_AMOUNTS,
  WITHDRAWAL_OTP_PREFIX,
  WITHDRAWAL_OTP_EXPIRY_SECONDS,
  WITHDRAWAL_OTP_MAX_ATTEMPTS,
} from "../constants/withdrawal.constants";
import {
  WithdrawDto,
  WithdrawalAsset,
  inferChainFromAsset,
} from "../dto/withdraw.dto";
import {
  TransactionType,
  TransactionStatus,
  Currency,
  Chain,
} from "../../../shared/enums/circle.enums";
import { Transaction, TransactionDocument } from "@modules/transactions";

interface WithdrawalOtpData {
  otp: string;
  email: string;
  deviceId: string;
  attempts: number;
  createdAt: number;
  expiresAt: number;
  asset: string;
  amount: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectQueue(WITHDRAWAL_QUEUE_NAME)
    private readonly withdrawalQueue: Queue<WithdrawalJobData>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly nearAccountService: NearAccountService,
    private readonly baseAccountService: BaseAccountService,
    private readonly baseTokenService: BaseTokenService,
    private readonly tokenService: TokenService,
    private readonly vaultService: VaultService,
    private readonly mailService: MailService,
  ) {}

  async requestWithdrawalOtp(
    userId: string,
    deviceId: string,
    asset: WithdrawalAsset,
    amount: string,
    chain?: Chain,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) {
      throw new BadRequestException("User not found");
    }

    const resolvedChain = inferChainFromAsset(asset, chain);

    if (resolvedChain === Chain.NEAR && !user.nearAccountId) {
      throw new BadRequestException("NEAR wallet not set up");
    }
    if (resolvedChain === Chain.BASE && !user.baseAddress) {
      throw new BadRequestException("Base wallet not set up");
    }

    this.validateWithdrawalAmount(amount, asset);

    const otp = this.vaultService.generateSecureOtp(6);

    const key = `${WITHDRAWAL_OTP_PREFIX}${user.email.toLowerCase()}`;
    const otpData: WithdrawalOtpData = {
      otp,
      email: user.email.toLowerCase(),
      deviceId,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + WITHDRAWAL_OTP_EXPIRY_SECONDS * 1000,
      asset,
      amount,
    };

    await this.cacheManager.set(
      key,
      otpData,
      WITHDRAWAL_OTP_EXPIRY_SECONDS * 1000,
    );

    await this.sendWithdrawalOtpEmail(
      user.email,
      user.firstName,
      otp,
      amount,
      asset,
    );

    this.logger.log(
      `Withdrawal OTP requested for user ${userId}: ${amount} ${asset}`,
    );

    return {
      success: true,
      message: "Verification code sent to your email. Valid for 5 minutes.",
    };
  }

  async processWithdrawal(
    userId: string,
    deviceId: string,
    dto: WithdrawDto,
    idempotencyKey: string,
  ): Promise<{
    transactionId: string;
    status: "PENDING" | "PROCESSING";
    message: string;
  }> {
    const existingJobId = generateWithdrawalJobId(userId, idempotencyKey);
    const existingJob = await this.withdrawalQueue.getJob(existingJobId);

    if (existingJob) {
      const existingTx = await this.transactionModel.findOne({
        userId: new Types.ObjectId(userId),
        "metadata.idempotencyKey": idempotencyKey,
        type: TransactionType.WITHDRAWAL,
      });

      if (existingTx) {
        this.logger.warn(
          `Duplicate withdrawal request detected for user ${userId}, idempotency key: ${idempotencyKey}`,
        );
        return {
          transactionId: existingTx._id.toString(),
          status:
            existingTx.status === TransactionStatus.PENDING
              ? "PENDING"
              : "PROCESSING",
          message: "This withdrawal request is already being processed.",
        };
      }
    }

    const resolvedChain = inferChainFromAsset(
      dto.asset as WithdrawalAsset,
      dto.chain,
    );

    const user = await this.userModel
      .findById(userId)
      .select("+nearEncryptedPrivateKey +baseEncryptedPrivateKey")
      .lean();

    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (resolvedChain === Chain.NEAR) {
      if (!user.nearAccountId) {
        throw new BadRequestException(
          "NEAR wallet not set up. Please complete onboarding.",
        );
      }
      if (!user.nearEncryptedPrivateKey) {
        throw new BadRequestException(
          "Wallet not configured for withdrawals. Please contact support.",
        );
      }
    } else {
      if (!user.baseAddress) {
        throw new BadRequestException(
          "Base wallet not set up. Please complete onboarding.",
        );
      }
      if (!user.baseEncryptedPrivateKey) {
        throw new BadRequestException(
          "Base wallet not configured for withdrawals. Please contact support.",
        );
      }
    }

    await this.verifyWithdrawalOtp(
      user.email,
      dto.otp,
      deviceId,
      dto.asset,
      dto.amount,
    );

    this.validateWithdrawalAmount(dto.amount, dto.asset as WithdrawalAsset);

    let validation: { valid: boolean; error?: string; requiresStorageDeposit?: boolean };

    if (resolvedChain === Chain.BASE) {
      await this.checkAvailableBalanceBase(
        user.baseAddress!,
        dto.asset as WithdrawalAsset,
        dto.amount,
      );
      validation = await this.baseTokenService.validateWithdrawal(
        dto.asset,
        dto.destinationAddress,
      );
    } else {
      await this.checkAvailableBalance(
        user.nearAccountId!,
        dto.asset as WithdrawalAsset,
        dto.amount,
      );
      validation = await this.tokenService.validateWithdrawal(
        dto.asset as "NEAR" | "USDT" | "USDC",
        dto.destinationAddress,
      );
    }

    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const sourceAddress =
      resolvedChain === Chain.BASE ? user.baseAddress! : user.nearAccountId!;

    const transaction = await this.transactionModel.create({
      type: TransactionType.WITHDRAWAL,
      status: TransactionStatus.PENDING,
      userId: new Types.ObjectId(userId),
      amount: dto.amount,
      currency: Currency[dto.asset as keyof typeof Currency],
      chain: resolvedChain,
      nearAccountId:
        resolvedChain === Chain.NEAR ? dto.destinationAddress : undefined,
      baseAddress:
        resolvedChain === Chain.BASE ? dto.destinationAddress : undefined,
      metadata: {
        idempotencyKey,
        sourceAddress,
        destinationAddress: dto.destinationAddress,
        requiresStorageDeposit: validation.requiresStorageDeposit,
      },
    });

    this.logger.log(
      `Created PENDING withdrawal transaction ${transaction._id} for user ${userId} on ${resolvedChain}`,
    );

    const jobData: WithdrawalJobData = {
      transactionId: transaction._id.toString(),
      userId,
      chain: resolvedChain,
      userNearAccountId:
        resolvedChain === Chain.NEAR ? user.nearAccountId : undefined,
      userBaseAddress:
        resolvedChain === Chain.BASE ? user.baseAddress : undefined,
      destinationAddress: dto.destinationAddress,
      amount: dto.amount,
      asset: dto.asset,
      idempotencyKey,
      requiresStorageDeposit: validation.requiresStorageDeposit,
    };

    await this.withdrawalQueue.add("process-withdrawal", jobData, {
      ...WITHDRAWAL_JOB_OPTIONS,
      jobId: existingJobId,
    });

    this.logger.log(
      `Queued withdrawal job ${existingJobId} for transaction ${transaction._id}`,
    );

    return {
      transactionId: transaction._id.toString(),
      status: "PENDING",
      message:
        "Withdrawal request submitted. You will receive a confirmation once it's processed.",
    };
  }

  private async verifyWithdrawalOtp(
    email: string,
    otp: string,
    deviceId: string,
    asset: string,
    amount: string,
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const key = `${WITHDRAWAL_OTP_PREFIX}${normalizedEmail}`;
    const attemptsKey = `${WITHDRAWAL_OTP_PREFIX}attempts:${normalizedEmail}`;

    const attempts = await this.cacheManager.get<number>(attemptsKey);
    if (attempts && attempts >= WITHDRAWAL_OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(
        "Too many failed attempts. Please request a new verification code.",
      );
    }

    const otpData = await this.cacheManager.get<WithdrawalOtpData>(key);

    if (!otpData) {
      throw new BadRequestException(
        "Verification code expired or not found. Please request a new one.",
      );
    }

    if (Date.now() > otpData.expiresAt) {
      await this.cacheManager.del(key);
      throw new BadRequestException(
        "Verification code has expired. Please request a new one.",
      );
    }

    if (otpData.asset !== asset || otpData.amount !== amount) {
      throw new BadRequestException(
        "Verification code was issued for a different withdrawal. Please request a new code.",
      );
    }

    if (otpData.deviceId !== deviceId) {
      this.logger.warn(
        `Device mismatch for withdrawal OTP: ${email}. Expected: ${otpData.deviceId}, Got: ${deviceId}`,
      );
      throw new BadRequestException(
        "Please verify from the same device you requested the code from.",
      );
    }

    if (otpData.otp !== otp) {
      const newAttempts = (attempts || 0) + 1;
      await this.cacheManager.set(attemptsKey, newAttempts, 1800 * 1000); // 30 min lockout

      const remaining = WITHDRAWAL_OTP_MAX_ATTEMPTS - newAttempts;
      if (remaining <= 0) {
        await this.cacheManager.del(key);
        throw new BadRequestException(
          "Too many failed attempts. Please request a new verification code.",
        );
      }

      throw new BadRequestException(
        `Invalid verification code. ${remaining} attempt(s) remaining.`,
      );
    }

    await this.cacheManager.del(key);
    await this.cacheManager.del(attemptsKey);
  }

  private validateWithdrawalAmount(
    amount: string,
    asset: WithdrawalAsset,
  ): void {
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      throw new BadRequestException("Invalid withdrawal amount");
    }

    const minAmount = MIN_WITHDRAWAL_AMOUNTS[asset];
    const maxAmount = MAX_WITHDRAWAL_AMOUNTS[asset];

    if (numAmount < minAmount) {
      throw new BadRequestException(
        `Minimum withdrawal amount for ${asset} is ${minAmount}`,
      );
    }

    if (numAmount > maxAmount) {
      throw new BadRequestException(
        `Maximum withdrawal amount for ${asset} is ${maxAmount} per transaction`,
      );
    }
  }

  private async checkAvailableBalance(
    nearAccountId: string,
    asset: WithdrawalAsset,
    amount: string,
  ): Promise<void> {
    const numAmount = parseFloat(amount);

    if (asset === "NEAR") {
      const balance =
        await this.nearAccountService.getAccountBalance(nearAccountId);
      const availableBalance = parseFloat(balance.available || "0");

      if (availableBalance < numAmount + 0.01) {
        throw new BadRequestException(
          `Insufficient NEAR balance. Available: ${availableBalance.toFixed(
            4,
          )} NEAR`,
        );
      }
    } else {
      const tokenBalance = await this.nearAccountService.getTokenBalance(
        nearAccountId,
        asset,
      );
      const availableBalance = parseFloat(tokenBalance);

      if (availableBalance < numAmount) {
        throw new BadRequestException(
          `Insufficient ${asset} balance. Available: ${availableBalance.toFixed(
            2,
          )} ${asset}`,
        );
      }

      const nearBalance =
        await this.nearAccountService.getAccountBalance(nearAccountId);
      const availableNear = parseFloat(nearBalance.available || "0");

      if (availableNear < 0.01) {
        throw new BadRequestException(
          `Insufficient NEAR for transaction fees. Please deposit at least 0.01 NEAR.`,
        );
      }
    }
  }

  private async checkAvailableBalanceBase(
    baseAddress: string,
    asset: WithdrawalAsset,
    amount: string,
  ): Promise<void> {
    const numAmount = parseFloat(amount);

    if (asset === "ETH") {
      const balance = await this.baseAccountService.getBalance(baseAddress);
      const availableBalance = parseFloat(balance);

      if (availableBalance < numAmount + 0.0005) {
        throw new BadRequestException(
          `Insufficient ETH balance. Available: ${availableBalance.toFixed(6)} ETH`,
        );
      }
    } else {
      const tokenBalance = await this.baseAccountService.getTokenBalance(
        baseAddress,
        this.baseTokenService.getTokenContractAddress(asset as "CNGN" | "USDC"),
      );
      const availableBalance = parseFloat(tokenBalance);

      if (availableBalance < numAmount) {
        throw new BadRequestException(
          `Insufficient ${asset} balance. Available: ${availableBalance.toFixed(2)} ${asset}`,
        );
      }

      // Check ETH for gas
      const ethBalance = await this.baseAccountService.getBalance(baseAddress);
      if (parseFloat(ethBalance) < 0.0005) {
        throw new BadRequestException(
          "Insufficient ETH for transaction fees. Please deposit some ETH for gas.",
        );
      }
    }
  }

  private async sendWithdrawalOtpEmail(
    email: string,
    firstName: string,
    otp: string,
    amount: string,
    asset: string,
  ): Promise<void> {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY || "");

      await resend.emails.send({
        from: "Etibé <noreply@dolphtech.org>",
        to: email,
        subject: `${otp} - Withdrawal Verification Code`,
        html: this.getWithdrawalOtpEmailTemplate({
          firstName,
          otp,
          amount,
          asset,
          expiryMinutes: Math.floor(WITHDRAWAL_OTP_EXPIRY_SECONDS / 60),
          year: new Date().getFullYear(),
        }),
      });

      this.logger.log(`Withdrawal OTP email sent to ${email}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to send withdrawal OTP email: ${error.message}`,
      );
      throw new BadRequestException(
        "Failed to send verification email. Please try again.",
      );
    }
  }

  private getWithdrawalOtpEmailTemplate(data: {
    firstName: string;
    otp: string;
    amount: string;
    asset: string;
    expiryMinutes: number;
    year: number;
  }): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Withdrawal Verification - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">
                Etibé
              </div>
              <div style="font-size: 13px; color: #666666; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase;">
                Withdrawal Verification
              </div>
            </td>
          </tr>
          
          <!-- Message -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #111827; line-height: 1.3;">
                Confirm Your Withdrawal 💸
              </h1>
              <p style="margin: 0; font-size: 16px; color: #111827; line-height: 1.6;">
                Hi ${data.firstName},<br><br>
                You requested to withdraw <strong>${data.amount} ${data.asset}</strong> from your Etibé wallet. Enter this code to authorize the transaction:
              </p>
            </td>
          </tr>
          
          <!-- OTP Card -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #FF6B6B 0%, #EE5A5A 100%); border-radius: 12px; padding: 32px; text-align: center;">
                <div style="font-size: 13px; color: rgba(255, 255, 255, 0.9); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 2px;">
                  Verification Code
                </div>
                <div style="font-size: 42px; font-weight: 700; color: #FFFFFF; letter-spacing: 8px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;">
                  ${data.otp}
                </div>
              </div>
            </td>
          </tr>
          
          <!-- Warning Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #FEF3CD; border-radius: 8px; padding: 16px; border-left: 4px solid #FFC107;">
                <p style="margin: 0; font-size: 14px; color: #111827;">
                  ⚠️ <strong>Security Warning:</strong> This code expires in <strong>${data.expiryMinutes} minutes</strong>. Never share this code with anyone. Etibé will never ask you for this code.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Didn't Request -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                <strong>Didn't request this?</strong> If you didn't initiate this withdrawal, please ignore this email and secure your account immediately by changing your password.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                Sent with ❤️ from Etibé
              </p>
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © ${data.year} Etibé. Built on NEAR Protocol.<br>
                Lagos, Nigeria
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  async getWithdrawalHistory(
    userId: string,
    options?: { asset?: string; page?: number; limit?: number },
  ): Promise<{
    withdrawals: TransactionDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = options?.page || 1;
    const limit = Math.min(options?.limit || 20, 50);
    const skip = (page - 1) * limit;

    const filter: any = {
      userId: new Types.ObjectId(userId),
      type: TransactionType.WITHDRAWAL,
    };

    if (options?.asset) {
      filter.currency = options.asset;
    }

    const [withdrawals, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    return {
      withdrawals: withdrawals as TransactionDocument[],
      total,
      page,
      limit,
    };
  }

  async getWithdrawalById(
    userId: string,
    transactionId: string,
  ): Promise<TransactionDocument | null> {
    return this.transactionModel
      .findOne({
        _id: new Types.ObjectId(transactionId),
        userId: new Types.ObjectId(userId),
        type: TransactionType.WITHDRAWAL,
      })
      .lean()
      .exec() as Promise<TransactionDocument | null>;
  }
}
