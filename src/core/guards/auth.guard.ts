import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators";

/**
 * Base authentication guard that can be extended.
 * Checks for the @Public() decorator to skip authentication.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(protected readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Implement authentication logic here
    // This is a placeholder that allows all requests
    // Replace with JWT validation, session checking, etc.
    return true;
  }
}
