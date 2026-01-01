import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  ValidateNested,
  Min,
  Max,
  MinLength,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { Currency, PayoutFrequency } from "../../../shared/enums/circle.enums";

export class ContributionSettingsDto {
  @IsString()
  @MinLength(1)
  amount!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(PayoutFrequency)
  frequency!: PayoutFrequency;

  @IsNumber()
  @Min(0)
  @Max(30)
  gracePeriodDays!: number;

  @IsOptional()
  @IsString()
  penaltyPercentage?: string;
}

export class CreateCircleDto {
  @IsString()
  @MinLength(3, { message: "Circle name must be at least 3 characters" })
  @MaxLength(100, { message: "Circle name cannot exceed 100 characters" })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ValidateNested()
  @Type(() => ContributionSettingsDto)
  contributionSettings!: ContributionSettingsDto;

  @IsNumber()
  @Min(2, { message: "Minimum 2 members required" })
  @Max(50, { message: "Maximum 50 members allowed" })
  maxMembers!: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class JoinCircleDto {
  @IsOptional()
  @IsString()
  inviteCode?: string;

  @IsOptional()
  @IsString()
  channelAddress?: string;

  @IsOptional()
  @IsString()
  nearAccountId?: string;
}

export class RecordContributionDto {
  @IsString()
  circleId!: string;

  @IsString()
  transactionHash!: string;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  nearAccountId?: string;
}

export class VerifyTransactionDto {
  @IsString()
  transactionHash!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  expectedAmount!: string;
}

export class CircleResponseDto {
  id!: string;
  name!: string;
  description?: string;
  logoUrl?: string;
  status!: string;
  contributionSettings!: {
    amount: string;
    currency: string;
    frequency: string;
    gracePeriodDays: number;
  };
  memberCount!: number;
  maxMembers!: number;
  currentRound!: number;
  totalRounds!: number;
  nextPayoutDate?: Date;
  payoutAmount!: string;
  inviteCode!: string;
  inviteLink?: string;
  isPrivate!: boolean;
  createdAt!: Date;
}

export class ContributionProgressDto {
  round!: number;
  totalMembers!: number;
  contributedCount!: number;
  amountCollected!: string;
  targetAmount!: string;
  deadline!: Date;
  percentage!: number;
}
