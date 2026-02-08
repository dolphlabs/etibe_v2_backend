import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { providers, transactions, utils, KeyPair } from "near-api-js";
import { ConfigService } from "@nestjs/config";
import sha256 from "js-sha256";

import { User, UserDocument } from "../../users/schemas/user.schema";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import {
  VaultService,
  EncryptedData,
} from "../../blockchain/services/vault.service";
import { TokenService } from "../../blockchain/services/token.service";
import {
  WITHDRAWAL_QUEUE_NAME,
  WithdrawalJobData,
  WithdrawalResult,
  WITHDRAWAL_EVENTS,
  WITHDRAWAL_RETRY_CONFIG,
  ASSET_DECIMALS,
} from "../constants/withdrawal.constants";
import {
  TransactionType,
  TransactionStatus,
  Currency,
} from "../../../shared/enums/circle.enums";
import { Transaction, TransactionDocument } from "@modules/transactions";

@Processor(WITHDRAWAL_QUEUE_NAME, {
  concurrency: 2,
  limiter: {
    max: 10,
    duration: 60000,
  },
})
export class WithdrawalProcessor extends WorkerHost {
  private readonly logger = new Logger(WithdrawalProcessor.name);
  private provider!: InstanceType<typeof providers.JsonRpcProvider>;
  private readonly networkId: string;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly nearAccountService: NearAccountService,
    private readonly vaultService: VaultService,
    private readonly tokenService: TokenService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {
    super();

    this.networkId = this.configService.get<string>(
      "near.networkId",
      "testnet",
    );

    const nodeUrl = this.configService.get<string>(
      "near.nodeUrl",
      this.networkId === "mainnet"
        ? "https://rpc.mainnet.near.org"
        : "https://rpc.testnet.near.org",
    );

    this.provider = new providers.JsonRpcProvider({ url: nodeUrl });
  }

  async process(job: Job<WithdrawalJobData>): Promise<WithdrawalResult> {
    const { data } = job;
    const startTime = Date.now();

    this.logger.log(
      `[WITHDRAWAL_START] Processing job ${job.id} - User: ${data.userId}, Amount: ${data.amount} ${data.asset} -> ${data.destinationAddress}`,
    );

    // Emit processing event for WebSocket
    this.eventEmitter.emit(WITHDRAWAL_EVENTS.WITHDRAWAL_PROCESSING, {
      transactionId: data.transactionId,
      userId: data.userId,
      status: "PROCESSING",
    });

    try {
      const user = await this.getUserWithPrivateKey(data.userId);
      if (!user || !user.nearEncryptedPrivateKey) {
        throw new Error("User wallet not found or not configured");
      }

      const transaction = await this.transactionModel.findById(
        data.transactionId,
      );
      if (!transaction) {
        throw new Error("Transaction record not found");
      }
      if (transaction.status !== TransactionStatus.PENDING) {
        throw new Error(`Transaction is already ${transaction.status}`);
      }

      const txHash = await this.executeWithdrawal(user, data);

      await this.transactionModel.findByIdAndUpdate(data.transactionId, {
        status: TransactionStatus.CONFIRMED,
        transactionHash: txHash,
        confirmedAt: new Date(),
      });

      const result: WithdrawalResult = {
        success: true,
        txHash,
        timestamp: new Date().toISOString(),
        transactionId: data.transactionId,
        userId: data.userId,
        amount: data.amount,
        asset: data.asset,
        destinationAddress: data.destinationAddress,
      };

      const duration = Date.now() - startTime;
      this.logger.log(
        `[WITHDRAWAL_SUCCESS] Job ${job.id} completed in ${duration}ms - txHash: ${txHash}`,
      );

      // Emit success event for WebSocket/notifications
      this.eventEmitter.emit(WITHDRAWAL_EVENTS.WITHDRAWAL_COMPLETED, result);

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[WITHDRAWAL_ERROR] Job ${job.id} failed after ${duration}ms - Error: ${error.message}`,
      );

      // Update transaction status to FAILED
      await this.transactionModel.findByIdAndUpdate(data.transactionId, {
        status: TransactionStatus.FAILED,
        failureReason: error.message,
      });

      throw error;
    }
  }

  private async getUserWithPrivateKey(
    userId: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findById(userId)
      .select("+nearEncryptedPrivateKey")
      .lean()
      .exec() as Promise<UserDocument | null>;
  }

  private async executeWithdrawal(
    user: UserDocument,
    data: WithdrawalJobData,
  ): Promise<string> {
    const { asset, amount, destinationAddress, requiresStorageDeposit } = data;

    const userKeyPair = this.nearAccountService.decryptAndGetKeyPair(
      user.nearEncryptedPrivateKey as EncryptedData,
    );
    const userPublicKey = userKeyPair.getPublicKey();

    const accessKeyResponse = await this.provider.query({
      request_type: "view_access_key",
      finality: "final",
      account_id: user.nearAccountId!,
      public_key: userPublicKey.toString(),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonce = (accessKeyResponse as any).nonce + 1;
    const status = await this.provider.status();
    const blockHash = utils.serialize.base_decode(
      status.sync_info.latest_block_hash,
    );

    let receiverId: string;
    let actions: ReturnType<typeof transactions.transfer>[];

    if (asset === "NEAR") {
      receiverId = destinationAddress;
      const atomicAmount = this.tokenService.toAtomicUnits(amount, "NEAR");
      actions = [this.tokenService.buildNearTransferAction(atomicAmount)];

      this.logger.log(
        `Executing NEAR transfer: ${amount} NEAR (${atomicAmount} yoctoNEAR) to ${destinationAddress}`,
      );
    } else {
      const tokenContractId = this.tokenService.getTokenContractId(asset);
      receiverId = tokenContractId;
      const atomicAmount = this.tokenService.toAtomicUnits(amount, asset);

      actions = this.tokenService.buildTokenTransferActions({
        tokenContractId,
        senderId: user.nearAccountId!,
        receiverId: destinationAddress,
        amount: atomicAmount,
        memo: `Etibé withdrawal - ${data.transactionId}`,
        requiresStorageDeposit: requiresStorageDeposit || false,
      });

      this.logger.log(
        `Executing ${asset} transfer: ${amount} (${atomicAmount} atomic) to ${destinationAddress}${
          requiresStorageDeposit ? " (with storage deposit)" : ""
        }`,
      );
    }

    const transaction = transactions.createTransaction(
      user.nearAccountId!,
      userPublicKey,
      receiverId,
      nonce,
      actions,
      blockHash,
    );

    const serializedTx = utils.serialize.serialize(
      transactions.SCHEMA.Transaction,
      transaction,
    );

    const hash = new Uint8Array(sha256.sha256.array(serializedTx));
    const signature = userKeyPair.sign(hash);

    const signedTransaction = new transactions.SignedTransaction({
      transaction,
      signature: new transactions.Signature({
        keyType: userPublicKey.keyType,
        data: signature.signature,
      }),
    });

    const result = await this.provider.sendTransaction(signedTransaction);

    if (
      result.status &&
      typeof result.status === "object" &&
      "SuccessValue" in result.status
    ) {
      return result.transaction_outcome.id;
    }

    if (
      result.status &&
      typeof result.status === "object" &&
      "Failure" in result.status
    ) {
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(result.status)}`,
      );
    }

