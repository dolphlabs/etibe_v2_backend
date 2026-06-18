import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken, getConnectionToken } from "@nestjs/mongoose";
import { FiatWalletService } from "./fiat-wallet.service";
import { FiatWallet } from "../schemas/fiat-wallet.schema";
import { Transaction } from "@modules/transactions";
import { User } from "../../users/schemas/user.schema";
import { Types, Connection } from "mongoose";
import { LedgerAccountType, TransactionType } from "../../../shared/enums";

describe("FiatWalletService", () => {
  let service: FiatWalletService;
  let mockFiatWalletModel: any;
  let mockTransactionModel: any;
  let mockUserModel: any;
  let mockConnection: any;
  let mockSession: any;

  beforeEach(async () => {
    mockFiatWalletModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    mockTransactionModel = {
      create: jest.fn(),
    };

    mockUserModel = {
      findById: jest.fn(),
    };

    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatWalletService,
        {
          provide: getModelToken(FiatWallet.name),
          useValue: mockFiatWalletModel,
        },
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<FiatWalletService>(FiatWalletService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getOrCreateFiatWallet", () => {
    it("should return existing fiat wallet", async () => {
      const userId = new Types.ObjectId().toString();
      const mockWallet = { userId: new Types.ObjectId(userId), currency: "NGN", balance: "5000.00" };
      
      mockUserModel.findById.mockResolvedValue({ _id: userId, firstName: "John", lastName: "Doe" });
      mockFiatWalletModel.findOne.mockResolvedValue(mockWallet);

      const result = await service.getOrCreateFiatWallet(userId);
      expect(result).toEqual(mockWallet);
      expect(mockFiatWalletModel.findOne).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
        currency: "NGN",
      });
      expect(mockFiatWalletModel.create).not.toHaveBeenCalled();
    });

    it("should create new fiat wallet with virtual accounts if not exists", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = { _id: userId, firstName: "John", lastName: "Doe", phone: "123456" };
      const mockWallet = { userId: new Types.ObjectId(userId), currency: "NGN", balance: "0.00" };
      
      mockUserModel.findById.mockResolvedValue(mockUser);
      mockFiatWalletModel.findOne.mockResolvedValue(null);
      mockFiatWalletModel.create.mockResolvedValue(mockWallet);

      const result = await service.getOrCreateFiatWallet(userId);
      expect(result).toBeDefined();
      expect(mockFiatWalletModel.create).toHaveBeenCalled();
    });
  });

  describe("recordLedgerTransaction", () => {
    it("should record transaction and commit session when double-entry balances", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTx = { _id: new Types.ObjectId() };
      
      mockTransactionModel.create.mockResolvedValue([mockTx]);
      mockFiatWalletModel.findOneAndUpdate.mockResolvedValue({ balance: "100.00" });

      const postings = [
        {
          accountType: LedgerAccountType.ASSET,
          accountRef: "platform:nomba:settlement",
          amount: "100.00",
        },
        {
          accountType: LedgerAccountType.LIABILITY,
          accountRef: `user:fiat_wallet:${userId}`,
          amount: "-100.00",
        },
      ];

      const result = await service.recordLedgerTransaction(
        userId,
        TransactionType.TOP_UP,
        "NGN",
        "100.00",
        postings,
      );

      expect(result).toBeDefined();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockFiatWalletModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it("should throw error and abort session when postings do not balance", async () => {
      const userId = new Types.ObjectId().toString();
      
      const postings = [
        {
          accountType: LedgerAccountType.ASSET,
          accountRef: "platform:nomba:settlement",
          amount: "100.00",
        },
        {
          accountType: LedgerAccountType.LIABILITY,
          accountRef: `user:fiat_wallet:${userId}`,
          amount: "-50.00", // unbalanced
        },
      ];

      await expect(
        service.recordLedgerTransaction(
          userId,
          TransactionType.TOP_UP,
          "NGN",
          "100.00",
          postings,
        ),
      ).rejects.toThrow("Ledger transaction is unbalanced");

      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });
  });
});
