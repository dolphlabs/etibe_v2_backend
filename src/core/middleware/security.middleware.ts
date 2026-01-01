import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { sanitizeObject } from "../../shared/utils";

@Injectable()
export class XssSanitizeMiddleware implements NestMiddleware {
  private readonly logger = new Logger(XssSanitizeMiddleware.name);

  use(req: FastifyRequest, res: FastifyReply, next: () => void): void {
    try {
      if (req.body && typeof req.body === "object") {
        req.body = sanitizeObject(req.body as Record<string, unknown>);
      }

      if (req.query && typeof req.query === "object") {
        req.query = sanitizeObject(req.query as Record<string, unknown>);
      }

      if (req.params && typeof req.params === "object") {
        req.params = sanitizeObject(req.params as Record<string, unknown>);
      }
    } catch (error) {
      this.logger.error("XSS sanitization failed", error);
    }

    next();
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void): void {
    const requestId =
      (req.headers["x-request-id"] as string) ||
      `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    req.headers["x-request-id"] = requestId;

    res.header("x-request-id", requestId);

    next();
  }
}
