import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { providers, transactions, utils } from "near-api-js";
import {
  ASSET_DECIMALS,
  STORAGE_DEPOSIT_AMOUNT,
  GAS_FOR_FT_TRANSFER,
  GAS_FOR_STORAGE_DEPOSIT,
} from "../../wallet/constants/withdrawal.constants";

export const TOKEN_CONTRACTS: Record<string, Record<string, string>> = {
  mainnet: {
    USDT: "usdt.tether-token.near",
    USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    // Legacy bridged USDC from Rainbow Bridge
    USDC_BRIDGED:
      "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  },
  testnet: {
    USDT: "usdt.fakes.testnet",
    USDC: "usdc.fakes.testnet",
    USDC_BRIDGED: "usdc.fakes.testnet",
  },
};

export interface TokenTransferParams {
  tokenContractId: string;
  senderId: string;
  receiverId: string;
  amount: string;
  memo?: string;
}

export interface StorageDepositResult {
  isRegistered: boolean;
  requiredDeposit?: string;
}

export interface BatchTransferParams extends TokenTransferParams {
  requiresStorageDeposit: boolean;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private provider!: InstanceType<typeof providers.JsonRpcProvider>;
  private readonly networkId: string;

  constructor(private readonly configService: ConfigService) {
    this.networkId = this.configService.get<string>(
      "near.networkId",
      "testnet"
    );

    const nodeUrl = this.configService.get<string>(
      "near.nodeUrl",
      this.networkId === "mainnet"
        ? "https://rpc.mainnet.near.org"
        : "https://rpc.testnet.near.org"
    );

    this.provider = new providers.JsonRpcProvider({ url: nodeUrl });
    this.logger.log(`TokenService initialized for network: ${this.networkId}`);
  }

  getTokenContractId(asset: "USDT" | "USDC"): string {
    const contracts =
      TOKEN_CONTRACTS[this.networkId] || TOKEN_CONTRACTS.testnet;
    return contracts[asset];
  }

  toAtomicUnits(amount: string, asset: "NEAR" | "USDT" | "USDC"): string {
    const decimals = ASSET_DECIMALS[asset];
    const [integerPart, decimalPart = ""] = amount.split(".");

    const paddedDecimal = decimalPart.padEnd(decimals, "0").slice(0, decimals);
    const atomicString = integerPart + paddedDecimal;

    return atomicString.replace(/^0+/, "") || "0";
  }

  fromAtomicUnits(
    atomicAmount: string,
    asset: "NEAR" | "USDT" | "USDC"
  ): string {
    const decimals = ASSET_DECIMALS[asset];
    const padded = atomicAmount.padStart(decimals + 1, "0");
    const integerPart = padded.slice(0, -decimals) || "0";
    const decimalPart = padded.slice(-decimals);

    const trimmedDecimal = decimalPart.replace(/0+$/, "");
    return trimmedDecimal ? `${integerPart}.${trimmedDecimal}` : integerPart;
  }

  async checkStorageDeposit(
    tokenContractId: string,
    accountId: string
  ): Promise<StorageDepositResult> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: tokenContractId,
        method_name: "storage_balance_of",
        args_base64: Buffer.from(
          JSON.stringify({ account_id: accountId })
        ).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = result as any;
      const balance = JSON.parse(Buffer.from(resultData.result).toString());

      if (balance && balance.total && BigInt(balance.total) > 0n) {
        this.logger.debug(
          `Account ${accountId} is registered for token ${tokenContractId}`
        );
        return { isRegistered: true };
      }

      this.logger.debug(
        `Account ${accountId} is NOT registered for token ${tokenContractId}`
      );
      return {
        isRegistered: false,
        requiredDeposit: STORAGE_DEPOSIT_AMOUNT,
      };
    } catch (error: any) {
      // If the query fails, assume the account is not registered
      this.logger.warn(
        `Storage balance check failed for ${accountId} on ${tokenContractId}: ${error.message}`
      );
      return {
        isRegistered: false,
        requiredDeposit: STORAGE_DEPOSIT_AMOUNT,
      };
    }
  }

  async checkAccountExists(accountId: string): Promise<boolean> {
    try {
      await this.provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });
      return true;
    } catch {
      return false;
    }
  }

  buildTokenTransferActions(
    params: BatchTransferParams
  ): ReturnType<typeof transactions.transfer>[] {
    const actions: ReturnType<typeof transactions.transfer>[] = [];

    if (params.requiresStorageDeposit) {
      const storageDepositArgs = {
        account_id: params.receiverId,
        registration_only: true,
      };

      actions.push(
        transactions.functionCall(
          "storage_deposit",
          Buffer.from(JSON.stringify(storageDepositArgs)),
          BigInt(GAS_FOR_STORAGE_DEPOSIT),
          BigInt(STORAGE_DEPOSIT_AMOUNT)
        )
      );
    }

    const ftTransferArgs = {
      receiver_id: params.receiverId,
      amount: params.amount,
      memo: params.memo || "Etibé withdrawal",
    };

    actions.push(
      transactions.functionCall(
        "ft_transfer",
        Buffer.from(JSON.stringify(ftTransferArgs)),
        BigInt(GAS_FOR_FT_TRANSFER),
        BigInt(1)
      )
    );

    return actions;
  }

  buildNearTransferAction(
    amount: string
  ): ReturnType<typeof transactions.transfer> {
    return transactions.transfer(BigInt(amount));
  }

  async getTokenMetadata(tokenContractId: string): Promise<{
    decimals: number;
    symbol: string;
    name: string;
  }> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: tokenContractId,
        method_name: "ft_metadata",
        args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = result as any;
      const metadata = JSON.parse(Buffer.from(resultData.result).toString());

      return {
        decimals: metadata.decimals,
        symbol: metadata.symbol,
        name: metadata.name,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get token metadata for ${tokenContractId}: ${error.message}`
      );
      throw error;
    }
  }

  async getStorageBounds(tokenContractId: string): Promise<{
    min: string;
    max: string;
  }> {
    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: tokenContractId,
        method_name: "storage_balance_bounds",
        args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = result as any;
      const bounds = JSON.parse(Buffer.from(resultData.result).toString());

      return {
        min: bounds.min,
        max: bounds.max,
      };
    } catch (error: any) {
      this.logger.warn(
        `Failed to get storage bounds for ${tokenContractId}, using default: ${error.message}`
      );
      return {
        min: STORAGE_DEPOSIT_AMOUNT,
        max: STORAGE_DEPOSIT_AMOUNT,
      };
    }
  }

  async validateWithdrawal(
    asset: "NEAR" | "USDT" | "USDC",
    destinationAddress: string
  ): Promise<{
    valid: boolean;
    error?: string;
    requiresStorageDeposit?: boolean;
  }> {
    const accountExists = await this.checkAccountExists(destinationAddress);
    if (!accountExists) {
      return {
        valid: false,
        error: `Destination account "${destinationAddress}" does not exist on NEAR`,
      };
    }

    if (asset === "NEAR") {
      return { valid: true };
    }

    const tokenContractId = this.getTokenContractId(asset);
    const storageResult = await this.checkStorageDeposit(
      tokenContractId,
      destinationAddress
    );

    return {
      valid: true,
      requiresStorageDeposit: !storageResult.isRegistered,
    };
  }
}
