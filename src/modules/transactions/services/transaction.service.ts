import { Injectable, Logger } from "@nestjs/common";
import { TransactionRepository } from "./../repositories/transaction.repository";
import {
  Transaction,
  TransactionDocument,
} from "./../schemas/transaction.schema";
import { QueryOptions, PaginatedResult } from "../../../shared/types";
import { Types } from "mongoose";

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(private readonly transactionRepository: TransactionRepository) {}

  async createTransaction(
    data: Partial<Transaction>,
  ): Promise<TransactionDocument> {
    this.logger.log(`Creating transaction for user: ${data.userId}`);
    return this.transactionRepository.create(data);
  }

  async getUserTransactions(
    userId: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<PaginatedResult<TransactionDocument>> {
    const filter = { userId: new Types.ObjectId(userId.toString()) };
    return this.transactionRepository.findAllWithPagination(filter, options);
  }

  async getTransactionById(
    id: string | Types.ObjectId,
  ): Promise<TransactionDocument | null> {
    return this.transactionRepository.findById(id);
  }
}
