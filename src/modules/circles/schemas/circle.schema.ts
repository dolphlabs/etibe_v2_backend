import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";
import {
  Currency,
  CircleStatus,
  PayoutFrequency,
} from "../../../shared/enums/circle.enums";

@Schema({ _id: false })
export class ContributionSettings {
  @Prop({
    required: true,
    type: MongooseSchema.Types.Decimal128,
    get: (v: Types.Decimal128) => v?.toString(),
  })
  amount!: string;

  @Prop({
    required: true,
    enum: Currency,
    default: Currency.USDT,
  })
  currency!: Currency;

  @Prop({
    required: true,
    enum: PayoutFrequency,
    default: PayoutFrequency.MONTHLY,
  })
  frequency!: PayoutFrequency;

  @Prop({
    required: true,
    min: 0,
    max: 30,
    default: 3,
  })
  gracePeriodDays!: number;

  @Prop({
    type: MongooseSchema.Types.Decimal128,
    get: (v: Types.Decimal128) => v?.toString(),
    default: "0",
  })
  penaltyPercentage!: string;
}

const ContributionSettingsSchema =
  SchemaFactory.createForClass(ContributionSettings);

@Schema({ _id: false })
export class CircleMember {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
  })
  userId!: Types.ObjectId;

  @Prop({
    required: true,
    min: 1,
  })
  position!: number;

  @Prop({
    default: false,
  })
  hasReceivedPayout!: boolean;

  @Prop()
  payoutDate?: Date;

  @Prop()
  payoutTransactionHash?: string;

  @Prop({
    required: true,
    default: Date.now,
  })
  joinedAt!: Date;

  @Prop({
    default: "ACTIVE",
    enum: ["PENDING", "ACTIVE", "REMOVED"],
  })
  status!: string;
}

const CircleMemberSchema = SchemaFactory.createForClass(CircleMember);

/**
 * Main Circle (Etibé Group) document.
 */
export interface CircleDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  logoUrl?: string;
  creatorId: Types.ObjectId;
  contributionSettings: ContributionSettings;
  maxMembers: number;
  currentRound: number;
  totalRounds: number;
  status: CircleStatus;
  startDate: Date;
  endDate?: Date;
  nextPayoutDate?: Date;
  contractAddress?: string;
  inviteCode: string;
  inviteLink?: string;
  isPrivate: boolean;
  members: CircleMember[];
  totalContributed: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  isDeleted: boolean;
}

@Schema({
  collection: COLLECTION_NAMES.CIRCLES,
  timestamps: true,
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    getters: true,
  },
})
export class Circle {
  @Prop({
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 100,
    index: true,
  })
  name!: string;

  @Prop({
    trim: true,
    maxlength: 500,
  })
  description?: string;

  @Prop({
    trim: true,
  })
  logoUrl?: string;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    index: true,
  })
  creatorId!: Types.ObjectId;

  @Prop({
    required: true,
    type: ContributionSettingsSchema,
  })
  contributionSettings!: ContributionSettings;

  @Prop({
    required: true,
    min: 2,
    max: 50,
    default: 10,
  })
  maxMembers!: number;

  @Prop({
    default: 0,
    min: 0,
  })
  currentRound!: number;

  @Prop({
    default: 0,
    min: 0,
  })
  totalRounds!: number;

  @Prop({
    required: true,
    enum: CircleStatus,
    default: CircleStatus.PENDING,
    index: true,
  })
  status!: CircleStatus;

  @Prop({
    required: true,
  })
  startDate!: Date;

  @Prop()
  endDate?: Date;

  @Prop({
    index: true,
  })
  nextPayoutDate?: Date;

  @Prop({
    trim: true,
    sparse: true,
  })
  contractAddress?: string;

  @Prop({
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  })
  inviteCode!: string;

  @Prop({
    trim: true,
  })
  inviteLink?: string;

  @Prop({
    default: false,
  })
  isPrivate!: boolean;

  @Prop({
    type: [CircleMemberSchema],
    default: [],
  })
  members!: CircleMember[];

  @Prop({
    type: MongooseSchema.Types.Decimal128,
    get: (v: Types.Decimal128) => v?.toString(),
    default: "0",
  })
  totalContributed!: string;

  @Prop({
    default: null,
    index: true,
  })
  deletedAt?: Date;

  @Prop({
    default: false,
  })
  isDeleted!: boolean;
}

export const CircleSchema = SchemaFactory.createForClass(Circle);

CircleSchema.virtual("memberCount").get(function (this: CircleDocument) {
  return this.members?.filter((m) => m.status === "ACTIVE").length || 0;
});

CircleSchema.virtual("isFull").get(function (this: CircleDocument) {
  const activeMembers =
    this.members?.filter((m) => m.status === "ACTIVE").length || 0;
  return activeMembers >= this.maxMembers;
});

CircleSchema.virtual("payoutAmount").get(function (this: CircleDocument) {
  const activeMembers =
    this.members?.filter((m) => m.status === "ACTIVE").length || 0;
  const contributionAmount = parseFloat(
    this.contributionSettings?.amount || "0"
  );
  return (activeMembers * contributionAmount).toString();
});

CircleSchema.virtual("contributionProgress").get(function (
  this: CircleDocument
) {
  const activeMembers =
    this.members?.filter((m) => m.status === "ACTIVE").length || 0;
  const targetAmount =
    activeMembers * parseFloat(this.contributionSettings?.amount || "0");
  const collected = parseFloat(this.totalContributed || "0");
  return {
    collected,
    target: targetAmount,
    percentage: targetAmount > 0 ? (collected / targetAmount) * 100 : 0,
    membersContributed: 0,
    totalMembers: activeMembers,
  };
});

CircleSchema.index({ creatorId: 1, status: 1 });
CircleSchema.index({ "members.userId": 1 });
CircleSchema.index({ status: 1, startDate: 1 });
CircleSchema.index({ deletedAt: 1, createdAt: -1 });
