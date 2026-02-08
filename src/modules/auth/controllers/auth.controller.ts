import {
  Controller,
  Post,
  Get,
  Body,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { AuthService } from "../services/auth.service";
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  RefreshTokenDto,
  ResendOtpDto,
} from "../dto/auth.dto";
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from "../dto/recovery.dto";
import { Public } from "../../../core/decorators";
import {
  CurrentUser,
  CurrentUserId,
} from "../decorators/current-user.decorator";
import {
  AuthenticatedUser,
  SessionMetadata,
} from "../../../shared/types/session.types";
import { UserService } from "@modules/users";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import { CircleRepository } from "../../circles/repositories/circle.repository";
import { TransactionRepository } from "../../transactions/repositories/transaction.repository";

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly nearAccountService: NearAccountService,
    private readonly circleRepository: CircleRepository,
    private readonly transactionRepository: TransactionRepository,
  ) {}

  @Public()
  @Post("register")
  async register(
    @Body() registerDto: RegisterDto,
    @Req() request: FastifyRequest,
  ) {
    const deviceId = this.extractDeviceId(request);
    const metadata = this.extractSessionMetadata(request);

    const { user, accessToken, refreshToken } = await this.authService.register(
      registerDto,
      deviceId,
      metadata,
    );

    return {
      message: "Registration successful. Please verify your email.",
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      requiresVerification: true,
    };
  }

  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() request: FastifyRequest,
  ) {
    const deviceId = this.extractDeviceId(request);

    const { user, nearAccountId } = await this.authService.verifyEmail(
      dto.email,
      dto,
      deviceId,
    );

    return {
      message: "Email verified successfully. Your NEAR wallet is ready!",
      user: this.sanitizeUser(user),
      nearAccountId,
      onboardingCompleted: true,
    };
  }

  @Public()
  @Post("resend-otp")
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto, @Req() request: FastifyRequest) {
    const deviceId = this.extractDeviceId(request);
    const result = await this.authService.resendVerificationOtp(
      dto.email,
      deviceId,
    );

    return result;
  }

  @Get("onboarding-status")
  async getOnboardingStatus(@CurrentUserId() userId: string) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }
    return this.authService.getOnboardingStatus(userId);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() request: FastifyRequest) {
    const deviceId = loginDto.deviceId || this.extractDeviceId(request);
    const metadata = this.extractSessionMetadata(request);

    const { user, accessToken, refreshToken } = await this.authService.login(
      loginDto,
      deviceId,
      metadata,
    );

    return {
      message: "Login successful",
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const { accessToken } = await this.authService.refreshToken(
      dto.refreshToken,
    );

    return {
      accessToken,
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    await this.authService.logout(user.sessionId);

    return { message: "Logged out successfully" };
  }

  @Post("logout-all")
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const { invalidatedCount } = await this.authService.logoutAll(user.id);

    return {
      message: `Logged out from ${invalidatedCount} session(s)`,
      invalidatedCount,
    };
  }

  @Get("me")
  async getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const result = await this.userService.findById(user.id);

    let walletBalance = result.walletBalance || {
      NEAR: "0",
      USDT: "0",
      USDC: "0",
    };

    if (result.nearAccountId) {
      try {
        const onChainBalances = await this.nearAccountService.getWalletBalances(
          result.nearAccountId,
        );

        walletBalance = {
          NEAR: onChainBalances.NEAR,
          USDT: onChainBalances.USDT,
          USDC: onChainBalances.USDC,
        };

        this.userService
          .update(user.id, {
            walletBalance: {
              ...walletBalance,
              lastUpdatedAt: new Date(),
            },
          } as any)
          .catch((err) =>
            this.logger.warn("Failed to update wallet balance:", err),
          );
      } catch (error) {
        this.logger.warn(
          `Failed to fetch on-chain balances for ${result.nearAccountId}`,
        );
      }
    }

    const [channelsJoined, completedContributions] = await Promise.all([
      this.circleRepository.countUserCircles(user.id),
      this.transactionRepository.countUserCompletedContributions(user.id),
    ]);

    return {
      user: {
        id: result._id,
        email: result.email,
        username: result.username,
        firstName: result.firstName,
        lastName: result.lastName,
        avatar: result.avatar,
        phone: result.phone,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        onboardingCompleted: result.onboardingCompleted,
        isVerified: result.isVerified,
        isEmailVerified: result.isEmailVerified,
        deletedAt: result.deletedAt,
        nearAccountId: result.nearAccountId,
        walletBalance,
        stats: {
          channelsJoined,
          completedContributions,
          missedContributions: 0, // Placeholder as requested
        },
      },
    };
  }

  @Get("sessions")
  async getActiveSessions(@CurrentUser() user: AuthenticatedUser) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const sessions = await this.authService.getActiveSessions(user.id);

    return {
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId.substring(0, 8) + "...",
        deviceId: session.deviceId.substring(0, 8) + "...",
        metadata: {
          ip: this.maskIp(session.metadata.ip),
          device: {
            os: session.metadata.device.os,
            browser: session.metadata.device.browser,
          },
        },
        createdAt: session.createdAt,
        lastActive: session.lastActive,
        isCurrent: session.sessionId === user.sessionId,
      })),
    };
  }

  @Delete("sessions/:sessionId")
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const sessions = await this.authService.getActiveSessions(user.id);
    const sessionBelongsToUser = sessions.some((s) =>
      s.sessionId.startsWith(sessionId.replace("...", "")),
    );

    if (!sessionBelongsToUser) {
      return { message: "Session not found" };
    }

    await this.authService.logout(sessionId);

    return { message: "Session revoked successfully" };
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    const metadata = this.extractSessionMetadata(request);
    const deviceId = this.extractDeviceId(request);

    this.logger.log(
      `[FORGOT_PASSWORD] Request from IP: ${
        metadata.ip
      }, Device: ${deviceId.substring(0, 8)}...`,
    );

    return this.authService.forgotPassword(dto, metadata);
  }

  @Public()
  @Post("resend-reset-otp")
  @HttpCode(HttpStatus.OK)
  async resendResetOtp(
    @Body() dto: ForgotPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    const metadata = this.extractSessionMetadata(request);
    return this.authService.forgotPassword(dto, metadata);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    const metadata = this.extractSessionMetadata(request);
    const deviceId = this.extractDeviceId(request);

    this.logger.log(
      `[RESET_PASSWORD] Request from IP: ${
        metadata.ip
      }, Device: ${deviceId.substring(0, 8)}...`,
    );

    return this.authService.resetPassword(dto, metadata);
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    const metadata = this.extractSessionMetadata(request);
    const deviceId = this.extractDeviceId(request);

    this.logger.log(
      `[CHANGE_PASSWORD] User: ${user.email}, IP: ${
        metadata.ip
      }, Device: ${deviceId.substring(0, 8)}...`,
    );

    return this.authService.changePassword(user.id, dto, metadata);
  }

  private extractDeviceId(request: FastifyRequest): string {
    const headerDeviceId = request.headers["x-device-id"] as string;
    if (headerDeviceId) {
      return headerDeviceId;
    }

    const userAgent = request.headers["user-agent"] || "";
    const ip = request.ip || "";
    return Buffer.from(`${userAgent}:${ip}`)
      .toString("base64")
      .substring(0, 32);
  }

  private extractSessionMetadata(request: FastifyRequest): SessionMetadata {
    const userAgent = request.headers["user-agent"] || "";
    const ip = request.ip || "unknown";

    const os = this.parseOS(userAgent);
    const browser = this.parseBrowser(userAgent);

    return {
      ip,
      device: {
        deviceId: this.extractDeviceId(request),
        os,
        browser,
        userAgent,
      },
    };
  }

  private sanitizeUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      avatar: user.avatar,
      isVerified: user.isVerified,
      nearAccountId: user.nearAccountId,
    };
  }

  private maskIp(ip: string): string {
    if (ip.includes(".")) {
      const parts = ip.split(".");
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip.substring(0, ip.length / 2) + "...";
  }

  private parseOS(userAgent: string): string {
    if (/windows/i.test(userAgent)) return "Windows";
    if (/macintosh|mac os x/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    if (/android/i.test(userAgent)) return "Android";
    if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
    return "Unknown";
  }

  private parseBrowser(userAgent: string): string {
    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) return "Chrome";
    if (/firefox/i.test(userAgent)) return "Firefox";
    if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent))
      return "Safari";
    if (/edge/i.test(userAgent)) return "Edge";
    if (/opera|opr/i.test(userAgent)) return "Opera";
    return "Unknown";
  }
}
