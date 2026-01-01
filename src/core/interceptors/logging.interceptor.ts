import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { FastifyRequest, FastifyReply } from "fastify";
import { PinoLogger } from "nestjs-pino";

/**
 * Logging interceptor that logs request metadata and execution time.
 * Uses Pino logger (Fastify standard) for structured logging.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const { method, url, ip, headers } = request;
    const userAgent = headers["user-agent"] || "unknown";
    const requestId =
      (headers["x-request-id"] as string) || this.generateRequestId();
    const startTime = Date.now();
    const className = context.getClass().name;
    const handlerName = context.getHandler().name;

    // Log incoming request
    this.logger.info({
      msg: `Incoming request`,
      type: "request",
      requestId,
      method,
      url,
      ip,
      userAgent,
      handler: `${className}.${handlerName}`,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          // Log successful response
          this.logger.info({
            msg: `Request completed`,
            type: "response",
            requestId,
            method,
            url,
            statusCode,
            duration: `${duration}ms`,
            handler: `${className}.${handlerName}`,
          });
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;

          // Log error response
          this.logger.error({
            msg: `Request failed`,
            type: "error",
            requestId,
            method,
            url,
            duration: `${duration}ms`,
            handler: `${className}.${handlerName}`,
            error: {
              name: error.name,
              message: error.message,
            },
          });
        },
      })
    );
  }

  /**
   * Generates a unique request ID.
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
