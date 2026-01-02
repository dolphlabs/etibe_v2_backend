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
  IsDecimal,
  Matches,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { Currency, PayoutFrequency } from "../../../shared/enums/circle.enums";

export class ContributionSettingsDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: "Amount must be a valid decimal number",
  })
  amount!: string;

  @IsEnum(Currency, {
    message: `Currency must be one of: ${Object.values(Currency).join(", ")}`,
  })
  currency!: Currency;

  @IsEnum(PayoutFrequency, {
    message: `Frequency must be one of: ${Object.values(PayoutFrequency).join(
      ", "
    )}`,
  })
  frequency!: PayoutFrequency;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  gracePeriodDays?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: "Penalty percentage must be a valid decimal",
  })
  penaltyPercentage?: string;
}

export class CreateCircleDto {
  @IsString()
  @MinLength(3, { message: "Circle name must be at least 3 characters" })
  @MaxLength(100, { message: "Circle name cannot exceed 100 characters" })
  @Transform(({ value }) => value?.trim())
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
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

  @IsDateString({}, { message: "Start date must be a valid ISO date string" })
  startDate!: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class ActivateCircleDto {
  @IsString()
  @MinLength(5, { message: "Contract address is required" })
  contractAddress!: string;
}

export class JoinCircleDto {
  @IsOptional()
  @IsString()
  @MinLength(6, { message: "Invite code must be at least 6 characters" })
  @MaxLength(12)
  @Transform(({ value }) => value?.toUpperCase().trim())
  inviteCode?: string;

  @IsOptional()
  @IsString()
  channelAddress?: string;
}

export class RecordContributionDto {
  @IsString()
  circleId!: string;

  @IsString()
  transactionHash!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: "Amount must be a valid decimal number",
  })
  amount!: string;
}

export class VerifyTransactionDto {
  @IsString()
  transactionHash!: string;

  @IsString()
  contractAddress!: string;

  @IsString()
  expectedAmount!: string;
}

export class InviteMemberDto {
  @IsString()
  circleId!: string;

  @IsOptional()
  @IsString()
  inviteeEmail?: string;

  @IsOptional()
  @IsString()
  inviteeUserId?: string;
}

export class CircleMemberResponseDto {
  userId!: string;
  username?: string;
  firstName!: string;
  lastName!: string;
  avatar?: string;
  position!: number;
  hasReceivedPayout!: boolean;
  payoutDate?: Date;
  joinedAt!: Date;
  status!: string;
}

export class CircleResponseDto {
  id!: string;
  name!: string;
  description?: string;
  logoUrl?: string;
  status!: string;
  contractAddress?: string;
  contributionSettings!: {
    amount: string;
    currency: string;
    frequency: string;
    gracePeriodDays: number;
    penaltyPercentage: string;
  };
  memberCount!: number;
  maxMembers!: number;
  currentRound!: number;
  totalRounds!: number;
  startDate!: Date;
  nextPayoutDate?: Date;
  payoutAmount!: string;
  inviteCode!: string;
  inviteLink?: string;
  isPrivate!: boolean;
  isFull!: boolean;
  createdAt!: Date;
}

export class CircleStatsDto {
  collected!: string;
  target!: string;
  progress!: number;
  membersContributed!: number;
  totalMembers!: number;
}

export class NextRecipientDto {
  userId!: string;
  username?: string;
  firstName!: string;
  lastName!: string;
  avatar?: string;
  position!: number;
}

export class ActivityLogDto {
  type!: string;
  userId!: string;
  username?: string;
  amount?: string;
  message!: string;
  timestamp!: Date;
}

export class CircleDashboardDto {
  circle!: CircleResponseDto;
  stats!: CircleStatsDto;
  nextRecipient!: NextRecipientDto | null;
  daysUntilNextContribution!: number;
  payoutOrder!: CircleMemberResponseDto[];
  recentActivity!: ActivityLogDto[];
  userContributedThisRound!: boolean;
}

export class ContributionProgressDto {
  round!: number;
  totalMembers!: number;
  contributedCount!: number;
  amountCollected!: string;
  targetAmount!: string;
  percentage!: number;
  deadline!: Date;
}

export class PayoutInfoDto {
  nextPayoutDate!: Date | null;
  nextRecipient!: {
    userId: string;
    position: number;
  } | null;
  payoutAmount!: string;
}

export class InitiateCircleResponseDto {
  circleId!: string;
  inviteCode!: string;
  creatorNearAccountId!: string;
  factoryContractId!: string;
  initArgs!: {
    name: string;
    contribution_amount: string;
    currency: string;
    frequency: string;
    max_members: number;
    grace_period_days: number;
  };
}
