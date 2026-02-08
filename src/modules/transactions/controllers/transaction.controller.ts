import { Controller, Get, Query, Param } from "@nestjs/common";
import { TransactionService } from "../services/transaction.service";
import { CurrentUserId } from "../../auth/decorators/current-user.decorator";
import { TransactionQueryDto } from "../dto/transaction-query.dto";
import { Types } from "mongoose";

@Controller("transactions")
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Get()
  async getMyTransactions(
    @CurrentUserId() userId: string,
    @Query() query: TransactionQueryDto,
  ) {
    const { page, limit, sortBy, sortOrder, ...filter } = query;

    // Convert circleId string to ObjectId if present
    const cleanFilter: any = { ...filter };
    if (cleanFilter.circleId) {
      cleanFilter.circleId = new Types.ObjectId(cleanFilter.circleId);
    }

    return this.transactionService.getUserTransactions(userId, {
      page,
      limit,
      sort: sortBy
        ? { [sortBy]: sortOrder === "asc" ? 1 : -1 }
        : { createdAt: -1 },
    });
  }

  @Get(":id")
  async getTransaction(@Param("id") id: string) {
    return this.transactionService.getTransactionById(id);
  }
}
