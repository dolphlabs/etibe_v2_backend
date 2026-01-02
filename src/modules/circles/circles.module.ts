import { Module, forwardRef } from "@nestjs/common";
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
import { CircleService, CircleMailService } from "./services";
import { CircleController } from "./controllers";
import { VerifiedUserGuard } from "./guards";
import { BlockchainModule } from "../blockchain";
import { UsersModule } from "../users";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Circle.name, schema: CircleSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    BlockchainModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [CircleController],
  providers: [
    CircleRepository,
    TransactionRepository,
    CircleService,
    CircleMailService,
    VerifiedUserGuard,
  ],
  exports: [
    CircleService,
    CircleMailService,
    CircleRepository,
    TransactionRepository,
    VerifiedUserGuard,
  ],
})
export class CirclesModule {}
