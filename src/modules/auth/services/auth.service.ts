import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { UserRepository } from "../../users/repositories";
import { SessionService } from "./session.service";
import { MailService } from "./mail.service";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import { VaultService } from "../../blockchain/services/vault.service";
import { UserDocument } from "../../users/schemas";
import {
  SessionMetadata,
  AuthenticatedUser,
  EtibeSession,
} from "../../../shared/types/session.types";
import { RegisterDto, LoginDto, VerifyEmailDto } from "../dto/auth.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionService: SessionService,
    private readonly mailService: MailService,
    private readonly nearAccountService: NearAccountService,
    private readonly vaultService: VaultService
  ) {}

  async register(
    registerDto: RegisterDto,
    deviceId: string,
    metadata: SessionMetadata
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    const emailExists = await this.userRepository.emailExists(
      registerDto.email
    );
    if (emailExists) {
      throw new ConflictException("Email already exists");
    }

    const usernameExists = await this.userRepository.usernameExists(
      registerDto.username
    );
    if (usernameExists) {
      throw new ConflictException("Username already taken");
    }

    const hashedPassword = await this.hashPassword(registerDto.password);

    const user = await this.userRepository.create({
      email: registerDto.email.toLowerCase(),
      username: registerDto.username.toLowerCase(),
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      password: hashedPassword,
      phone: registerDto.phone,
      isEmailVerified: false,
      onboardingCompleted: false,
    } as Partial<UserDocument>);

    const otp = this.vaultService.generateSecureOtp(6);

    await this.mailService.sendVerificationOtp(
      user.email,
      otp,
      deviceId,
      user.firstName
    );

    const { session, token } = await this.sessionService.createSession(
      user._id.toString(),
      deviceId,
      metadata
    );

    this.logger.log(
      `New user registered: ${user.email} (pending verification)`
    );

    return {
      user: this.mapUserToAuthenticatedUser(user, session.sessionId, deviceId),
      token,
    };
  }

  async verifyEmail(
    email: string,
    dto: VerifyEmailDto,
    deviceId: string
  ): Promise<{ user: AuthenticatedUser; nearAccountId: string }> {
    const result = await this.mailService.verifyOtp(
      dto.email,
      dto.otp,
      deviceId
    );

    if (!result.valid) {
      throw new BadRequestException(
        result.error || "Invalid verification code"
      );
    }

    const user = await this.userRepository.findOne({
      email: dto.email.toLowerCase(),
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }

    const credentials = await this.nearAccountService.createSubAccount(
      user.username,
      "0.1"
    );

    const updatedUser = await this.userRepository.update(user._id.toString(), {
      isEmailVerified: true,
      isVerified: true,
      nearAccountId: credentials.nearAccountId,
      nearPublicKey: credentials.publicKey,
      nearEncryptedPrivateKey: credentials.encryptedPrivateKey,
      onboardingCompleted: true,
    } as Partial<UserDocument>);

    if (!updatedUser) {
      throw new BadRequestException("Failed to complete verification");
    }

    this.logger.log(
      `User ${user.email} verified. NEAR account: ${credentials.nearAccountId}`
    );

    return {
      user: this.mapUserToAuthenticatedUser(updatedUser, "", deviceId),
      nearAccountId: credentials.nearAccountId,
    };
  }

  async resendVerificationOtp(
    userId: string,
    deviceId: string
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.isEmailVerified) {
      throw new BadRequestException("Email already verified");
    }

    const otp = this.vaultService.generateSecureOtp(6);

    const result = await this.mailService.resendOtp(
      user.email,
      otp,
      deviceId,
      user.firstName
    );

    if (!result.success) {
      throw new BadRequestException("Failed to send verification email");
    }

    return {
      success: true,
      message: "Verification code sent to your email",
    };
  }

  async login(
    loginDto: LoginDto,
    deviceId: string,
    metadata: SessionMetadata
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    const user = await this.findUserByEmailOrUsername(loginDto.identifier);

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Account is deactivated");
    }

    const isPasswordValid = await this.verifyPassword(
      user.password,
      loginDto.password
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.userRepository.updateLastLogin(user._id.toString());

    const { session, token } = await this.sessionService.createSession(
      user._id.toString(),
      deviceId,
      metadata
    );

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.mapUserToAuthenticatedUser(user, session.sessionId, deviceId),
      token,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.invalidateSession(sessionId);
    this.logger.log(`Session logged out: ${sessionId}`);
  }

  async logoutAll(userId: string): Promise<{ invalidatedCount: number }> {
    const count = await this.sessionService.invalidateAllUserSessions(userId);
    this.logger.log(`All sessions logged out for user: ${userId}`);
    return { invalidatedCount: count };
  }

  async validateSession(
    token: string,
    deviceId?: string
  ): Promise<AuthenticatedUser | null> {
    const session = await this.sessionService.validateTokenAndSession(
      token,
      deviceId
    );

    if (!session) {
      return null;
    }

    const user = await this.userRepository.findById(session.userId);

    if (!user || !user.isActive) {
      return null;
    }

    await this.sessionService.touchSession(session.sessionId);

    return this.mapUserToAuthenticatedUser(
      user,
      session.sessionId,
      session.deviceId
    );
  }

  async getActiveSessions(userId: string): Promise<EtibeSession[]> {
    return this.sessionService.getUserSessions(userId);
  }

  async getOnboardingStatus(userId: string): Promise<{
    isEmailVerified: boolean;
    hasNearAccount: boolean;
    onboardingCompleted: boolean;
    nearAccountId?: string;
  }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new BadRequestException("User not found");
    }

    return {
      isEmailVerified: user.isEmailVerified,
      hasNearAccount: !!user.nearAccountId,
      onboardingCompleted: user.onboardingCompleted,
      nearAccountId: user.nearAccountId,
    };
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  private async verifyPassword(
    hash: string,
    password: string
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async findUserByEmailOrUsername(
    identifier: string
  ): Promise<UserDocument | null> {
    let user = await this.userRepository.findByEmail(identifier, true);

    if (!user) {
      user = await this.userRepository.findByUsername(identifier, true);
    }

    return user;
  }

  private mapUserToAuthenticatedUser(
    user: UserDocument,
    sessionId: string,
    deviceId: string
  ): AuthenticatedUser {
    return {
      _id: user._id,
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      avatar: user.avatar,
      isVerified: user.isVerified,
      nearWalletAddress: user.nearAccountId,
      sessionId,
      deviceId,
    };
  }
}
