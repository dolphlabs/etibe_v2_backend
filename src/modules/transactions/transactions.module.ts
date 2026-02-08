import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Transaction, TransactionSchema } from "./schemas/transaction.schema";
import { TransactionRepository } from "./repositories/transaction.repository";
import { TransactionService } from "./services/transaction.service";
import { TransactionController } from "./controllers/transaction.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [TransactionController],
  providers: [TransactionRepository, TransactionService],
  exports: [TransactionService, TransactionRepository],
})
export class TransactionsModule {}
