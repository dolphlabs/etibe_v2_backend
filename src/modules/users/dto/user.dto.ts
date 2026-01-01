import {
  IsEmail,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsBoolean,
  Matches,
} from "class-validator";
import { Transform } from "class-transformer";

export class CreateUserDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @IsString()
  @MinLength(2, { message: "First name must be at least 2 characters" })
  @MaxLength(50, { message: "First name cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  firstName!: string;

  @IsString()
  @MinLength(2, { message: "Last name must be at least 2 characters" })
  @MaxLength(50, { message: "Last name cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  lastName!: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  @MaxLength(128, { message: "Password cannot exceed 128 characters" })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  })
  password!: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "First name must be at least 2 characters" })
  @MaxLength(50, { message: "First name cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Last name must be at least 2 characters" })
  @MaxLength(50, { message: "Last name cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  lastName?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UserQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isVerified?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc";
}
