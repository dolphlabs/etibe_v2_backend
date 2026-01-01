import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Circle,
  CircleSchema,
  Transaction,
  TransactionSchema,
  Invitation,
  InvitationSchema,
} from "./schemas";
import { CircleRepository, TransactionRepository } from "./repositories";
import { CircleService } from "./services";
import { BlockchainModule } from "../blockchain";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Circle.name, schema: CircleSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    BlockchainModule,
  ],
  providers: [CircleRepository, TransactionRepository, CircleService],
  exports: [CircleService, CircleRepository, TransactionRepository],
})
export class CirclesModule {}
