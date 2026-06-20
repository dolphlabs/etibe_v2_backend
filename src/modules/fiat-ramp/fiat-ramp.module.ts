import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";

import { User, UserSchema } from "../users/schemas/user.schema";
import {
  Transaction,
  TransactionSchema,
} from "../transactions/schemas/transaction.schema";
import { WalletModule } from "../wallet/wallet.module";
import { BlockchainModule } from "../blockchain";

import { FiatRampController } from "./controllers/fiat-ramp.controller";
import { FiatRampService } from "./services/fiat-ramp.service";
import { NombaService } from "./services/nomba.service";
import { PaycrestService } from "./services/paycrest.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    ConfigModule,
    WalletModule,      // ← exports FiatWalletService (already wired with FiatWallet schema)
    BlockchainModule,  // ← exports VaultService (for OTP generation)
  ],
  controllers: [FiatRampController],
  providers: [FiatRampService, NombaService, PaycrestService],
  exports: [FiatRampService, NombaService, PaycrestService],
})
export class FiatRampModule {}
