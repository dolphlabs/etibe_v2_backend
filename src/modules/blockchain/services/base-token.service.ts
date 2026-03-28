import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseUnits, formatUnits, isAddress } from "ethers";
import { BASE_TOKEN_CONTRACTS } from "../../../shared/constants";
import { ASSET_DECIMALS } from "../../wallet/constants";

@Injectable()
export class BaseTokenService {
  private readonly logger = new Logger(BaseTokenService.name);
  private readonly network: string;

  constructor(private readonly configService: ConfigService) {
    this.network = this.configService.get<string>("base.network", "sepolia");
  }

  getTokenContractAddress(
    asset: "CNGN" | "USDC",
  ): string {
    const network = this.network === "mainnet" ? "mainnet" : "sepolia";
    return BASE_TOKEN_CONTRACTS[network][asset];
  }

  toAtomicUnits(amount: string | number, asset: string): string {
    const decimals = this.getDecimals(asset);
    return parseUnits(String(amount), decimals).toString();
  }

  fromAtomicUnits(atomicAmount: string, asset: string): string {
    const decimals = this.getDecimals(asset);
    return formatUnits(atomicAmount, decimals);
  }

  getDecimals(asset: string): number {
    if (asset === "ETH") return 18;
    return ASSET_DECIMALS[asset] || 6;
  }

  validateWithdrawal(
    asset: string,
    destinationAddress: string,
  ): { valid: boolean; error?: string } {
    if (!isAddress(destinationAddress)) {
      return {
        valid: false,
        error: "Invalid Ethereum address",
      };
    }

    const supportedAssets = ["ETH", "CNGN", "USDC"];
    if (!supportedAssets.includes(asset)) {
      return {
        valid: false,
        error: `Unsupported asset for Base chain: ${asset}`,
      };
    }

    return { valid: true };
  }
}
