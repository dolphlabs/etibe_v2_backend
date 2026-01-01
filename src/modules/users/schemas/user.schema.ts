import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";

export interface UserDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  avatar?: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt?: Date;
  deletedAt?: Date;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Schema({
  collection: COLLECTION_NAMES.USERS,
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.password;
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
})
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
  })
  avatar?: string;

  @Prop({
    default: true,
    index: true,
  })
  isActive!: boolean;

  @Prop({
    default: false,
  })
  isVerified!: boolean;

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
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.virtual("fullName").get(function (this: UserDocument) {
  return `${this.firstName} ${this.lastName}`;
});

UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ deletedAt: 1, createdAt: -1 });
