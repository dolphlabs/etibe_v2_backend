import {
  IsString,
  IsNotEmpty,
  IsEnum,
  Matches,
  Length,
  IsOptional,
  Min,
  IsNumber,
  ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import { Chain, Currency } from "../../../shared/enums/circle.enums";

export enum WithdrawalAsset {
  NEAR = "NEAR",
  ETH = "ETH",
  USDT = "USDT",
  USDC = "USDC",
  CNGN = "CNGN",
}

/**
 * NEAR address validation pattern.
 */
export const NEAR_ADDRESS_PATTERN =
  /^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.[a-z\d]+[-_]*)*(?:\.[a-z\d]+)+$|^[a-f0-9]{64}$/;

/**
 * Ethereum/Base address validation pattern.
 */
export const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * Infer chain from asset.
 * ETH/CNGN => BASE, NEAR => NEAR, USDT => NEAR, USDC => ambiguous (needs explicit chain)
 */
export function inferChainFromAsset(
  asset: WithdrawalAsset,
  chain?: Chain,
): Chain {
  if (chain) return chain;
  if (asset === WithdrawalAsset.ETH || asset === WithdrawalAsset.CNGN)
    return Chain.BASE;
  if (asset === WithdrawalAsset.NEAR || asset === WithdrawalAsset.USDT)
    return Chain.NEAR;
  // USDC is on both chains — default to BASE
  return Chain.BASE;
}

export class WithdrawDto {
  @IsString({ message: "Amount must be a string" })
  @IsNotEmpty({ message: "Amount is required" })
  @Matches(/^\d+(\.\d+)?$/, {
    message: "Amount must be a valid positive number string",
  })
  amount!: string;

  @IsEnum(WithdrawalAsset, {
    message: `Asset must be one of: ${Object.values(WithdrawalAsset).join(", ")}`,
  })
  @IsNotEmpty({ message: "Asset is required" })
  asset!: WithdrawalAsset;

  @IsOptional()
  @IsEnum(Chain, {
    message: `Chain must be one of: ${Object.values(Chain).join(", ")}`,
  })
  chain?: Chain;

  @IsString({ message: "Destination address must be a string" })
  @IsNotEmpty({ message: "Destination address is required" })
  @Transform(({ value }) => value?.trim())
  destinationAddress!: string;

  @IsString({ message: "OTP must be a string" })
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP must contain only digits" })
  otp!: string;
}

export class WithdrawResponseDto {
  message!: string;
  transactionId!: string;
  status!: "PENDING" | "PROCESSING";
  estimatedCompletionTime!: string;
}

export class RequestWithdrawalOtpDto {
  @IsEnum(WithdrawalAsset, {
    message: `Asset must be one of: ${Object.values(WithdrawalAsset).join(", ")}`,
  })
  @IsNotEmpty({ message: "Asset is required" })
  asset!: WithdrawalAsset;

  @IsString({ message: "Amount must be a string" })
  @IsNotEmpty({ message: "Amount is required" })
  @Matches(/^\d+(\.\d+)?$/, {
    message: "Amount must be a valid positive number string",
  })
  amount!: string;

  @IsOptional()
  @IsEnum(Chain, {
    message: `Chain must be one of: ${Object.values(Chain).join(", ")}`,
  })
  chain?: Chain;
}

export class WithdrawalHistoryQueryDto {
  @IsOptional()
  @IsEnum(WithdrawalAsset, {
    message: "Asset must be one of: NEAR, USDT, USDC",
  })
  asset?: WithdrawalAsset;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10) || 1)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Math.min(parseInt(value, 10) || 20, 50))
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class WithdrawalHistoryItemDto {
  id!: string;
  amount!: string;
  asset!: string;
  destinationAddress!: string;
  status!: string;
  transactionHash?: string;
  failureReason?: string;
  createdAt!: Date;
  confirmedAt?: Date;
}
