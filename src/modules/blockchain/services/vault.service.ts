import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private masterKey!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const masterKeyEnv = this.configService.get<string>("vault.masterKey");

    if (!masterKeyEnv) {
      this.logger.error(
        "MASTER_ENCRYPTION_KEY is not set. Key encryption will fail."
      );
      throw new Error("MASTER_ENCRYPTION_KEY environment variable is required");
    }

    if (masterKeyEnv.length < 32) {
      this.logger.error("MASTER_ENCRYPTION_KEY must be at least 32 characters");
      throw new Error("MASTER_ENCRYPTION_KEY must be at least 32 characters");
    }

    this.masterKey = Buffer.from(masterKeyEnv, "utf-8").subarray(0, 32);
    this.logger.log("VaultService initialized with master encryption key");
  }

  encrypt(plaintext: string): EncryptedData {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    const derivedKey = scryptSync(this.masterKey, salt, KEY_LENGTH);

    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

    let ciphertext = cipher.update(plaintext, "utf8", "base64");
    ciphertext += cipher.final("base64");

    const authTag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      salt: salt.toString("base64"),
    };
  }

  decrypt(encryptedData: EncryptedData): string {
    const salt = Buffer.from(encryptedData.salt, "base64");
    const iv = Buffer.from(encryptedData.iv, "base64");
    const authTag = Buffer.from(encryptedData.authTag, "base64");

    const derivedKey = scryptSync(this.masterKey, salt, KEY_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(encryptedData.ciphertext, "base64", "utf8");
    plaintext += decipher.final("utf8");

    return plaintext;
  }

  encryptPrivateKey(privateKey: string): EncryptedData {
    return this.encrypt(privateKey);
  }

  decryptPrivateKey(encryptedData: EncryptedData): string {
    return this.decrypt(encryptedData);
  }

  generateSecureOtp(length: number = 6): string {
    const digits = "0123456789";
    const bytes = randomBytes(length);
    let otp = "";

    for (let i = 0; i < length; i++) {
      otp += digits[bytes[i] % 10];
    }

    return otp;
  }

  hashForRateLimit(identifier: string): string {
    const hash = scryptSync(identifier, "rate-limit-salt", 16);
    return hash.toString("hex");
  }
}
