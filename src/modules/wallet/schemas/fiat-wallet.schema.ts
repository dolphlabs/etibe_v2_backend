import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";

@Schema({ _id: false })
export class NombaVirtualAccount {
  @Prop({ required: true })
  accountReference!: string; // Unique reference mapping to Nomba

  @Prop({ required: true })
  bankName!: string;

  @Prop({ required: true })
  accountNumber!: string;

  @Prop({ required: true })
  accountName!: string;
}

const NombaVirtualAccountSchema = SchemaFactory.createForClass(NombaVirtualAccount);

export interface FiatWalletDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  currency: string; // "NGN" for v1
  balance: string; // Cached ledger balance
  virtualAccount?: NombaVirtualAccount;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  createdAt: Date;
  updatedAt: Date;
}

@Schema({
  collection: "fiat_wallets",
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
export class FiatWallet {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, default: "NGN", index: true })
  currency!: string;

  @Prop({
    required: true,
    type: MongooseSchema.Types.Decimal128,
    default: "0.00",
    get: (v: Types.Decimal128) => v?.toString(),
    set: (v: string | number) => v,
  })
  balance!: string;

  @Prop({ type: NombaVirtualAccountSchema })
  virtualAccount?: NombaVirtualAccount;

  @Prop({
    required: true,
    enum: ["ACTIVE", "SUSPENDED", "PENDING"],
    default: "PENDING",
    index: true,
  })
  status!: string;
}

export const FiatWalletSchema = SchemaFactory.createForClass(FiatWallet);
FiatWalletSchema.index({ userId: 1, currency: 1 }, { unique: true });
FiatWalletSchema.index({ "virtualAccount.accountNumber": 1 });
FiatWalletSchema.index({ "virtualAccount.accountReference": 1 });
