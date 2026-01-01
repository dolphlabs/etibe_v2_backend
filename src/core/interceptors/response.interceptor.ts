import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { FastifyRequest } from "fastify";
import { Reflector } from "@nestjs/core";
import { ApiResponse, PaginatedResult } from "../../shared/types";
import { SKIP_RESPONSE_TRANSFORM_KEY } from "../decorators";

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>
  ): Observable<ApiResponse<T>> {
    const skipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (skipTransform) {
      return next.handle() as unknown as Observable<ApiResponse<T>>;
    }

    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();

    return next
      .handle()
      .pipe(map((data) => this.transformResponse(data, request)));
  }

  private transformResponse(data: T, request: FastifyRequest): ApiResponse<T> {
    const baseResponse: ApiResponse<T> = {
      success: true,
      data: data,
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId: (request.headers["x-request-id"] as string) || undefined,
      },
    };

    if (this.isPaginatedResult(data)) {
      return {
        success: true,
        data: data.data as unknown as T,
        meta: {
          ...baseResponse.meta,
          pagination: data.pagination,
        },
      };
    }

    return baseResponse;
  }

  private isPaginatedResult(data: unknown): data is PaginatedResult<unknown> {
    return (
      data !== null &&
      typeof data === "object" &&
      "data" in data &&
      "pagination" in data &&
      Array.isArray((data as PaginatedResult<unknown>).data) &&
      typeof (data as PaginatedResult<unknown>).pagination === "object"
    );
  }
}
