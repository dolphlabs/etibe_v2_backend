import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { BaseRepository, FilterQuery } from "../../../core/repositories";
import { Transaction, TransactionDocument } from "../schemas";
import {
  TransactionType,
  TransactionStatus,
} from "../../../shared/enums/circle.enums";

@Injectable()
export class TransactionRepository extends BaseRepository<TransactionDocument> {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>
  ) {
    super(transactionModel);
  }

  async findByHash(
    transactionHash: string
  ): Promise<TransactionDocument | null> {
    return this.findOne({
      transactionHash,
    } as FilterQuery<TransactionDocument>);
  }

  async getUserTransactions(
    userId: string,
    options?: { limit?: number; type?: TransactionType }
  ): Promise<TransactionDocument[]> {
    const filter: FilterQuery<TransactionDocument> = {
      userId: new Types.ObjectId(userId),
    };

    if (options?.type) {
      (filter as Record<string, unknown>).type = options.type;
    }

    return this.findAll(filter, {
      sort: { createdAt: -1 },
      select: options?.limit ? undefined : undefined,
    });
  }

  async getCircleRoundTransactions(
    circleId: string,
    round: number
  ): Promise<TransactionDocument[]> {
    return this.findAll({
      circleId: new Types.ObjectId(circleId),
      round,
      type: TransactionType.CONTRIBUTION,
    } as FilterQuery<TransactionDocument>);
  }

  async countRoundContributions(
    circleId: string,
    round: number
  ): Promise<number> {
    return this.count({
      circleId: new Types.ObjectId(circleId),
      round,
      type: TransactionType.CONTRIBUTION,
      status: TransactionStatus.CONFIRMED,
    } as FilterQuery<TransactionDocument>);
  }

  async getRoundTotalContributed(
    circleId: string,
    round: number
  ): Promise<string> {
    const result = await this.transactionModel.aggregate([
      {
        $match: {
          circleId: new Types.ObjectId(circleId),
          round,
          type: TransactionType.CONTRIBUTION,
          status: TransactionStatus.CONFIRMED,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    return result[0]?.total?.toString() || "0";
  }

  async hasUserContributedThisRound(
    userId: string,
    circleId: string,
    round: number
  ): Promise<boolean> {
    return this.exists({
      userId: new Types.ObjectId(userId),
      circleId: new Types.ObjectId(circleId),
      round,
      type: TransactionType.CONTRIBUTION,
      status: TransactionStatus.CONFIRMED,
    } as FilterQuery<TransactionDocument>);
  }

  async confirmTransaction(
    transactionId: string,
    transactionHash: string
  ): Promise<TransactionDocument | null> {
    return this.update(transactionId, {
      status: TransactionStatus.CONFIRMED,
      transactionHash,
      confirmedAt: new Date(),
    } as Partial<TransactionDocument>);
  }

  async failTransaction(
    transactionId: string,
    reason: string
  ): Promise<TransactionDocument | null> {
    return this.update(transactionId, {
      status: TransactionStatus.FAILED,
      failureReason: reason,
    } as Partial<TransactionDocument>);
  }
}
