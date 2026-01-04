import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { User, UserSchema } from "../users/schemas/user.schema";
import {
  Transaction,
  TransactionSchema,
} from "../circles/schemas/transaction.schema";
import { WalletController } from "./controllers/wallet.controller";
import { WalletService } from "./services/wallet.service";
import { WithdrawalProcessor } from "./processors/withdrawal.processor";
import { BlockchainModule } from "../blockchain";
import { AuthModule } from "../auth";
import { CirclesModule } from "../circles";
import { WITHDRAWAL_QUEUE_NAME } from "./constants/withdrawal.constants";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    BullModule.registerQueueAsync({
      name: WITHDRAWAL_QUEUE_NAME,
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
            age: 7 * 24 * 60 * 60, // 7 days
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
    forwardRef(() => AuthModule),
    forwardRef(() => CirclesModule),
  ],
  controllers: [WalletController],
  providers: [WalletService, WithdrawalProcessor],
  exports: [WalletService],
})
export class WalletModule {}
