import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  JsonRpcProvider,
  Contract,
  formatEther,
  formatUnits,
} from "ethers";

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

export interface BaseContributionVerification {
  isValid: boolean;
  transactionHash: string;
  senderId: string;
  receiverId: string;
  amount: string;
  blockTimestamp: number;
}

export interface BaseCircleContractState {
  name: string;
  creator: string;
  tokenAddress: string;
  contributionAmount: string;
  maxMembers: number;
  currentRound: number;
  totalRounds: number;
  isActive: boolean;
  memberCount: number;
}

@Injectable()
export class BaseService implements OnModuleInit {
  private readonly logger = new Logger(BaseService.name);
  private provider!: JsonRpcProvider;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      const rpcUrl = this.configService.get<string>("base.rpcUrl");
      const chainId = this.configService.get<number>("base.chainId");

      if (!rpcUrl) {
        this.logger.warn("BASE_RPC_URL not configured.");
        return;
      }

      this.provider = new JsonRpcProvider(rpcUrl, chainId);
      this.initialized = true;
      this.logger.log("BaseService initialized");
    } catch (error) {
      this.logger.error("Failed to initialize BaseService", error);
    }
  }

  async verifyContribution(
    txHash: string,
    expectedReceiver: string,
    expectedAmount: string,
  ): Promise<BaseContributionVerification> {
    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return {
        isValid: false,
        transactionHash: txHash,
        senderId: "",
        receiverId: "",
        amount: "0",
        blockTimestamp: 0,
      };
    }

    const tx = await this.provider.getTransaction(txHash);
    const block = await this.provider.getBlock(receipt.blockNumber);

    // Check for native ETH transfer
    if (tx && tx.value > 0n) {
      const receiverMatch =
        tx.to?.toLowerCase() === expectedReceiver.toLowerCase();
      const amountMatch =
        formatEther(tx.value) === expectedAmount;

      return {
        isValid: receiverMatch && amountMatch,
        transactionHash: txHash,
        senderId: tx.from,
        receiverId: tx.to || "",
        amount: formatEther(tx.value),
        blockTimestamp: block?.timestamp || 0,
      };
    }

    // Check for ERC-20 Transfer event
    for (const log of receipt.logs) {
      try {
        const erc20Interface = new Contract(
          log.address,
          ERC20_ABI,
          this.provider,
        ).interface;

        const parsed = erc20Interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed && parsed.name === "Transfer") {
          const [from, to, value] = parsed.args;
          const receiverMatch =
            to.toLowerCase() === expectedReceiver.toLowerCase();

          return {
            isValid: receiverMatch,
            transactionHash: txHash,
            senderId: from,
            receiverId: to,
            amount: formatUnits(value, 6),
            blockTimestamp: block?.timestamp || 0,
          };
        }
      } catch {
        // Not an ERC-20 transfer log, skip
      }
    }

    return {
      isValid: false,
      transactionHash: txHash,
      senderId: tx?.from || "",
      receiverId: tx?.to || "",
      amount: "0",
      blockTimestamp: block?.timestamp || 0,
    };
  }

  async viewCircleState(
    contractAddress: string,
  ): Promise<BaseCircleContractState | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const contractArtifact = require("../abis/EtibeCircle.json");
      const contract = new Contract(
        contractAddress,
        contractArtifact.abi,
        this.provider,
      );

      const state = await contract.getCircleState();

      return {
        name: state.name,
        creator: state.creator,
        tokenAddress: state.tokenAddress,
        contributionAmount: state.contributionAmount.toString(),
        maxMembers: Number(state.maxMembers),
        currentRound: Number(state.currentRound),
        totalRounds: Number(state.totalRounds),
        isActive: state.isActive,
        memberCount: Number(state.memberCount),
      };
    } catch (error: any) {
      this.logger.warn(
        `Failed to read circle state at ${contractAddress}: ${error.message}`,
      );
      return null;
    }
  }

  async isValidCircleContract(contractAddress: string): Promise<boolean> {
    try {
      const code = await this.provider.getCode(contractAddress);
      return code !== "0x";
    } catch {
      return false;
    }
  }

  async getContractBalance(
    contractAddress: string,
    tokenAddress?: string,
  ): Promise<string> {
    if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") {
      const balance = await this.provider.getBalance(contractAddress);
      return formatEther(balance);
    }

    const contract = new Contract(
      tokenAddress,
      ["function balanceOf(address) view returns (uint256)"],
      this.provider,
    );

    const balance = await contract.balanceOf(contractAddress);
    return formatUnits(balance, 6);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.initialized) return false;
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}
