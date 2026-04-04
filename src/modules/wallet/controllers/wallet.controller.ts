import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { WalletService } from "../services/wallet.service";
import {
  WithdrawDto,
  WithdrawResponseDto,
  RequestWithdrawalOtpDto,
  WithdrawalHistoryQueryDto,
  WithdrawalHistoryItemDto,
} from "../dto/withdraw.dto";
import { VerifiedUserGuard } from "../../circles/guards/verified-user.guard";
import { CurrentUser, CurrentUserId } from "../../auth/decorators";
import { AuthenticatedUser } from "../../../shared/types/session.types";
import { APP_CONSTANTS } from "../../../shared/constants";

@Controller("wallet")
@UseGuards(VerifiedUserGuard)
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

  @Post("request-withdrawal-otp")
  @HttpCode(HttpStatus.OK)
  async requestWithdrawalOtp(
    @Body() dto: RequestWithdrawalOtpDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(APP_CONSTANTS.DEVICE_ID_HEADER) deviceId: string
  ): Promise<{ success: boolean; message: string }> {
    if (!deviceId) {
      throw new BadRequestException("Device ID header is required");
    }

    if (!user.nearAccountId && !user.baseAddress) {
      throw new BadRequestException(
        "Wallet not set up. Please complete onboarding.",
      );
    }

    const result = await this.walletService.requestWithdrawalOtp(
      user.id,
      deviceId,
      dto.asset,
      dto.amount
    );

    this.logger.log(
      `Withdrawal OTP requested - User: ${user.id}, Amount: ${dto.amount} ${dto.asset}`
    );

    return result;
  }

  @Post("withdraw")
  @HttpCode(HttpStatus.ACCEPTED)
  async withdraw(
    @Body() dto: WithdrawDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(APP_CONSTANTS.DEVICE_ID_HEADER) deviceId: string,
    @Headers("x-idempotency-key") idempotencyKey: string
  ): Promise<WithdrawResponseDto> {
    if (!deviceId) {
      throw new BadRequestException("Device ID header is required");
    }

    if (!idempotencyKey) {
      throw new BadRequestException(
        "Idempotency key header (x-idempotency-key) is required to prevent double-spending"
      );
    }

    if (idempotencyKey.length < 16 || idempotencyKey.length > 64) {
      throw new BadRequestException(
        "Idempotency key must be between 16 and 64 characters"
      );
    }

    if (!user.nearAccountId && !user.baseAddress) {
      throw new BadRequestException(
        "Wallet not set up. Please complete onboarding.",
      );
    }

    const result = await this.walletService.processWithdrawal(
      user.id,
      deviceId,
      dto,
      idempotencyKey
    );

    this.logger.log(
      `Withdrawal request accepted - User: ${user.id}, TxId: ${result.transactionId}, Amount: ${dto.amount} ${dto.asset} -> ${dto.destinationAddress}`
    );

    return {
      message: result.message,
      transactionId: result.transactionId,
      status: result.status,
      estimatedCompletionTime: "1-3 seconds",
    };
  }

  @Get("withdrawals")
  async getWithdrawalHistory(
    @CurrentUserId() userId: string,
    @Query() query: WithdrawalHistoryQueryDto
  ): Promise<{
    data: WithdrawalHistoryItemDto[];
    meta: { total: number; page: number; limit: number };
  }> {
    const result = await this.walletService.getWithdrawalHistory(userId, {
      asset: query.asset,
      page: query.page,
      limit: query.limit,
    });

    const data: WithdrawalHistoryItemDto[] = result.withdrawals.map((tx) => ({
      id: tx._id.toString(),
      amount: tx.amount,
      asset: tx.currency,
      destinationAddress: tx.nearAccountId || "",
      status: tx.status,
      transactionHash: tx.transactionHash,
      failureReason: tx.failureReason,
      createdAt: tx.createdAt,
      confirmedAt: tx.confirmedAt,
    }));

    return {
      data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  @Get("withdrawals/:id")
  async getWithdrawalById(
    @Param("id") transactionId: string,
    @CurrentUserId() userId: string
  ): Promise<{ data: WithdrawalHistoryItemDto | null }> {
    const tx = await this.walletService.getWithdrawalById(
      userId,
      transactionId
    );

    if (!tx) {
      return { data: null };
    }

    return {
      data: {
        id: tx._id.toString(),
        amount: tx.amount,
        asset: tx.currency,
        destinationAddress: tx.nearAccountId || "",
        status: tx.status,
        transactionHash: tx.transactionHash,
        failureReason: tx.failureReason,
        createdAt: tx.createdAt,
        confirmedAt: tx.confirmedAt,
      },
    };
  }
}
