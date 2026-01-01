import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { Error as MongooseError } from "mongoose";
import { ApiResponse, ErrorDetails } from "../../shared/types";
import { ErrorCode } from "../../shared/enums";

interface MongoServerError extends Error {
  code: number;
  keyPattern?: Record<string, number>;
  keyValue?: Record<string, unknown>;
}

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse();

    const { status, errorResponse } = this.handleException(exception, request);

    this.logError(exception, request, status);

    httpAdapter.reply(response, errorResponse, status);
  }

  private handleException(
    exception: unknown,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    if (exception instanceof MongooseError.ValidationError) {
      return this.handleMongooseValidationError(exception, request);
    }

    if (exception instanceof MongooseError.CastError) {
      return this.handleMongooseCastError(exception, request);
    }

    if (this.isMongoServerError(exception) && exception.code === 11000) {
      return this.handleMongoDuplicateKeyError(exception, request);
    }

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, request);
    }

    return this.handleGenericError(exception, request);
  }

  private handleMongooseValidationError(
    error: MongooseError.ValidationError,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    const validationErrors: Record<string, string> = {};

    for (const [field, err] of Object.entries(error.errors)) {
      validationErrors[field] = err.message;
    }

    const errorDetails: ErrorDetails = {
      code: ErrorCode.MONGO_VALIDATION_ERROR,
      message: "Validation failed",
      details: validationErrors,
    };

    return {
      status: HttpStatus.BAD_REQUEST,
      errorResponse: this.createErrorResponse(errorDetails, request),
    };
  }

  private handleMongooseCastError(
    error: MongooseError.CastError,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    const errorDetails: ErrorDetails = {
      code: ErrorCode.VALIDATION_ERROR,
      message: `Invalid ${error.path}: ${error.value}`,
      details: {
        field: error.path,
        value: error.value,
        kind: error.kind,
      },
    };

    return {
      status: HttpStatus.BAD_REQUEST,
      errorResponse: this.createErrorResponse(errorDetails, request),
    };
  }

  private handleMongoDuplicateKeyError(
    error: MongoServerError,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    const duplicateField = error.keyPattern
      ? Object.keys(error.keyPattern)[0]
      : "field";
    const duplicateValue = error.keyValue
      ? Object.values(error.keyValue)[0]
      : "value";

    const errorDetails: ErrorDetails = {
      code: ErrorCode.MONGO_DUPLICATE_KEY,
      message: `Duplicate value for ${duplicateField}: ${duplicateValue}`,
      details: {
        field: duplicateField,
        value: duplicateValue,
      },
    };

    return {
      status: HttpStatus.CONFLICT,
      errorResponse: this.createErrorResponse(errorDetails, request),
    };
  }

  private handleHttpException(
    exception: HttpException,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message: string;
    let details: Record<string, unknown> | undefined;

    if (typeof exceptionResponse === "string") {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === "object") {
      const response = exceptionResponse as Record<string, unknown>;
      message = (response.message as string) || exception.message;

      if (Array.isArray(response.message)) {
        details = { validationErrors: response.message };
        message = "Validation failed";
      }
    } else {
      message = exception.message;
    }

    const errorDetails: ErrorDetails = {
      code: this.getErrorCodeFromStatus(status),
      message,
      details,
    };

    return {
      status,
      errorResponse: this.createErrorResponse(errorDetails, request),
    };
  }

  private handleGenericError(
    exception: unknown,
    request: FastifyRequest
  ): { status: number; errorResponse: ApiResponse<null> } {
    const isProduction = process.env.NODE_ENV === "production";
    const error =
      exception instanceof Error ? exception : new Error("Unknown error");

    const errorDetails: ErrorDetails = {
      code: ErrorCode.INTERNAL_ERROR,
      message: isProduction ? "An unexpected error occurred" : error.message,
      stack: isProduction ? undefined : error.stack,
    };

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorResponse: this.createErrorResponse(errorDetails, request),
    };
  }

  private createErrorResponse(
    error: ErrorDetails,
    request: FastifyRequest
  ): ApiResponse<null> {
    return {
      success: false,
      data: null,
      error,
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId: (request.headers["x-request-id"] as string) || undefined,
      },
    };
  }

  private getErrorCodeFromStatus(status: number): ErrorCode {
    const statusToCode: Record<number, ErrorCode> = {
      400: ErrorCode.VALIDATION_ERROR,
      401: ErrorCode.UNAUTHORIZED,
      403: ErrorCode.FORBIDDEN,
      404: ErrorCode.NOT_FOUND,
      409: ErrorCode.ALREADY_EXISTS,
      429: ErrorCode.RATE_LIMIT_EXCEEDED,
      500: ErrorCode.INTERNAL_ERROR,
      503: ErrorCode.SERVICE_UNAVAILABLE,
    };

    return statusToCode[status] || ErrorCode.INTERNAL_ERROR;
  }

  private isMongoServerError(error: unknown): error is MongoServerError {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as MongoServerError).code === "number"
    );
  }

  private logError(
    exception: unknown,
    request: FastifyRequest,
    status: number
  ): void {
    const errorContext = {
      method: request.method,
      url: request.url,
      status,
      requestId: request.headers["x-request-id"],
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
        errorContext
      );
    } else if (status >= 400) {
      this.logger.warn(
        `[${request.method}] ${request.url} - ${status}`,
        errorContext
      );
    }
  }
}
