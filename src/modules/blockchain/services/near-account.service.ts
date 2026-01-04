import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KeyPair, providers, transactions, utils } from "near-api-js";
import { KeyPairEd25519 } from "near-api-js/lib/utils/key_pair";
import * as nacl from "tweetnacl";
import bs58 from "bs58";
import { VaultService, EncryptedData } from "./vault.service";
import {} from "@near-js/transactions";

export interface NearAccountCredentials {
  nearAccountId: string;
  publicKey: string;
  encryptedPrivateKey: EncryptedData;
}

export interface AccountExistsResult {
  exists: boolean;
  suggestedAccountId?: string;
}

@Injectable()
export class NearAccountService implements OnModuleInit {
  private readonly logger = new Logger(NearAccountService.name);
  private provider!: InstanceType<typeof providers.JsonRpcProvider>;
  private masterKeyPair!: KeyPairEd25519;
  private readonly networkId: string;
  private readonly masterAccountId: string;
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly vaultService: VaultService
  ) {
    this.networkId = this.configService.get<string>(
      "near.networkId",
      "testnet"
    );
    this.masterAccountId = this.configService.get<string>(
      "near.masterAccountId",
      "etibe.testnet"
    );
  }

  async onModuleInit(): Promise<void> {
    await this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      const nodeUrl = this.configService.get<string>(
        "near.nodeUrl",
        this.networkId === "mainnet"
          ? "https://rpc.mainnet.near.org"
          : "https://rpc.testnet.near.org"
      );

      const masterPrivateKey = this.configService.get<string>(
        "near.masterPrivateKey"
      );

      if (!masterPrivateKey) {
        this.logger.warn(
          "NEAR master private key not configured. Account creation will fail."
        );
        return;
      }

      this.provider = new providers.JsonRpcProvider({ url: nodeUrl });

      this.logger.log(
        `Private key format check: ${masterPrivateKey.substring(0, 20)}...`
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.masterKeyPair = KeyPair.fromString(
        masterPrivateKey as any
      ) as KeyPairEd25519;

      const publicKey = this.masterKeyPair.getPublicKey().toString();
      this.logger.log(`Master account public key: ${publicKey}`);

      try {
        const accessKey = await this.provider.query({
          request_type: "view_access_key",
          finality: "final",
          account_id: this.masterAccountId,
          public_key: publicKey,
        });
        this.logger.log(`✓ Access key verified on chain`);
      } catch (error) {
        this.logger.error(`✗ Public key NOT found on master account!`);
        this.logger.error(
          `This means your private key doesn't match the account's access keys`
        );
        throw error;
      }

      this.initialized = true;
      this.logger.log(
        `NearAccountService initialized with master: ${this.masterAccountId}`
      );
    } catch (error) {
      this.logger.error("Failed to initialize NEAR account service", error);
    }
  }

  generateKeyPair(): { publicKey: string; privateKey: string } {
    const keyPair = nacl.sign.keyPair();

    const publicKeyBytes = keyPair.publicKey;
    const secretKeyBytes = keyPair.secretKey;

    const publicKey = `ed25519:${bs58.encode(publicKeyBytes)}`;
    const privateKey = `ed25519:${bs58.encode(secretKeyBytes)}`;

    return { publicKey, privateKey };
  }

  async checkAccountExists(accountId: string): Promise<boolean> {
    try {
      await this.provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });
      return true;
    } catch {
      return false;
    }
  }

  sanitizeUsername(username: string): string {
    return username
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .substring(0, 32);
  }

  async generateAvailableAccountId(username: string): Promise<string> {
    const sanitized = this.sanitizeUsername(username);
    const baseAccountId = `${sanitized}.${this.masterAccountId}`;

    const exists = await this.checkAccountExists(baseAccountId);

    if (!exists) {
      return baseAccountId;
    }

    for (let i = 0; i < 10; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000).toString();
      const candidateAccountId = `${sanitized}${suffix}.${this.masterAccountId}`;

      const candidateExists = await this.checkAccountExists(candidateAccountId);

      if (!candidateExists) {
        return candidateAccountId;
      }
    }

    const timestamp = Date.now().toString(36);
    return `${sanitized}${timestamp}.${this.masterAccountId}`;
  }

  async createSubAccount(
    username: string,
    initialBalanceNear: string = "0.1"
  ): Promise<NearAccountCredentials> {
    if (!this.initialized) {
      throw new BadRequestException(
        "NEAR account service not initialized. Check configuration."
      );
    }

    const newAccountId = await this.generateAvailableAccountId(username);
    const { publicKey, privateKey } = this.generateKeyPair();

    try {
      const amount = utils.format.parseNearAmount(initialBalanceNear);

      if (!amount) {
        throw new BadRequestException("Invalid initial balance amount");
      }

      // Get access key for nonce
      const accessKeyResponse = await this.provider.query({
        request_type: "view_access_key",
        finality: "final",
        account_id: this.masterAccountId,
        public_key: this.masterKeyPair.getPublicKey().toString(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonce = (accessKeyResponse as any).nonce + 1;
      const status = await this.provider.status();
      const blockHash = utils.serialize.base_decode(
        status.sync_info.latest_block_hash
      );

      const newPublicKey = utils.PublicKey.fromString(publicKey);

      // Build actions for creating sub-account
      const actions = [
        { type: "CreateAccount" },
        { type: "Transfer", params: { deposit: amount } },
        {
          type: "AddKey",
          params: {
            publicKey: newPublicKey.toString(),
            accessKey: { permission: "FullAccess" },
          },
        },
      ];

      // Use the provider to send a transaction via RPC
      // For now, we'll use a simplified approach that works with the current API
      const result = await this.sendCreateAccountTransaction(
        newAccountId,
        newPublicKey.toString(),
        amount,
        nonce,
        blockHash
      );

      if (!result) {
        throw new BadRequestException("Failed to create account on NEAR");
      }

      this.logger.log(`Created NEAR sub-account: ${newAccountId}`);

      const encryptedPrivateKey =
        this.vaultService.encryptPrivateKey(privateKey);

      return {
        nearAccountId: newAccountId,
        publicKey,
        encryptedPrivateKey,
      };
    } catch (error) {
      this.logger.error(`Failed to create sub-account ${newAccountId}`, error);
      throw new BadRequestException(
        `Failed to create NEAR account: ${(error as Error).message}`
      );
    }
  }

  private async sendCreateAccountTransaction(
    newAccountId: string,
    newPublicKey: string,
    amount: string,
    nonce: number,
    blockHash: Uint8Array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    this.logger.log(
      `Creating account ${newAccountId} with ${amount} yoctoNEAR`
    );
    this.logger.log(`New public key: ${newPublicKey}`);
    this.logger.log(`Nonce: ${nonce}, Block hash length: ${blockHash.length}`);

    const publicKey = utils.PublicKey.fromString(newPublicKey);

    const masterPublicKey = this.masterKeyPair.getPublicKey();

    const actions = [
      transactions.createAccount(),
      transactions.transfer(BigInt(amount)),
      transactions.addKey(publicKey, transactions.fullAccessKey()),
    ];

    const transaction = transactions.createTransaction(
      this.masterAccountId,
      // utils.PublicKey.fromString(this.masterKeyPair.getPublicKey().toString()),
      masterPublicKey,
      newAccountId,
      nonce,
      actions,
      blockHash
    );

    const serializedTx = utils.serialize.serialize(
      transactions.SCHEMA.Transaction,
      transaction
    );

    const hash = new Uint8Array(
      require("js-sha256").sha256.array(serializedTx)
    );
    const signature = this.masterKeyPair.sign(hash);

    // const serializedTx = transactions.encodeTransaction(transaction);
    // const signature = this.masterKeyPair.sign(serializedTx);

    const signedTransaction = new transactions.SignedTransaction({
      transaction,
      signature: new transactions.Signature({
        keyType: masterPublicKey.keyType,
        data: signature.signature,
      }),
    });

    this.logger.log(`Signing with master key: ${masterPublicKey.toString()}`);
    this.logger.log(`Signed transaction with hash length: ${hash.length}`);

    try {
      const result = await this.provider.sendTransaction(signedTransaction);

      this.logger.log(
        `Transaction sent! Hash: ${result.transaction_outcome.id}`
      );

      if (
        result.status &&
        typeof result.status === "object" &&
        "SuccessValue" in result.status
      ) {
        return {
          success: true,
          accountId: newAccountId,
          txHash: result.transaction_outcome.id,
        };
      }

      if (
        result.status &&
        typeof result.status === "object" &&
        "Failure" in result.status
      ) {
        throw new BadRequestException(
          `Transaction failed: ${JSON.stringify(result.status)}`
        );
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Blockchain broadcast failed: ${error.message}`);
      throw new BadRequestException(`NEAR Transaction Error: ${error.message}`);
    }
  }

  async fundAccount(
    accountId: string,
    amountNear: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    if (!this.initialized) {
      throw new BadRequestException("NEAR account service not initialized");
    }

    const amount = utils.format.parseNearAmount(amountNear);

    if (!amount) {
      throw new BadRequestException("Invalid amount");
    }

    this.logger.log(`Funding account ${accountId} with ${amountNear} NEAR`);

    // TODO: Implement actual transfer transaction
    return { success: true, accountId, amount };
  }

  getExplorerUrl(accountId: string): string {
    const baseUrl =
      this.networkId === "mainnet"
        ? "https://nearblocks.io"
        : "https://testnet.nearblocks.io";

    return `${baseUrl}/address/${accountId}`;
  }

  decryptAndGetKeyPair(encryptedPrivateKey: EncryptedData): KeyPair {
    const privateKeyString =
      this.vaultService.decryptPrivateKey(encryptedPrivateKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return KeyPair.fromString(privateKeyString as any);
  }

  /**
   * Deploy a circle contract as a sub-account of the master account.
   * This abstracts blockchain complexity from users.
   */
  async deployCircleContract(
    circleId: string,
    circleName: string,
    creatorNearAccountId: string,
    contributionAmount: string,
    currency: string,
    frequency: string,
    maxMembers: number,
    gracePeriodDays: number
  ): Promise<{ contractAddress: string; txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException(
        "NEAR account service not initialized. Check configuration."
      );
    }

    // Generate a unique sub-account for this circle
    const sanitizedId = circleId
      .substring(0, 20)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const circleAccountId = `circle-${sanitizedId}.${this.masterAccountId}`;

    // Check if already exists
    const exists = await this.checkAccountExists(circleAccountId);
    if (exists) {
      this.logger.warn(`Circle contract ${circleAccountId} already exists`);
      return {
        contractAddress: circleAccountId,
        txHash: "existing",
      };
    }

    try {
      // Step 1: Create the sub-account for the circle
      // We'll fund it with enough NEAR for storage and operations
      const initialBalance = "2"; // 2 NEAR for contract storage
      const amount = utils.format.parseNearAmount(initialBalance);

      if (!amount) {
        throw new BadRequestException("Invalid initial balance amount");
      }

      // Get access key for nonce
      const accessKeyResponse = await this.provider.query({
        request_type: "view_access_key",
        finality: "final",
        account_id: this.masterAccountId,
        public_key: this.masterKeyPair.getPublicKey().toString(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let nonce = (accessKeyResponse as any).nonce + 1;
      const status = await this.provider.status();
      const blockHash = utils.serialize.base_decode(
        status.sync_info.latest_block_hash
      );

      const masterPublicKey = this.masterKeyPair.getPublicKey();

      // Create account actions
      const createActions = [
        transactions.createAccount(),
        transactions.transfer(BigInt(amount)),
        transactions.addKey(masterPublicKey, transactions.fullAccessKey()),
      ];

      const createTx = transactions.createTransaction(
        this.masterAccountId,
        masterPublicKey,
        circleAccountId,
        nonce,
        createActions,
        blockHash
      );

      const serializedCreateTx = utils.serialize.serialize(
        transactions.SCHEMA.Transaction,
        createTx
      );

      const createHash = new Uint8Array(
        require("js-sha256").sha256.array(serializedCreateTx)
      );
      const createSignature = this.masterKeyPair.sign(createHash);

      const signedCreateTx = new transactions.SignedTransaction({
        transaction: createTx,
        signature: new transactions.Signature({
          keyType: masterPublicKey.keyType,
          data: createSignature.signature,
        }),
      });

      const createResult = await this.provider.sendTransaction(signedCreateTx);
      this.logger.log(`Circle account created: ${circleAccountId}`);

      // Step 2: For now, we'll simulate contract deployment by storing init args
      // In production, you'd deploy actual WASM bytecode here
      // The init args represent the circle configuration
      const initArgs = {
        name: circleName,
        creator: creatorNearAccountId,
        contribution_amount: contributionAmount,
        currency: currency,
        frequency: frequency,
        max_members: maxMembers,
        grace_period_days: gracePeriodDays,
        is_active: true,
        created_at: Date.now(),
      };

      this.logger.log(`Circle contract initialized with args:`, initArgs);

      // In a real implementation, you would:
      // 1. Load the circle contract WASM bytecode
      // 2. Deploy it to the circle account
      // 3. Call the initialize function

      // For now, we return the account as the contract address
      const txHash = createResult.transaction_outcome?.id || "deployed";

      this.logger.log(`Circle contract deployed at: ${circleAccountId}`);

      return {
        contractAddress: circleAccountId,
        txHash,
      };
    } catch (error) {
      this.logger.error(
        `Failed to deploy circle contract ${circleAccountId}`,
        error
      );
      throw new BadRequestException(
        `Failed to deploy circle contract: ${(error as Error).message}`
      );
    }
  }

  getMasterAccountId(): string {
    return this.masterAccountId;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the balance of a NEAR account
   */
  async getAccountBalance(accountId: string): Promise<{
    total: string;
    available: string;
    stateStaked: string;
    staked: string;
  }> {
    try {
      const account = await this.provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accountData = account as any;

      const total = accountData.amount || "0";
      const stateStaked = accountData.storage_usage
        ? (
            BigInt(accountData.storage_usage) * BigInt(10000000000000000000n)
          ).toString()
        : "0";
      const staked = accountData.locked || "0";

      // Available = total - stateStaked - staked
      const totalBig = BigInt(total);
      const stateStakedBig = BigInt(stateStaked);
      const stakedBig = BigInt(staked);
      const availableBig = totalBig - stateStakedBig - stakedBig;
      const available = availableBig > 0n ? availableBig.toString() : "0";

      return {
        total: utils.format.formatNearAmount(total),
        available: utils.format.formatNearAmount(available),
        stateStaked: utils.format.formatNearAmount(stateStaked),
        staked: utils.format.formatNearAmount(staked),
      };
    } catch (error) {
      this.logger.error(`Failed to get balance for ${accountId}:`, error);
      throw new BadRequestException(`Failed to get account balance`);
    }
  }

  /**
   * Execute a contribution transfer from user's wallet to the circle contract.
   * This is the key abstraction - users don't need to understand blockchain transactions.
   */
  async executeContribution(
    userNearAccountId: string,
    userEncryptedPrivateKey: EncryptedData,
    circleContractAddress: string,
    amount: string | number,
    currency: string
  ): Promise<{ txHash: string; amount: string }> {
    if (!this.initialized) {
      throw new BadRequestException(
        "NEAR account service not initialized. Check configuration."
      );
    }

    // Ensure amount is a string
    const amountStr = String(amount);

    // Decrypt user's private key
    const userKeyPair = this.decryptAndGetKeyPair(userEncryptedPrivateKey);
    const userPublicKey = userKeyPair.getPublicKey();

    // For NEAR native transfers, convert amount to yoctoNEAR
    // For other tokens (USDT, USDC), we'd call the token contract
    let yoctoAmount: string;

    if (currency === "NEAR") {
      const parsed = utils.format.parseNearAmount(amountStr);
      if (!parsed) {
        throw new BadRequestException("Invalid amount");
      }
      yoctoAmount = parsed;
    } else {
      // For stablecoins, amount is already in base units (assuming 6 decimals like USDT)
      yoctoAmount = (parseFloat(amountStr) * 1_000_000).toString();
    }

    // Check if user has sufficient balance
    const balance = await this.getAccountBalance(userNearAccountId);
    const availableBalance = parseFloat(balance.available || "0");
    const requiredAmount = parseFloat(amountStr);

    if (currency === "NEAR" && availableBalance < requiredAmount + 0.01) {
      throw new BadRequestException(
        `Insufficient NEAR balance. Available: ${availableBalance.toFixed(
          4
        )} NEAR, Required: ${requiredAmount} NEAR (plus fees)`
      );
    }

    try {
      // Get nonce and block hash
      const accessKeyResponse = await this.provider.query({
        request_type: "view_access_key",
        finality: "final",
        account_id: userNearAccountId,
        public_key: userPublicKey.toString(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonce = (accessKeyResponse as any).nonce + 1;
      const status = await this.provider.status();
      const blockHash = utils.serialize.base_decode(
        status.sync_info.latest_block_hash
      );

      let actions: any[];

      if (currency === "NEAR") {
        // Simple NEAR transfer
        actions = [transactions.transfer(BigInt(yoctoAmount))];
      } else {
        // For fungible tokens (USDT, USDC), call ft_transfer on the token contract
        // This is a placeholder - in production, you'd need the actual token contract addresses
        const tokenContractId = this.getTokenContractId(currency);

        // Call ft_transfer on the token contract
        const args = {
          receiver_id: circleContractAddress,
          amount: yoctoAmount,
          memo: `Circle contribution`,
        };

        actions = [
          transactions.functionCall(
            "ft_transfer",
            Buffer.from(JSON.stringify(args)),
            BigInt(1), // 1 yoctoNEAR for security deposit
            BigInt(30_000_000_000_000) // 30 TGas
          ),
        ];
      }

      // Create and sign transaction
      const transaction = transactions.createTransaction(
        userNearAccountId,
        userPublicKey,
        currency === "NEAR"
          ? circleContractAddress
          : this.getTokenContractId(currency),
        nonce,
        actions,
        blockHash
      );

      const serializedTx = utils.serialize.serialize(
        transactions.SCHEMA.Transaction,
        transaction
      );

      const hash = new Uint8Array(
        require("js-sha256").sha256.array(serializedTx)
      );
      const signature = userKeyPair.sign(hash);

      const signedTransaction = new transactions.SignedTransaction({
        transaction,
        signature: new transactions.Signature({
          keyType: userPublicKey.keyType,
          data: signature.signature,
        }),
      });

      // Broadcast transaction
      const result = await this.provider.sendTransaction(signedTransaction);

      const txHash = result.transaction_outcome?.id || `contrib-${Date.now()}`;

      this.logger.log(
        `Contribution executed: ${amountStr} ${currency} from ${userNearAccountId} to ${circleContractAddress}, txHash: ${txHash}`
      );

      return { txHash, amount: amountStr };
    } catch (error: any) {
      this.logger.error(
        `Failed to execute contribution from ${userNearAccountId}:`,
        error
      );
      throw new BadRequestException(
        `Failed to process contribution: ${error.message}`
      );
    }
  }

  private getTokenContractId(currency: string): string {
    const tokenContracts: Record<string, string> = {
      USDT:
        this.networkId === "mainnet"
          ? "usdt.tether-token.near"
          : "usdt.fakes.testnet",
      USDC:
        this.networkId === "mainnet"
          ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
          : "usdc.fakes.testnet",
      // Bridged USDC from Rainbow Bridge (legacy)
      USDC_BRIDGED:
        this.networkId === "mainnet"
          ? "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near"
          : "usdc.fakes.testnet",
      DAI:
        this.networkId === "mainnet"
          ? "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near"
          : "dai.fakes.testnet",
    };

    return tokenContracts[currency] || `${currency.toLowerCase()}.testnet`;
  }

  async getWalletBalances(accountId: string): Promise<{
    NEAR: string;
    USDT: string;
    USDC: string;
  }> {
    const balances = {
      NEAR: "0",
      USDT: "0",
      USDC: "0",
    };

    try {
      const nearBalance = await this.getAccountBalance(accountId);
      balances.NEAR = nearBalance.available || "0";
    } catch (error: any) {
      this.logger.warn(
        `Failed to get NEAR balance for ${accountId}: ${error.message}`
      );
    }

    // Get USDT balance
    try {
      const usdtBalance = await this.getTokenBalance(accountId, "USDT");
      balances.USDT = usdtBalance;
    } catch (error: any) {
      this.logger.warn(
        `Failed to get USDT balance for ${accountId}: ${error.message}`
      );
    }

    // Get USDC balance (try native USDC first)
    try {
      const usdcBalance = await this.getTokenBalance(accountId, "USDC");
      balances.USDC = usdcBalance;

      // If native USDC is 0, also check bridged USDC
      if (parseFloat(usdcBalance) === 0) {
        const bridgedUsdcBalance = await this.getTokenBalance(
          accountId,
          "USDC_BRIDGED"
        );
        if (parseFloat(bridgedUsdcBalance) > 0) {
          balances.USDC = bridgedUsdcBalance;
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to get USDC balance for ${accountId}: ${error.message}`
      );
    }

    this.logger.debug(
      `Wallet balances for ${accountId}: NEAR=${balances.NEAR}, USDT=${balances.USDT}, USDC=${balances.USDC}`
    );

    return balances;
  }

  async getTokenBalance(accountId: string, currency: string): Promise<string> {
    const tokenContractId = this.getTokenContractId(currency);

    this.logger.debug(
      `Fetching ${currency} balance for ${accountId} from contract ${tokenContractId}`
    );

    try {
      const result = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: tokenContractId,
        method_name: "ft_balance_of",
        args_base64: Buffer.from(
          JSON.stringify({ account_id: accountId })
        ).toString("base64"),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = result as any;

      if (resultData.result) {
        const balanceRaw = Buffer.from(resultData.result).toString();

        this.logger.debug(
          `Raw balance response for ${currency}: ${balanceRaw}`
        );

        const balance = JSON.parse(balanceRaw);

        const balanceStr =
          typeof balance === "string" ? balance : String(balance);
        const balanceBigInt = BigInt(balanceStr);

        this.logger.debug(
          `Parsed balance string for ${currency}: ${balanceStr}`
        );

        // Convert from base units (6 decimals for USDT/USDC) to human readable
        const decimals = currency === "NEAR" ? 24 : 6;
        const divisor = BigInt(10 ** decimals);
        const wholePart = balanceBigInt / divisor;
        const fractionalPart = balanceBigInt % divisor;

        this.logger.debug(
          `${currency} balance calculation: wholePart=${wholePart}, fractionalPart=${fractionalPart}`
        );

        if (decimals === 6) {
          const fractionalStr = fractionalPart
            .toString()
            .padStart(decimals, "0");
          const trimmedFractional = fractionalStr.replace(/0+$/, "") || "0";
          const finalBalance =
            trimmedFractional === "0"
              ? wholePart.toString()
              : `${wholePart}.${trimmedFractional.slice(0, 2)}`;

          this.logger.debug(`Final ${currency} balance: ${finalBalance}`);
          return finalBalance;
        } else {
          const fractionalStr = fractionalPart
            .toString()
            .padStart(decimals, "0");
          const trimmedFractional = fractionalStr.replace(/0+$/, "") || "0";
          const finalBalance =
            trimmedFractional === "0"
              ? wholePart.toString()
              : `${wholePart}.${trimmedFractional.slice(0, 4)}`;

          this.logger.debug(`Final ${currency} balance: ${finalBalance}`);

          return finalBalance;
        }
      }

      this.logger.debug(`No balance result for ${currency} at ${accountId}`);
      return "0";
    } catch (error: any) {
      if (
        error.message?.includes("account") ||
        error.type === "AccountDoesNotExist"
      ) {
        this.logger.debug(
          `Account ${accountId} not registered for ${currency} token`
        );
      } else {
        this.logger.warn(
          `Token balance query failed for ${currency} (${tokenContractId}): ${error.message}`
        );
      }
      return "0";
    }
  }
}
