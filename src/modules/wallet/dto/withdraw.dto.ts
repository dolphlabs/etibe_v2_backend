import {
  IsString,
  IsNotEmpty,
  IsEnum,
  Matches,
  Length,
  IsOptional,
  Min,
  IsNumber,
} from "class-validator";
import { Transform } from "class-transformer";
import { Currency } from "../../../shared/enums/circle.enums";

export enum WithdrawalAsset {
  NEAR = "NEAR",
  USDT = "USDT",
  USDC = "USDC",
}

/**
 * NEAR address validation pattern.
 *
 * Valid NEAR addresses can be:
 * - Named accounts: alice.near, bob.testnet, sub.account.near
 * - Implicit accounts: 64-character hex strings
 *
 * Rules for named accounts:
 * - Minimum 2 characters, maximum 64 characters
 * - Only lowercase alphanumeric characters, hyphens, underscores, and dots
 * - Cannot start or end with a dot, hyphen, or underscore
 * - Cannot have consecutive dots
 */
export const NEAR_ADDRESS_PATTERN =
  /^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.[a-z\d]+[-_]*)*(?:\.[a-z\d]+)+$|^[a-f0-9]{64}$/;

export class WithdrawDto {
  @IsString({ message: "Amount must be a string" })
  @IsNotEmpty({ message: "Amount is required" })
  @Matches(/^\d+(\.\d+)?$/, {
    message: "Amount must be a valid positive number string",
  })
  amount!: string;

  @IsEnum(WithdrawalAsset, {
    message: "Asset must be one of: NEAR, USDT, USDC",
  })
  @IsNotEmpty({ message: "Asset is required" })
  asset!: WithdrawalAsset;

  @IsString({ message: "Destination address must be a string" })
  @IsNotEmpty({ message: "Destination address is required" })
  @Matches(NEAR_ADDRESS_PATTERN, {
    message:
      "Invalid NEAR address format. Must be a valid named account (e.g., alice.near) or implicit account (64-character hex)",
  })
  @Transform(({ value }) => value?.toLowerCase().trim())
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
    message: "Asset must be one of: NEAR, USDT, USDC",
  })
  @IsNotEmpty({ message: "Asset is required" })
  asset!: WithdrawalAsset;

  @IsString({ message: "Amount must be a string" })
  @IsNotEmpty({ message: "Amount is required" })
  @Matches(/^\d+(\.\d+)?$/, {
    message: "Amount must be a valid positive number string",
  })
  amount!: string;
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
