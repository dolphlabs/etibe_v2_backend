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
}
