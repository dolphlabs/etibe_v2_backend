import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";

@Schema({ _id: false })
export class EncryptedKey {
  @Prop({ required: true })
  ciphertext!: string;

  @Prop({ required: true })
  iv!: string;

  @Prop({ required: true })
  authTag!: string;

  @Prop({ required: true })
  salt!: string;
}

const EncryptedKeySchema = SchemaFactory.createForClass(EncryptedKey);

@Schema({ _id: false })
export class WalletBalance {
  @Prop({ default: "0" })
  NEAR!: string;

  @Prop({ default: "0" })
  ETH!: string;

  @Prop({ default: "0" })
  USDT!: string;

  @Prop({ default: "0" })
  USDC!: string;

  @Prop({ default: "0" })
  CNGN!: string;

  @Prop()
  lastUpdatedAt?: Date;
}

const WalletBalanceSchema = SchemaFactory.createForClass(WalletBalance);

export interface UserDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  phone?: string;
  avatar?: string;
  nearAccountId?: string;
  nearPublicKey?: string;
  nearEncryptedPrivateKey?: EncryptedKey;
  baseAddress?: string;
  basePublicKey?: string;
  baseEncryptedPrivateKey?: EncryptedKey;
  preferredChain?: string;
  walletBalance?: WalletBalance;
  bankDetails?: BankDetail[];
  isActive: boolean;
  isVerified: boolean;
  isEmailVerified: boolean;
  onboardingCompleted: boolean;
  lastLoginAt?: Date;
  deletedAt?: Date;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Password Reset Fields
  resetPasswordToken?: string;
  resetPasswordExpiresAt?: Date;
}

@Schema({
  collection: COLLECTION_NAMES.USERS,
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.password;
      delete ret.nearEncryptedPrivateKey;
      delete ret.baseEncryptedPrivateKey;
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
})
@Schema({ _id: false })
export class BankDetail {
  @Prop({
    required: true,
    trim: true,
  })
  institutionCode!: string;

  @Prop({
    required: true,
    trim: true,
  })
  bankName?: string;

  @Prop({
    required: true,
    trim: true,
  })
  accountNumber!: string;

  @Prop({
    required: true,
    trim: true,
  })
  accountName!: string;

  @Prop({ default: false })
  isVerified!: boolean;
}

const BankDetailSchema = SchemaFactory.createForClass(BankDetail);

export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    index: true,
    match: /^[a-z0-9_]+$/,
  })
  username!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50,
  })
  firstName!: string;

  @Prop({
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50,
  })
  lastName!: string;

  @Prop({
    required: true,
    minlength: 8,
    select: false,
  })
  password!: string;

  @Prop({
    trim: true,
    sparse: true,
  })
  phone?: string;

  @Prop({
    trim: true,
  })
  avatar?: string;

  // NEAR Wallet Fields
  @Prop({
    trim: true,
    sparse: true,
    unique: true,
  })
  nearAccountId?: string;

  @Prop({
    trim: true,
  })
  nearPublicKey?: string;

  @Prop({
    type: EncryptedKeySchema,
    select: false,
  })
  nearEncryptedPrivateKey?: EncryptedKey;

  // Base Chain Wallet Fields
  @Prop({
    trim: true,
    sparse: true,
    unique: true,
  })
  baseAddress?: string;

  @Prop({
    trim: true,
  })
  basePublicKey?: string;

  @Prop({
    type: EncryptedKeySchema,
    select: false,
  })
  baseEncryptedPrivateKey?: EncryptedKey;

  @Prop({
    enum: ["BASE", "NEAR"],
    default: "BASE",
  })
  preferredChain?: string;

  @Prop({
    type: WalletBalanceSchema,
    default: () => ({ NEAR: "0", ETH: "0", USDT: "0", USDC: "0", CNGN: "0" }),
  })
  walletBalance?: WalletBalance;

  @Prop({ type: [BankDetailSchema], default: [] })
  bankDetails?: BankDetail[];

  @Prop({
    default: true,
    index: true,
  })
  isActive!: boolean;

  @Prop({
    default: false,
  })
  isVerified!: boolean;

  @Prop({
    default: false,
    index: true,
  })
  isEmailVerified!: boolean;

  @Prop({
    default: false,
  })
  onboardingCompleted!: boolean;

  @Prop()
  lastLoginAt?: Date;

  @Prop({
    default: null,
    index: true,
  })
  deletedAt?: Date;

  @Prop({
    default: false,
  })
  isDeleted!: boolean;

  // Password Reset Fields
  @Prop({
    select: false,
  })
  resetPasswordToken?: string;

  @Prop({
    index: true,
  })
  resetPasswordExpiresAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.virtual("fullName").get(function (this: UserDocument) {
  return `${this.firstName} ${this.lastName}`;
});

// Legacy alias for backward compatibility
UserSchema.virtual("nearWalletAddress").get(function (this: UserDocument) {
  return this.nearAccountId;
});

UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ username: 1, isActive: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ deletedAt: 1, createdAt: -1 });
UserSchema.index({ isEmailVerified: 1, onboardingCompleted: 1 });
