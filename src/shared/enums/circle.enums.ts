import { Types } from "mongoose";

export enum Currency {
  NEAR = "NEAR",
  USDT = "USDT",
  USDC = "USDC",
}

export enum CircleStatus {
  PENDING = "PENDING",
  RECRUITING = "RECRUITING",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum CircleMemberRole {
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
}

export enum CircleMemberStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  REMOVED = "REMOVED",
}

export enum TransactionType {
  TOP_UP = "TOP_UP",
  CONTRIBUTION = "CONTRIBUTION",
  PAYOUT = "PAYOUT",
  WITHDRAWAL = "WITHDRAWAL",
  PENALTY = "PENALTY",
  REFUND = "REFUND",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
  REVERSED = "REVERSED",
}

export enum InvitationStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  DECLINED = "DECLINED",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
}

export enum PayoutFrequency {
  WEEKLY = "WEEKLY",
  BI_WEEKLY = "BI_WEEKLY",
  MONTHLY = "MONTHLY",
}

export enum NotificationType {
  CONTRIBUTION_REMINDER = "CONTRIBUTION_REMINDER",
  CONTRIBUTION_RECEIVED = "CONTRIBUTION_RECEIVED",
  PAYOUT_RECEIVED = "PAYOUT_RECEIVED",
  MEMBER_JOINED = "MEMBER_JOINED",
  MEMBER_LEFT = "MEMBER_LEFT",
  CIRCLE_STATUS_CHANGE = "CIRCLE_STATUS_CHANGE",
  INVITATION_RECEIVED = "INVITATION_RECEIVED",
  PENALTY_APPLIED = "PENALTY_APPLIED",
  GRACE_PERIOD_WARNING = "GRACE_PERIOD_WARNING",
}

export interface PayoutRotation {
  round: number;
  recipientUserId: Types.ObjectId;
  scheduledDate: Date;
  isCompleted: boolean;
  completedAt?: Date;
  amount?: string;
  transactionHash?: string;
}

export interface ContributionProgress {
  round: number;
  totalMembers: number;
  contributedCount: number;
  amountCollected: string;
  targetAmount: string;
  deadline: Date;
}
