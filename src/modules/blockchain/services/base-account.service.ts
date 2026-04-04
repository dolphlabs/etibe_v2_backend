import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ethers,
  JsonRpcProvider,
  Wallet,
  Contract,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
} from "ethers";
import { VaultService, EncryptedData } from "./vault.service";
import { BASE_TOKEN_CONTRACTS } from "../../../shared/constants";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface BaseAccountCredentials {
  baseAddress: string;
  publicKey: string;
  encryptedPrivateKey: EncryptedData;
}

@Injectable()
export class BaseAccountService implements OnModuleInit {
  private readonly logger = new Logger(BaseAccountService.name);
  private provider!: JsonRpcProvider;
  private masterWallet!: Wallet;
  private readonly network: string;
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly vaultService: VaultService,
  ) {
    this.network = this.configService.get<string>("base.network", "sepolia");
  }

  async onModuleInit(): Promise<void> {
    await this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      const rpcUrl = this.configService.get<string>("base.rpcUrl");
      const masterPrivateKey = this.configService.get<string>(
        "base.masterPrivateKey",
      );

      if (!masterPrivateKey) {
        this.logger.warn(
          "BASE_MASTER_PRIVATE_KEY not configured. Base account operations will fail.",
        );
        return;
      }

      const chainId = this.configService.get<number>("base.chainId");
      this.provider = new JsonRpcProvider(rpcUrl, chainId);
      this.masterWallet = new Wallet(masterPrivateKey, this.provider);

      const masterAddress = this.masterWallet.address;
      const balance = await this.provider.getBalance(masterAddress);

      this.logger.log(
        `BaseAccountService initialized. Master: ${masterAddress}, Balance: ${formatEther(balance)} ETH`,
      );

      this.initialized = true;
    } catch (error) {
      this.logger.error("Failed to initialize Base account service", error);
    }
  }

  generateKeyPair(): {
    address: string;
    publicKey: string;
    privateKey: string;
  } {
    const wallet = Wallet.createRandom();
    return {
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
    };
  }

  async createAccount(
    username: string,
  ): Promise<BaseAccountCredentials> {
    const { address, publicKey, privateKey } = this.generateKeyPair();

    this.logger.log(
      `Created Base account for ${username}: ${address}`,
    );

    const encryptedPrivateKey =
      this.vaultService.encryptPrivateKey(privateKey);

    return {
      baseAddress: address,
      publicKey,
      encryptedPrivateKey,
    };
  }

  async fundAccount(
    address: string,
    amountEth: string,
  ): Promise<{ txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    this.logger.log(`Funding ${address} with ${amountEth} ETH`);

    const tx = await this.masterWallet.sendTransaction({
      to: address,
      value: parseEther(amountEth),
    });

    const receipt = await tx.wait();

    this.logger.log(`Funded ${address}, txHash: ${receipt!.hash}`);

    return { txHash: receipt!.hash };
  }

  decryptAndGetWallet(encryptedPrivateKey: EncryptedData): Wallet {
    const privateKey =
      this.vaultService.decryptPrivateKey(encryptedPrivateKey);
    return new Wallet(privateKey, this.provider);
  }

  async getBalance(address: string): Promise<string> {
    const balance = await this.provider.getBalance(address);
    return formatEther(balance);
  }

  async getTokenBalance(
    address: string,
    tokenAddress: string,
  ): Promise<string> {
    const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address) as Promise<bigint>,
      contract.decimals() as Promise<number>,
    ]);
    return formatUnits(balance, decimals);
  }

  async getWalletBalances(address: string): Promise<{
    ETH: string;
    CNGN: string;
    USDC: string;
  }> {
    const balances = { ETH: "0", CNGN: "0", USDC: "0" };

    try {
      balances.ETH = await this.getBalance(address);
    } catch (error: any) {
      this.logger.warn(
        `Failed to get ETH balance for ${address}: ${error.message}`,
      );
    }

    const tokenAddresses = this.getTokenAddresses();

    this.logger.debug(
      `Querying token balances for ${address} — cNGN contract: ${tokenAddresses.CNGN}, USDC contract: ${tokenAddresses.USDC}, network: ${this.network}`,
    );

    try {
      balances.CNGN = await this.getTokenBalance(
        address,
        tokenAddresses.CNGN,
      );
      this.logger.debug(`cNGN raw balance for ${address}: ${balances.CNGN}`);
    } catch (error: any) {
      this.logger.warn(
        `Failed to get cNGN balance for ${address}: ${error.message}`,
      );
    }

    try {
      balances.USDC = await this.getTokenBalance(
        address,
        tokenAddresses.USDC,
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to get USDC balance for ${address}: ${error.message}`,
      );
    }

    return balances;
  }

  async deployCircleContract(
    circleId: string,
    circleName: string,
    creatorAddress: string,
    tokenAddress: string,
    contributionAmount: string,
    maxMembers: number,
    gracePeriodDays: number,
  ): Promise<{ contractAddress: string; txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    this.logger.log(
      `Deploying circle contract for ${circleId}: ${circleName}`,
    );

    try {
      // Load ABI and bytecode from the compiled contract
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const contractArtifact = require("../abis/EtibeCircle.json");
      const factory = new ethers.ContractFactory(
        contractArtifact.abi,
        contractArtifact.bytecode,
        this.masterWallet,
      );

      const decimals = 6; // cNGN and USDC both use 6 decimals
      const contributionAmountAtomic = parseUnits(
        this.toPlainString(contributionAmount),
        tokenAddress === ethers.ZeroAddress ? 18 : decimals,
      );

      const contract = await factory.deploy(
        circleName,
        creatorAddress,
        tokenAddress,
        contributionAmountAtomic,
        maxMembers,
        gracePeriodDays,
      );

      await contract.waitForDeployment();

      const contractAddress = await contract.getAddress();
      const deployTx = contract.deploymentTransaction();

      this.logger.log(
        `Circle contract deployed at ${contractAddress}, txHash: ${deployTx?.hash}`,
      );

      return {
        contractAddress,
        txHash: deployTx?.hash || "deployed",
      };
    } catch (error) {
      this.logger.error(
        `Failed to deploy circle contract for ${circleId}`,
        error,
      );
      throw new BadRequestException(
        `Failed to deploy circle contract: ${(error as Error).message}`,
      );
    }
  }

  async executeContribution(
    userEncryptedPrivateKey: EncryptedData,
    circleContractAddress: string,
    amount: string,
    currency: string,
  ): Promise<{ txHash: string; amount: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    const userWallet = this.decryptAndGetWallet(userEncryptedPrivateKey);

    try {
      let txHash: string;

      const amountStr = this.toPlainString(amount);

      if (currency === "ETH") {
        // Native ETH contribution — send directly to contract
        const tx = await userWallet.sendTransaction({
          to: circleContractAddress,
          value: parseEther(amountStr),
        });
        const receipt = await tx.wait();
        txHash = receipt!.hash;
      } else {
        // ERC-20 contribution — approve + call contract
        const tokenAddress = this.getTokenAddress(currency);
        const tokenContract = new Contract(
          tokenAddress,
          ERC20_ABI,
          userWallet,
        );

        const atomicAmount = parseUnits(amountStr, 6);

        // Approve the circle contract to spend tokens
        const approveTx = await tokenContract.approve(
          circleContractAddress,
          atomicAmount,
        );
        await approveTx.wait();

        // Load circle contract and call contributeToken
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const contractArtifact = require("../abis/EtibeCircle.json");
        const circleContract = new Contract(
          circleContractAddress,
          contractArtifact.abi,
          userWallet,
        );

        const contributeTx = await circleContract.contributeToken(
          atomicAmount,
        );
        const receipt = await contributeTx.wait();
        txHash = receipt!.hash;
      }

      this.logger.log(
        `Contribution executed: ${amount} ${currency} to ${circleContractAddress}, txHash: ${txHash}`,
      );

      return { txHash, amount };
    } catch (error: any) {
      this.logger.error(
        `Failed to execute contribution to ${circleContractAddress}:`,
        error,
      );
      throw new BadRequestException(
        `Failed to process contribution: ${error.message}`,
      );
    }
  }

  async executeEthTransfer(
    fromEncryptedKey: EncryptedData,
    toAddress: string,
    amountEth: string,
  ): Promise<{ txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    const wallet = this.decryptAndGetWallet(fromEncryptedKey);

    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: parseEther(amountEth),
    });

    const receipt = await tx.wait();

    this.logger.log(
      `ETH transfer: ${amountEth} ETH to ${toAddress}, txHash: ${receipt!.hash}`,
    );

    return { txHash: receipt!.hash };
  }

  async executeErc20Transfer(
    fromEncryptedKey: EncryptedData,
    tokenAddress: string,
    toAddress: string,
    amount: string,
    decimals: number = 6,
  ): Promise<{ txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    const wallet = this.decryptAndGetWallet(fromEncryptedKey);
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, wallet);

    const atomicAmount = parseUnits(amount, decimals);
    const tx = await tokenContract.transfer(toAddress, atomicAmount);
    const receipt = await tx.wait();

    this.logger.log(
      `ERC-20 transfer: ${amount} to ${toAddress}, txHash: ${receipt!.hash}`,
    );

    return { txHash: receipt!.hash };
  }

  async releasePayout(
    circleContractAddress: string,
  ): Promise<{ txHash: string }> {
    if (!this.initialized) {
      throw new BadRequestException("Base account service not initialized");
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const contractArtifact = require("../abis/EtibeCircle.json");
    const circleContract = new Contract(
      circleContractAddress,
      contractArtifact.abi,
      this.masterWallet,
    );

    const tx = await circleContract.releasePayout();
    const receipt = await tx.wait();

    this.logger.log(
      `Payout released on ${circleContractAddress}, txHash: ${receipt!.hash}`,
    );

    return { txHash: receipt!.hash };
  }

  getTokenAddress(currency: string): string {
    const addresses = this.getTokenAddresses();
    const address = addresses[currency as keyof typeof addresses];
    if (!address) {
      throw new BadRequestException(
        `Unsupported currency for Base chain: ${currency}`,
      );
    }
    return address;
  }

  /**
   * Safely converts a value to a plain string.
   * Handles Mongoose Decimal128 objects ({ $numberDecimal: "..." }).
   */
  private toPlainString(value: any): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && value.$numberDecimal) return value.$numberDecimal;
    if (value && typeof value.toString === "function") return value.toString();
    return String(value);
  }

  getTokenAddresses(): { CNGN: string; USDC: string } {
    const network = this.network === "mainnet" ? "mainnet" : "sepolia";
    return BASE_TOKEN_CONTRACTS[network];
  }

  getExplorerUrl(txHashOrAddress: string): string {
    const baseUrl =
      this.network === "mainnet"
        ? "https://basescan.org"
        : "https://sepolia.basescan.org";
    return `${baseUrl}/tx/${txHashOrAddress}`;
  }

  getMasterAddress(): string {
    return this.masterWallet?.address || "";
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
