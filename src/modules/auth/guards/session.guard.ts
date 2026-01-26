import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { AuthService } from "../services/auth.service";
import { IS_PUBLIC_KEY } from "../../../core/decorators";
import { AuthenticatedUser } from "../../../shared/types/session.types";

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger(SessionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    const deviceId = this.extractDeviceId(request);
    const user = await this.authService.validateSession(token, deviceId);

    if (!user) {
      throw new UnauthorizedException("Session expired or invalid");
    }

    (request as FastifyRequest & { user: AuthenticatedUser }).user = user;

    return true;
  }

  private extractToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    return null;
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
}

@Injectable()
export class DeviceSessionGuard extends SessionGuard {
  private readonly deviceLogger = new Logger(DeviceSessionGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = await super.canActivate(context);

    if (!result) {
      return false;
    }

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: AuthenticatedUser }>();

    const headerDeviceId = request.headers["x-device-id"] as string;

    if (!headerDeviceId) {
      throw new UnauthorizedException("Device ID required for this operation");
    }

    if (request.user.deviceId !== headerDeviceId) {
      this.deviceLogger.warn(
        `Device mismatch for user ${request.user.id}. Expected: ${request.user.deviceId}, Got: ${headerDeviceId}`,
      );
      throw new UnauthorizedException("Device verification failed");
    }

    return true;
  }
}
