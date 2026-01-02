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
import { RegisterDto, LoginDto, VerifyEmailDto } from "../dto/auth.dto";
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

const AUTH_COOKIE_NAME = "etibe_auth";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService
  ) {}

  @Public()
  @Post("register")
  async register(
    @Body() registerDto: RegisterDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const deviceId = this.extractDeviceId(request);
    const metadata = this.extractSessionMetadata(request);

    const { user, token } = await this.authService.register(
      registerDto,
      deviceId,
      metadata
    );

    this.setAuthCookie(reply, token);

    return {
      message: "Registration successful. Please verify your email.",
      user: this.sanitizeUser(user),
      requiresVerification: true,
    };
  }

  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() request: FastifyRequest
  ) {
    const deviceId = this.extractDeviceId(request);

    const { user, nearAccountId } = await this.authService.verifyEmail(
      dto.email,
      dto,
      deviceId
    );

    return {
      message: "Email verified successfully. Your NEAR wallet is ready!",
      user: this.sanitizeUser(user),
      nearAccountId,
      onboardingCompleted: true,
    };
  }

  @Post("resend-otp")
  @HttpCode(HttpStatus.OK)
  async resendOtp(
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest
  ) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const deviceId = this.extractDeviceId(request);
    const result = await this.authService.resendVerificationOtp(
      userId,
      deviceId
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
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const deviceId = loginDto.deviceId || this.extractDeviceId(request);
    const metadata = this.extractSessionMetadata(request);

    const { user, token } = await this.authService.login(
      loginDto,
      deviceId,
      metadata
    );

    this.setAuthCookie(reply, token);

    return {
      message: "Login successful",
      user: this.sanitizeUser(user),
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    await this.authService.logout(user.sessionId);
    this.clearAuthCookie(reply);

    return { message: "Logged out successfully" };
  }

  @Post("logout-all")
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const { invalidatedCount } = await this.authService.logoutAll(user.id);
    this.clearAuthCookie(reply);

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

    return {
      user: {
        id: result._id,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        onboardingCompleted: result.onboardingCompleted,
        deletedAt: result.deletedAt,
        nearAccountId: result.nearAccountId,
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
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!user) {
      throw new UnauthorizedException("Not authenticated");
    }

    const sessions = await this.authService.getActiveSessions(user.id);
    const sessionBelongsToUser = sessions.some((s) =>
      s.sessionId.startsWith(sessionId.replace("...", ""))
    );

    if (!sessionBelongsToUser) {
      return { message: "Session not found" };
    }

    await this.authService.logout(sessionId);

    return { message: "Session revoked successfully" };
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

  private setAuthCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    this.logger.debug("Auth cookie set");
  }

  private clearAuthCookie(reply: FastifyReply): void {
    reply.clearCookie(AUTH_COOKIE_NAME, {
      path: "/",
    });

    this.logger.debug("Auth cookie cleared");
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
