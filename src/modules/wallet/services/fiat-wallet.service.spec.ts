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

  describe("findByUserId", () => {
    it("should return existing fiat wallet", async () => {
      const userId = new Types.ObjectId().toString();
      const mockWallet = { userId: new Types.ObjectId(userId), currency: "NGN", balance: "5000.00" };

      mockFiatWalletModel.findOne.mockResolvedValue(mockWallet);

      const result = await service.findByUserId(userId);
      expect(result).toEqual(mockWallet);
      expect(mockFiatWalletModel.findOne).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
        currency: "NGN",
      });
    });

    it("should return null when no wallet exists", async () => {
      mockFiatWalletModel.findOne.mockResolvedValue(null);
      const result = await service.findByUserId(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });
  });

  describe("createWallet", () => {
    const virtualAccount = {
      accountReference: "ETIBE-VA-TESTREF12345678",
      bankName: "Wema Bank",
      accountNumber: "1234567890",
      accountName: "ETIBE/JOHN DOE",
    };

    it("should create a wallet with the provided virtual account", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = { _id: userId, firstName: "John", lastName: "Doe" };
      const mockWallet = { userId: new Types.ObjectId(userId), currency: "NGN", balance: "0.00", virtualAccount };

      mockUserModel.findById.mockResolvedValue(mockUser);
      mockFiatWalletModel.findOne.mockResolvedValue(null);
      mockFiatWalletModel.create.mockResolvedValue(mockWallet);

      const result = await service.createWallet(userId, virtualAccount);
      expect(result).toEqual(mockWallet);
      expect(mockFiatWalletModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "NGN", balance: "0.00", virtualAccount }),
      );
    });

    it("should throw if the user already has a wallet", async () => {
      const userId = new Types.ObjectId().toString();
      mockUserModel.findById.mockResolvedValue({ _id: userId });
      mockFiatWalletModel.findOne.mockResolvedValue({ currency: "NGN" });

      await expect(service.createWallet(userId, virtualAccount)).rejects.toThrow(
        "already has an NGN fiat wallet",
      );
      expect(mockFiatWalletModel.create).not.toHaveBeenCalled();
    });

    it("should throw if the user does not exist", async () => {
      mockUserModel.findById.mockResolvedValue(null);
      await expect(
        service.createWallet(new Types.ObjectId().toString(), virtualAccount),
      ).rejects.toThrow("User not found");
    });
  });

  describe("recordLedgerTransaction", () => {
    it("should record transaction and commit session when double-entry balances", async () => {
      const userId = new Types.ObjectId().toString();
      const mockTx = { _id: new Types.ObjectId() };
      
      const mockWalletDoc = { balance: "500.00", save: jest.fn().mockResolvedValue(true) };
      mockTransactionModel.create.mockResolvedValue([mockTx]);
      mockFiatWalletModel.findOne.mockResolvedValue(mockWalletDoc);

      // Deposit: DEBIT (+) platform asset, CREDIT (-) user liability.
      // The user's cached balance must INCREASE on a liability credit.
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
      expect(mockWalletDoc.save).toHaveBeenCalled();
      expect(mockWalletDoc.balance).toBe("600.00");
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
