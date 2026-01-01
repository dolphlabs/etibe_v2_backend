import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";
import { InvitationStatus } from "../../../shared/enums/circle.enums";

export interface InvitationDocument extends Document {
  _id: Types.ObjectId;
  circleId: Types.ObjectId;
  inviterId: Types.ObjectId;
  inviteeEmail?: string;
  inviteeUserId?: Types.ObjectId;
  inviteCode: string;
  status: InvitationStatus;
  expiresAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Schema({
  collection: COLLECTION_NAMES.INVITATIONS,
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Invitation {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "Circle",
    index: true,
  })
  circleId!: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    index: true,
  })
  inviterId!: Types.ObjectId;

  @Prop({
    trim: true,
    lowercase: true,
    index: true,
  })
  inviteeEmail?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: "User",
    index: true,
  })
  inviteeUserId?: Types.ObjectId;

  @Prop({
    required: true,
    uppercase: true,
    trim: true,
    unique: true,
  })
  inviteCode!: string;

  @Prop({
    required: true,
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
    index: true,
  })
  status!: InvitationStatus;

  @Prop({
    required: true,
  })
  expiresAt!: Date;

  @Prop()
  respondedAt?: Date;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);

// Indexes
InvitationSchema.index({ circleId: 1, status: 1 });
InvitationSchema.index({ inviteeEmail: 1, status: 1 });
InvitationSchema.index({ inviteeUserId: 1, status: 1 });
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