    return result.transaction_outcome.id;
  }

  @OnWorkerEvent("active")
  onActive(job: Job<WithdrawalJobData>) {
    this.logger.debug(`Withdrawal job ${job.id} is now active`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<WithdrawalJobData>, result: WithdrawalResult) {
    this.logger.log(
      `Withdrawal job ${job.id} completed successfully - txHash: ${result.txHash}`,
    );
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<WithdrawalJobData> | undefined, error: Error) {
    if (!job) return;

    const attemptsMade = job.attemptsMade;
    const maxAttempts = WITHDRAWAL_RETRY_CONFIG.maxAttempts;

    this.logger.error(
      `Withdrawal job ${job.id} failed (attempt ${attemptsMade}/${maxAttempts}): ${error.message}`,
    );

    if (attemptsMade >= maxAttempts) {
      await this.triggerWithdrawalFailureAlert(job.data, error);
    }
  }

  @OnWorkerEvent("error")
  onError(error: Error) {
    this.logger.error(`Withdrawal worker error: ${error.message}`);
  }

  private async triggerWithdrawalFailureAlert(
    data: WithdrawalJobData,
    error: Error,
  ): Promise<void> {
    const alertPayload = {
      type: "WITHDRAWAL_FAILURE",
      severity: "critical",
      transactionId: data.transactionId,
      userId: data.userId,
      userNearAccountId: data.userNearAccountId,
      destinationAddress: data.destinationAddress,
      amount: data.amount,
      asset: data.asset,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      `[CRITICAL_ALERT] Withdrawal failed after ${
        WITHDRAWAL_RETRY_CONFIG.maxAttempts
      } retries: ${JSON.stringify(alertPayload)}`,
    );

    // Emit failure event for notification service
    this.eventEmitter.emit(WITHDRAWAL_EVENTS.WITHDRAWAL_FAILED, alertPayload);
  }
}
