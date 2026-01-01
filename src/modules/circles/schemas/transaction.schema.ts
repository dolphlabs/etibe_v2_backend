import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";
import {
  TransactionType,
  TransactionStatus,
  Currency,
} from "../../../shared/enums/circle.enums";

export interface TransactionDocument extends Document {
  _id: Types.ObjectId;
  type: TransactionType;
  status: TransactionStatus;
  userId: Types.ObjectId;
  circleId?: Types.ObjectId;
  amount: string;
  currency: Currency;
  round?: number;
  transactionHash?: string;
  nearAccountId?: string;
  metadata?: Record<string, unknown>;
  failureReason?: string;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Schema({
  collection: COLLECTION_NAMES.TRANSACTIONS,
  timestamps: true,
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Transaction {
  @Prop({
    required: true,
    enum: TransactionType,
    index: true,
  })
  type!: TransactionType;

  @Prop({
    required: true,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
    index: true,
  })
  status!: TransactionStatus;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: "Circle",
    index: true,
  })
  circleId?: Types.ObjectId;

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
    min: 1,
  })
  round?: number;

  @Prop({
    trim: true,
    sparse: true,
    index: true,
  })
  transactionHash?: string;

  @Prop({
    trim: true,
  })
  nearAccountId?: string;

  @Prop({
    type: MongooseSchema.Types.Mixed,
  })
  metadata?: Record<string, unknown>;

  @Prop({
    trim: true,
  })
  failureReason?: string;

  @Prop({
    index: true,
  })
  confirmedAt?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ circleId: 1, round: 1, type: 1 });
TransactionSchema.index({ userId: 1, type: 1, status: 1 });
TransactionSchema.index({ circleId: 1, type: 1, createdAt: -1 });
