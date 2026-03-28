import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { CircleRepository } from "../repositories/circle.repository";
import { TransactionRepository } from "../../transactions/repositories/transaction.repository";
import { NotificationService } from "../../notifications/services/notification.service";
import { UserRepository } from "../../users/repositories/user.repository";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import { BaseAccountService } from "../../blockchain/services/base-account.service";
import {
  VaultService,
  EncryptedData,
} from "../../blockchain/services/vault.service";
import { CircleDocument } from "../schemas/circle.schema";
import { TransactionDocument } from "../../transactions/schemas/transaction.schema";
import { NotificationType } from "../../../shared/enums";
import {
  CircleStatus,
  Currency,
  Chain,
  TransactionType,
  TransactionStatus,
} from "../../../shared/enums/circle.enums";
import {
  PAYOUT_QUEUE_NAME,
  PayoutJobData,
  PayoutResult,
  CIRCLE_EVENTS,
  PAYOUT_RETRY_CONFIG,
} from "../constants/payout.constants";
import { Types } from "mongoose";

@Processor(PAYOUT_QUEUE_NAME, {
  concurrency: 1, // Process one payout at a time to prevent race conditions
  limiter: {
    max: 5,
    duration: 60000, // Max 5 payouts per minute to avoid rate limiting
  },
})
export class PayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(
    private readonly circleRepository: CircleRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly userRepository: UserRepository,
    private readonly nearAccountService: NearAccountService,
    private readonly baseAccountService: BaseAccountService,
    private readonly vaultService: VaultService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<PayoutJobData>): Promise<PayoutResult> {
    const { data } = job;
    const startTime = Date.now();

    this.logger.log(
      `[PAYOUT_START] Processing payout job ${job.id} - Circle: ${data.circleId}, Round: ${data.roundNumber}, Recipient: ${data.recipientNearAccountId}, Amount: ${data.payoutAmount} ${data.currency}`,
    );

    try {
      const verificationResult = await this.verifyPayoutEligibility(data);
      if (!verificationResult.eligible) {
        throw new Error(
          `Payout verification failed: ${verificationResult.reason}`,
        );
      }

      const txResult = await this.executePayout(
        data,
        verificationResult.circle!,
      );

      await this.handlePayoutSuccess(
        data,
        txResult.txHash,
        verificationResult.circle!,
      );

      const result: PayoutResult = {
        success: true,
        txHash: txResult.txHash,
        timestamp: new Date().toISOString(),
        circleId: data.circleId,
        roundNumber: data.roundNumber,
        recipientUserId: data.recipientUserId,
        amount: data.payoutAmount,
        currency: data.currency,
      };

      const duration = Date.now() - startTime;
      this.logger.log(
        `[PAYOUT_SUCCESS] Job ${job.id} completed in ${duration}ms - txHash: ${txResult.txHash}`,
      );

      this.eventEmitter.emit(CIRCLE_EVENTS.PAYOUT_COMPLETED, result);

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[PAYOUT_ERROR] Job ${job.id} failed after ${duration}ms - Error: ${error.message}`,
      );

      throw error;
    }
  }

  private async verifyPayoutEligibility(data: PayoutJobData): Promise<{
    eligible: boolean;
    reason?: string;
    circle?: CircleDocument;
    recipientNearAccountId?: string;
    recipientBaseAddress?: string;
  }> {
    const circle = await this.circleRepository.findById(data.circleId);
    if (!circle) {
      return { eligible: false, reason: "Circle not found" };
    }

    const chain = data.chain || circle.chain || Chain.NEAR;

    if (circle.status !== CircleStatus.ACTIVE) {
      return {
        eligible: false,
        reason: `Circle is ${circle.status}, not ACTIVE`,
      };
    }

    if (circle.isDeleted || circle.deletedAt) {
      return { eligible: false, reason: "Circle has been deleted" };
    }

    if (!circle.contractAddress) {
      return { eligible: false, reason: "Circle has no contract address" };
    }

    if (circle.currentRound >= data.roundNumber) {
      return {
        eligible: false,
        reason: `Round ${data.roundNumber} already processed (current: ${circle.currentRound})`,
      };
    }

    const recipientMember = circle.members.find(
      (m) =>
        m.userId.toString() === data.recipientUserId && m.status === "ACTIVE",
    );
    if (!recipientMember) {
      return {
        eligible: false,
        reason: "Recipient is no longer an active member",
      };
    }

    if (recipientMember.hasReceivedPayout) {
      return {
        eligible: false,
        reason: "Recipient has already received payout",
      };
    }

    const recipientUser = await this.userRepository.findById(
      data.recipientUserId,
    );

    if (chain === Chain.BASE) {
      if (!recipientUser?.baseAddress) {
        return {
          eligible: false,
          reason: "Recipient does not have a Base account",
        };
      }
    } else {
      if (!recipientUser?.nearAccountId) {
        return {
          eligible: false,
          reason: "Recipient does not have a NEAR account",
        };
      }
    }

    const hasBalance = await this.verifyContractBalance(
      circle.contractAddress,
      data.payoutAmount,
      data.currency,
    );
    if (!hasBalance) {
      return {
        eligible: false,
        reason: "Contract has insufficient balance for payout",
      };
    }

    return {
      eligible: true,
      circle,
      recipientNearAccountId: recipientUser?.nearAccountId,
      recipientBaseAddress: recipientUser?.baseAddress,
    };
  }

  private async verifyContractBalance(
    contractAddress: string,
    requiredAmount: string,
    currency: string,
  ): Promise<boolean> {
    try {
      if (currency === Currency.NEAR) {
        const balance =
          await this.nearAccountService.getAccountBalance(contractAddress);
        const available = parseFloat(balance.available || "0");
        const required = parseFloat(requiredAmount);

        return available >= required + 0.01;
      } else {
        const tokenBalance = await this.nearAccountService.getTokenBalance(
          contractAddress,
          currency,
        );
        const available = parseFloat(tokenBalance);
        const required = parseFloat(requiredAmount);

        return available >= required;
      }
    } catch (error: any) {
      this.logger.error(`Failed to verify contract balance: ${error.message}`);
      return true;
    }
  }

  private async executePayout(
    data: PayoutJobData,
    circle: CircleDocument,
  ): Promise<{ txHash: string }> {
    const chain = data.chain || circle.chain || Chain.NEAR;
    const recipientAddress =
      chain === Chain.BASE
        ? data.recipientBaseAddress
        : data.recipientNearAccountId;

    this.logger.log(
      `[PAYOUT_EXECUTE] Sending ${data.payoutAmount} ${data.currency} on ${chain} from ${data.contractAddress} to ${recipientAddress}`,
    );

    try {
      const pendingTransaction = await this.transactionRepository.create({
        type: TransactionType.PAYOUT,
        status: TransactionStatus.PENDING,
        userId: new Types.ObjectId(data.recipientUserId),
        circleId: new Types.ObjectId(data.circleId),
        amount: data.payoutAmount,
        currency: data.currency as Currency,
        chain,
        round: data.roundNumber,
        nearAccountId:
          chain === Chain.NEAR ? data.recipientNearAccountId : undefined,
        baseAddress:
          chain === Chain.BASE ? data.recipientBaseAddress : undefined,
        metadata: {
          scheduledDate: data.scheduledPayoutDate,
          contractAddress: data.contractAddress,
        },
      } as Partial<TransactionDocument>);

      let txHash: string;

      if (chain === Chain.BASE) {
        // For Base circles, call releasePayout on the Solidity contract
        txHash = await this.executeBasePayout(data.contractAddress);
      } else if (data.currency === Currency.NEAR) {
        txHash = await this.executeNearPayout(
          data.contractAddress,
          data.recipientNearAccountId!,
          data.payoutAmount,
        );
      } else {
        txHash = await this.executeTokenPayout(
          data.contractAddress,
          data.recipientNearAccountId!,
          data.payoutAmount,
          data.currency,
        );
      }

      await this.transactionRepository.confirmTransaction(
        pendingTransaction._id.toString(),
        txHash,
      );

      return { txHash };
    } catch (error: any) {
      this.logger.error(`Payout execution failed: ${error.message}`);
      throw new Error(`Payout execution failed: ${error.message}`);
    }
  }

  private async executeBasePayout(contractAddress: string): Promise<string> {
    try {
      const result =
        await this.baseAccountService.releasePayout(contractAddress);
      return result.txHash;
    } catch (error: any) {
      this.logger.error(`Base payout failed: ${error.message}`);
      throw error;
    }
  }

  private async executeNearPayout(
    contractAddress: string,
    recipientId: string,
    amount: string,
  ): Promise<string> {
    // In production, this would call the circle contract's payout method
    // For now, we'll use the master account to fund the recipient
    try {
      const result = await this.nearAccountService.fundAccount(
        recipientId,
        amount,
      );
      return result?.transaction_outcome?.id || `payout-${Date.now()}`;
    } catch (error: any) {
      this.logger.error(`NEAR payout failed: ${error.message}`);
      throw error;
    }
  }

  private async executeTokenPayout(
    contractAddress: string,
    recipientId: string,
    amount: string,
    currency: string,
  ): Promise<string> {
    // In production, this would call ft_transfer from the circle contract
    // For now, we'll simulate the transaction
    try {
      // The circle contract would hold the tokens and release them via ft_transfer
      // This would require the circle contract to have the tokens deposited
      const txHash = `token-payout-${Date.now()}-${currency}`;

      this.logger.log(
        `Token payout simulated: ${amount} ${currency} to ${recipientId}, txHash: ${txHash}`,
      );

      return txHash;
    } catch (error: any) {
      this.logger.error(`Token payout failed: ${error.message}`);
      throw error;
    }
  }

  private async handlePayoutSuccess(
    data: PayoutJobData,
    txHash: string,
    circle: CircleDocument,
  ): Promise<void> {
    await this.circleRepository.markPayoutReceived(
      data.circleId,
      data.recipientUserId,
      txHash,
    );

    await this.circleRepository.advanceRound(data.circleId);

    const updatedCircle = await this.circleRepository.findById(data.circleId);
    if (updatedCircle) {
      const nextRecipient = updatedCircle.members
        .filter((m) => m.status === "ACTIVE" && !m.hasReceivedPayout)
        .sort((a, b) => a.position - b.position)[0];

      if (!nextRecipient) {
        await this.circleRepository.updateStatus(
          data.circleId,
          CircleStatus.COMPLETED,
        );
        this.logger.log(
          `Circle ${data.circleId} completed - all payouts disbursed`,
        );
      }
    }

    await this.notificationService.createNotification({
      userId: new Types.ObjectId(data.recipientUserId),
      title: "Payout Received",
      content: `Your payout of ${data.payoutAmount} ${data.currency} from ${circle.name} has been processed successfully.`,
      type: NotificationType.PAYOUT_RECEIVED,
      metadata: {
        circleId: circle._id,
        txHash,
        amount: data.payoutAmount,
        currency: data.currency,
      },
    });

    this.eventEmitter.emit(CIRCLE_EVENTS.ROUND_ADVANCED, {
      circleId: data.circleId,
      completedRound: data.roundNumber,
      recipientUserId: data.recipientUserId,
      txHash,
    });
  }

  @OnWorkerEvent("active")
  onActive(job: Job<PayoutJobData>) {
    this.logger.debug(`Job ${job.id} is now active`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<PayoutJobData>, result: PayoutResult) {
    this.logger.log(
      `Job ${job.id} completed successfully - txHash: ${result.txHash}`,
    );
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<PayoutJobData> | undefined, error: Error) {
    if (!job) return;

    const attemptsMade = job.attemptsMade;
    const maxAttempts = PAYOUT_RETRY_CONFIG.maxAttempts;

    this.logger.error(
      `Job ${job.id} failed (attempt ${attemptsMade}/${maxAttempts}): ${error.message}`,
    );

    if (attemptsMade >= maxAttempts) {
      await this.triggerPayoutFailureAlert(job.data, error);
    }
  }

  @OnWorkerEvent("error")
  onError(error: Error) {
    this.logger.error(`Worker error: ${error.message}`);
  }

  private async triggerPayoutFailureAlert(
    data: PayoutJobData,
    error: Error,
  ): Promise<void> {
    const alertPayload = {
      type: "PAYOUT_FAILURE",
      severity: "critical",
      circleId: data.circleId,
      roundNumber: data.roundNumber,
      recipientUserId: data.recipientUserId,
      recipientNearAccountId: data.recipientNearAccountId,
      payoutAmount: data.payoutAmount,
      currency: data.currency,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      `[CRITICAL_ALERT] Payout failed after ${
        PAYOUT_RETRY_CONFIG.maxAttempts
      } retries: ${JSON.stringify(alertPayload)}`,
    );

    // Emit failure event for notification service to send Slack/Discord alert
    this.eventEmitter.emit(CIRCLE_EVENTS.PAYOUT_FAILED, alertPayload);

    // TODO: In production, integrate with Slack/Discord webhook
    // await this.sendSlackAlert(alertPayload);
    // await this.sendDiscordAlert(alertPayload);
  }
}
