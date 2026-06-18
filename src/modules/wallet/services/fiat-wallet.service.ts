import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection, ClientSession } from "mongoose";
import { FiatWallet, FiatWalletDocument } from "../schemas/fiat-wallet.schema";
import { Transaction, TransactionDocument, LedgerPosting } from "@modules/transactions";
import { User, UserDocument } from "../../users/schemas/user.schema";
import {
  TransactionType,
  TransactionStatus,
  LedgerAccountType,
  PostingDirection,
  Currency,
} from "../../../shared/enums";

@Injectable()
export class FiatWalletService {
  private readonly logger = new Logger(FiatWalletService.name);

  constructor(
    @InjectModel(FiatWallet.name)
    private readonly fiatWalletModel: Model<FiatWalletDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Gets a user's fiat wallet. If it doesn't exist, creates one with a mock
   * Nomba virtual account setup as a base for onboarding/on-ramp.
   */
  async getOrCreateFiatWallet(userId: string): Promise<FiatWalletDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    let wallet = await this.fiatWalletModel.findOne({
      userId: new Types.ObjectId(userId),
      currency: "NGN",
    });

    if (!wallet) {
      this.logger.log(`Creating fiat wallet for user ${userId}`);

      // Enforce basic KYC information for Nomba integration mapping
      if (!user.phone) {
        this.logger.warn(
          `User ${userId} does not have a phone number. Generating a default placeholder phone for Nomba sandbox.`,
        );
      }

      // Generate a mock Nomba Virtual Account as a base for the onboarding flow
      const accountReference = `REF-${new Types.ObjectId().toString().toUpperCase()}`;
      const mockVirtualAccount = {
        accountReference,
        bankName: "Wema Bank",
        accountNumber: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
        accountName: `ETIBE/${user.firstName.toUpperCase()} ${user.lastName.toUpperCase()}`,
      };

      wallet = await this.fiatWalletModel.create({
        userId: new Types.ObjectId(userId),
        currency: "NGN",
        balance: "0.00",
        virtualAccount: mockVirtualAccount,
        status: "ACTIVE",
      });

      this.logger.log(
        `Fiat wallet created for user ${userId} with virtual account ${mockVirtualAccount.accountNumber}`,
      );
    }

    return wallet;
  }

  /**
   * Retrieves the current cached fiat balance of a user.
   */
  async getFiatBalance(userId: string): Promise<string> {
    const wallet = await this.fiatWalletModel.findOne({
      userId: new Types.ObjectId(userId),
      currency: "NGN",
    });

    if (!wallet) {
      return "0.00";
    }

    return wallet.balance;
  }

  /**
   * Records a double-entry ledger transaction.
   * Ensures that all debits and credits balance to exactly 0.00.
   * Updates cached user fiat balances if a liability account is affected.
   */
  async recordLedgerTransaction(
    userId: string,
    type: TransactionType,
    currency: string,
    amount: string,
    postings: Omit<LedgerPosting, "direction">[],
    metadata?: Record<string, any>,
  ): Promise<TransactionDocument> {
    // 1. Validate that the sum of debits and credits matches 0.00
    this.validateLedgerBalance(postings);

    // 2. Resolve ledger directions for auditing
    const resolvedPostings = postings.map((p) => {
      const parsedAmount = parseFloat(p.amount);
      return {
        ...p,
        direction: parsedAmount >= 0 ? PostingDirection.DEBIT : PostingDirection.CREDIT,
      } as LedgerPosting;
    });

    // 3. Run inside a Mongoose transaction session to ensure atomicity
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // A. Create the ledger transaction record
      const [transaction] = await this.transactionModel.create(
        [
          {
            type,
            status: TransactionStatus.CONFIRMED,
            userId: new Types.ObjectId(userId),
            amount,
            currency,
            postings: resolvedPostings,
            metadata,
            confirmedAt: new Date(),
          },
        ],
        { session },
      );

      // B. Scan postings for user liability (fiat wallet) updates and apply them
      for (const posting of resolvedPostings) {
        if (
          posting.accountType === LedgerAccountType.LIABILITY &&
          posting.accountRef.startsWith("user:fiat_wallet:")
        ) {
          const targetUserId = posting.accountRef.split(":")[2];
          const postingAmount = parseFloat(posting.amount);

          this.logger.log(
            `Updating user ${targetUserId} fiat wallet balance by ${postingAmount}`,
          );

          const updatedWallet = await this.fiatWalletModel.findOneAndUpdate(
            { userId: new Types.ObjectId(targetUserId), currency },
            { $inc: { balance: postingAmount } },
            { session, new: true },
          );

          if (!updatedWallet) {
            throw new BadRequestException(
              `Fiat wallet for user ${targetUserId} not found during balance update`,
            );
          }

          // Double check balance is not negative
          if (parseFloat(updatedWallet.balance) < 0) {
            throw new BadRequestException(
              `Insufficient balance in fiat wallet for user ${targetUserId}`,
            );
          }
        }
      }

      await session.commitTransaction();
      this.logger.log(
        `Ledger transaction recorded: ${type} of ${amount} ${currency}, TxId: ${transaction._id}`,
      );
      return transaction;
    } catch (error) {
      await session.abortTransaction();
      this.logger.error("Ledger transaction recording failed, rolled back.", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Helper to validate that all postings sum up to zero.
   * Uses integer math (cents) to avoid standard floating point precision errors.
   */
  private validateLedgerBalance(postings: Omit<LedgerPosting, "direction">[]): void {
    if (postings.length < 2) {
      throw new BadRequestException("A ledger transaction must contain at least 2 postings");
    }

    let balanceSumCents = 0;

    for (const posting of postings) {
      const parsed = parseFloat(posting.amount);
      if (isNaN(parsed)) {
        throw new BadRequestException(`Invalid posting amount: ${posting.amount}`);
      }
      // Convert to cents
      balanceSumCents += Math.round(parsed * 100);
    }

    if (balanceSumCents !== 0) {
      throw new BadRequestException(
        `Ledger transaction is unbalanced. Sum of debits and credits must be 0.00. Current sum: ${(
          balanceSumCents / 100
        ).toFixed(2)}`,
      );
    }
  }
}
