import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
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
import { PayoutSchedulerService } from "./services/payout-scheduler.service";
import { CircleController } from "./controllers";
import { PayoutProcessor } from "./processors/payout.processor";
import { CircleActivatedListener } from "./listeners/circle-activated.listener";
import { VerifiedUserGuard } from "./guards";
import { BlockchainModule } from "../blockchain";
import { UsersModule } from "../users";
import { PAYOUT_QUEUE_NAME } from "./constants/payout.constants";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Circle.name, schema: CircleSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    BullModule.registerQueueAsync({
      name: PAYOUT_QUEUE_NAME,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>("redis.host", "localhost"),
          port: configService.get<number>("redis.port", 6379),
          password: configService.get<string>("redis.password"),
        },
        defaultJobOptions: {
          removeOnComplete: {
            count: 100,
            age: 7 * 24 * 60 * 60,
          },
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      }),
    }),
    BlockchainModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [CircleController],
  providers: [
    CircleRepository,
    TransactionRepository,
    CircleService,
    CircleMailService,
    PayoutSchedulerService,
    PayoutProcessor,
    CircleActivatedListener,
    VerifiedUserGuard,
  ],
  exports: [
    CircleService,
    CircleMailService,
    CircleRepository,
    TransactionRepository,
    PayoutSchedulerService,
    VerifiedUserGuard,
  ],
})
export class CirclesModule {}
