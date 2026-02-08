import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { COLLECTION_NAMES } from "../../../shared/constants";
import { NotificationType } from "../../../shared/enums";

export interface NotificationDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  content: string;
  type: NotificationType;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  deletedAt?: Date;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Schema({
  collection: COLLECTION_NAMES.NOTIFICATIONS,
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
})
export class Notification {
  @Prop({
    type: Types.ObjectId,
    ref: COLLECTION_NAMES.USERS,
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  content!: string;

  @Prop({ type: String, enum: NotificationType, required: true, index: true })
  type!: NotificationType;

  @Prop({ default: false, index: true })
  isRead!: boolean;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ default: null, index: true })
  deletedAt?: Date;

  @Prop({ default: false })
  isDeleted!: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });
