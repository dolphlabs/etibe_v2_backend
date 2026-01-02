import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AuthenticatedUser } from "../../../shared/types/session.types";

type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};

@Injectable()
export class VerifiedUserGuard implements CanActivate {
  private readonly logger = new Logger(VerifiedUserGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    if (!user.nearAccountId) {
      this.logger.warn(
        `User ${user.id} attempted to access verified-only resource without NEAR wallet`
      );
      throw new ForbiddenException(
        "Please complete your onboarding to access this feature. A NEAR wallet is required."
      );
    }

    if (!user.isVerified) {
      throw new ForbiddenException(
        "Please verify your email to access this feature."
      );
    }

    return true;
  }
}
