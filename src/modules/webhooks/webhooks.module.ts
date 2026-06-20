import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";

import {
  Transaction,
  TransactionSchema,
} from "../transactions/schemas/transaction.schema";
import { WalletModule } from "../wallet/wallet.module";
import { FiatRampModule } from "../fiat-ramp";
import { WebhooksController } from "./controllers/webhooks.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    ConfigModule,
    WalletModule,    // ← provides FiatWalletService (+ findByAccountReference)
    FiatRampModule,  // ← provides NombaService (sendPayout, verifyTransaction)
  ],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
