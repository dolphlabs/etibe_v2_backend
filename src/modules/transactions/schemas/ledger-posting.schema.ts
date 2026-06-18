import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";
import { LedgerAccountType, PostingDirection } from "../../../shared/enums";

@Schema({ _id: false })
export class LedgerPosting {
  @Prop({
    required: true,
    enum: LedgerAccountType,
  })
  accountType!: LedgerAccountType;

  @Prop({
    required: true,
    trim: true,
    index: true,
  })
  accountRef!: string; // Identifier: e.g., "user:fiat_wallet:userId" or "platform:nomba:settlement"

  @Prop({
    required: true,
    type: MongooseSchema.Types.Decimal128,
    get: (v: Types.Decimal128) => v?.toString(),
    // Set to handle string input and convert to Decimal128
    set: (v: string | number) => v,
  })
  amount!: string; // Positive for debits, negative for credits

  @Prop({
    required: true,
    enum: PostingDirection,
  })
  direction!: PostingDirection;
}

export const LedgerPostingSchema = SchemaFactory.createForClass(LedgerPosting);
