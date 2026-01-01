import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { providers } from "near-api-js";

export interface CircleContractState {
  name: string;
  creator: string;
  contributionAmount: string;
  currency: string;
  maxMembers: number;
  currentRound: number;
  totalRounds: number;
  members: string[];
  payoutOrder: string[];
  gracePeriodDays: number;
  isActive: boolean;
  totalContributed: string;
  nextPayoutRecipient?: string;
}

export interface ContributionVerification {
  isValid: boolean;
  transactionHash: string;
  senderId: string;
  receiverId: string;
  amount: string;
  blockTimestamp: number;
  methodName?: string;
}

@Injectable()
export class NearService implements OnModuleInit {
  private readonly logger = new Logger(NearService.name);
  private provider!: InstanceType<typeof providers.JsonRpcProvider>;
  private readonly networkId: string;
  private readonly nodeUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.networkId = this.configService.get<string>(
      "near.networkId",
      "testnet"
    );
    this.nodeUrl = this.configService.get<string>(
      "near.nodeUrl",
      "https://rpc.testnet.near.org"
    );
  }

  async onModuleInit(): Promise<void> {
    await this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      this.provider = new providers.JsonRpcProvider({ url: this.nodeUrl });

      this.logger.log(`NEAR provider initialized on ${this.networkId} network`);
    } catch (error) {
      this.logger.error("Failed to initialize NEAR provider", error);
      throw error;
    }
  }

  async verifyContribution(
    transactionHash: string,
    expectedReceiver: string,
    expectedAmount: string
  ): Promise<ContributionVerification> {
    try {
      const txResult = await this.provider.txStatus(
        transactionHash,
        expectedReceiver,
        "FINAL"
      );

      if (!txResult || !txResult.transaction) {
        return {
          isValid: false,
          transactionHash,
          senderId: "",
          receiverId: "",
          amount: "0",
          blockTimestamp: 0,
        };
      }

      const { transaction, transaction_outcome } = txResult;

      const isSuccessful =
        transaction_outcome.outcome.status &&
        typeof transaction_outcome.outcome.status === "object" &&
        "SuccessValue" in transaction_outcome.outcome.status;

      if (!isSuccessful) {
        this.logger.warn(`Transaction ${transactionHash} failed`);
        return {
          isValid: false,
          transactionHash,
          senderId: transaction.signer_id,
          receiverId: transaction.receiver_id,
          amount: "0",
          blockTimestamp: 0,
        };
      }

      let methodName: string | undefined;
      if (
        transaction.actions &&
        Array.isArray(transaction.actions) &&
        transaction.actions.length > 0
      ) {
        const action = transaction.actions[0];
        if (typeof action === "object" && "FunctionCall" in action) {
          methodName = (action as { FunctionCall: { method_name: string } })
            .FunctionCall.method_name;
        }
      }

      if (transaction.receiver_id !== expectedReceiver) {
        this.logger.warn(
          `Receiver mismatch. Expected: ${expectedReceiver}, Got: ${transaction.receiver_id}`
        );
        return {
          isValid: false,
          transactionHash,
          senderId: transaction.signer_id,
          receiverId: transaction.receiver_id,
          amount: "0",
          blockTimestamp: 0,
          methodName,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcomeBlockHash = (transaction_outcome as any).block_hash;
      const block = await this.provider.block({
        blockId: outcomeBlockHash,
      });

      const blockTimestamp = Math.floor(
        Number(block.header.timestamp) / 1_000_000
      );

      return {
        isValid: true,
        transactionHash,
        senderId: transaction.signer_id,
        receiverId: transaction.receiver_id,
        amount: expectedAmount,
        blockTimestamp,
        methodName,
      };
    } catch (error) {
      this.logger.error(
        `Failed to verify contribution ${transactionHash}`,
        error
      );
      return {
        isValid: false,
        transactionHash,
        senderId: "",
        receiverId: "",
        amount: "0",
        blockTimestamp: 0,
      };
    }
  }

  async viewCircleState(
    contractAddress: string
  ): Promise<CircleContractState | null> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: contractAddress,
        method_name: "get_circle_state",
        args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultBytes = (result as any).result;
      const resultString = Buffer.from(resultBytes).toString("utf-8");
      return JSON.parse(resultString) as CircleContractState;
    } catch (error) {
      this.logger.error(
        `Failed to view circle state for ${contractAddress}`,
        error
      );
      return null;
    }
  }

  async isValidCircleContract(contractAddress: string): Promise<boolean> {
    try {
      await this.provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: contractAddress,
      });

      const state = await this.viewCircleState(contractAddress);
      return state !== null && state.isActive;
    } catch (error) {
      this.logger.warn(
        `Contract verification failed for ${contractAddress}`,
        error
      );
      return false;
    }
  }

  async getCircleMembers(contractAddress: string): Promise<string[]> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: contractAddress,
        method_name: "get_members",
        args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultBytes = (result as any).result;
      const resultString = Buffer.from(resultBytes).toString("utf-8");
      return JSON.parse(resultString) as string[];
    } catch (error) {
      this.logger.error(`Failed to get members for ${contractAddress}`, error);
      return [];
    }
  }

  async isUserWhitelisted(
    contractAddress: string,
    nearAccountId: string
  ): Promise<boolean> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: contractAddress,
        method_name: "is_whitelisted",
        args_base64: Buffer.from(
          JSON.stringify({ account_id: nearAccountId })
        ).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultBytes = (result as any).result;
      const resultString = Buffer.from(resultBytes).toString("utf-8");
      return JSON.parse(resultString) as boolean;
    } catch (error) {
      this.logger.warn(
        `Whitelist check failed for ${nearAccountId} on ${contractAddress}`,
        error
      );
      return false;
    }
  }

  async getRoundContributions(
    contractAddress: string,
    round: number
  ): Promise<{ contributor: string; amount: string; timestamp: number }[]> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: contractAddress,
        method_name: "get_round_contributions",
        args_base64: Buffer.from(JSON.stringify({ round })).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultBytes = (result as any).result;
      const resultString = Buffer.from(resultBytes).toString("utf-8");
      return JSON.parse(resultString) as {
        contributor: string;
        amount: string;
        timestamp: number;
      }[];
    } catch (error) {
      this.logger.error(
        `Failed to get round contributions for ${contractAddress} round ${round}`,
        error
      );
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const status = await this.provider.status();
      return status.sync_info.syncing === false;
    } catch (error) {
      this.logger.error("NEAR health check failed", error);
      return false;
    }
  }

  getProvider(): InstanceType<typeof providers.JsonRpcProvider> {
    return this.provider;
  }
}
