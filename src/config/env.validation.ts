import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  Max,
  validateSync,
} from "class-validator";
import { plainToInstance, Transform } from "class-transformer";

/**
 * Environment configuration validation class.
 * Uses class-validator and class-transformer for strict type validation
 * at application startup following Twelve-Factor App methodology.
 */
export class EnvironmentVariables {
  @IsIn(["development", "staging", "production", "test"])
  NODE_ENV: "development" | "staging" | "production" | "test" = "development";

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  API_PREFIX: string = "api";

  @IsString()
  API_VERSION: string = "v1";

  @IsString()
  MONGODB_URI!: string;

  @IsString()
  REDIS_HOST: string = "localhost";

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  REDIS_TTL: number = 3600;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1000)
  THROTTLE_TTL: number = 60000;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  @IsIn(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
  LOG_LEVEL: string = "info";

  @IsString()
  CORS_ORIGIN: string = "*";
}

export function validate(
  config: Record<string, unknown>
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(", ")
          : "Unknown validation error";
        return `${error.property}: ${constraints}`;
      })
      .join("\n");

    throw new Error(
      `Environment configuration validation failed:\n${errorMessages}`
    );
  }

  return validatedConfig;
}
