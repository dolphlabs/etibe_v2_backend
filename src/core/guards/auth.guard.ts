import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Logger,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "../decorators";
import { AuthenticatedUser } from "../../shared/types/session.types";

const AUTH_COOKIE_NAME = "etibe_auth";
const SESSION_PREFIX = "session:";

interface JwtSessionPayload {
  sid: string;
  uid: string;
  did: string;
  iat?: number;
  exp?: number;
}

interface EtibeSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  isValid: boolean;
  expiresAt: Date;
}

type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    protected readonly reflector: Reflector,
    @Optional() private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (!this.jwtService) {
      this.logger.error(
        "JwtService not available. Make sure AuthModule is imported."
      );
      throw new UnauthorizedException("Authentication service unavailable");
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    const payload = this.verifyToken(token);

    if (!payload) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const session = await this.validateSession(payload.sid, payload.did);

    if (!session) {
      throw new UnauthorizedException("Session expired or invalid");
    }

    request.user = {
      _id: payload.uid as unknown as import("mongoose").Types.ObjectId,
      id: payload.uid,
      email: "",
      username: "",
      firstName: "",
      lastName: "",
      fullName: "",
      isVerified: false,
      sessionId: payload.sid,
      deviceId: payload.did,
    };

    return true;
  }

  private extractToken(request: FastifyRequest): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    if (cookies && cookies[AUTH_COOKIE_NAME]) {
      return cookies[AUTH_COOKIE_NAME];
    }

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    return null;
  }

  private verifyToken(token: string): JwtSessionPayload | null {
    try {
      return this.jwtService.verify<JwtSessionPayload>(token);
    } catch (error) {
      this.logger.debug(
        `Token verification failed: ${(error as Error).message}`
      );
      return null;
    }
  }

  private async validateSession(
    sessionId: string,
    deviceId: string
  ): Promise<EtibeSession | null> {
    const sessionKey = `${SESSION_PREFIX}${sessionId}`;
    const session = await this.cacheManager.get<EtibeSession>(sessionKey);

    if (!session) {
      this.logger.debug(`Session not found: ${sessionId}`);
      return null;
    }

    if (!session.isValid) {
      this.logger.debug(`Session invalidated: ${sessionId}`);
      return null;
    }

    if (session.deviceId !== deviceId) {
      this.logger.warn(`Device mismatch for session ${sessionId}`);
      return null;
    }

    if (new Date() > new Date(session.expiresAt)) {
      this.logger.debug(`Session expired: ${sessionId}`);
      return null;
    }

    return session;
  }
}
