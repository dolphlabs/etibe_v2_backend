import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  Length,
} from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;

  @IsString()
  @MinLength(3, { message: "Username must be at least 3 characters" })
  @MaxLength(30, { message: "Username cannot exceed 30 characters" })
  @Matches(/^[a-z0-9_]+$/, {
    message:
      "Username can only contain lowercase letters, numbers, and underscores",
  })
  username!: string;

  @IsString()
  @MinLength(2, { message: "First name must be at least 2 characters" })
  @MaxLength(50, { message: "First name cannot exceed 50 characters" })
  firstName!: string;

  @IsString()
  @MinLength(2, { message: "Last name must be at least 2 characters" })
  @MaxLength(50, { message: "Last name cannot exceed 50 characters" })
  lastName!: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  @MaxLength(128, { message: "Password cannot exceed 128 characters" })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/,
    {
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    }
  )
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: "Please provide a valid phone number in E.164 format",
  })
  phone?: string;
}

export class LoginDto {
  @IsString()
  @MinLength(1, { message: "Email or username is required" })
  identifier!: string;

  @IsString()
  @MinLength(1, { message: "Password is required" })
  password!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class VerifyEmailDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;

  @IsString()
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP must contain only digits" })
  otp!: string;
}

export class ResendOtpDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;
}

export class DeviceMetadataDto {
  @IsString()
  deviceId!: string;

  @IsOptional()
  @IsString()
  os?: string;

  @IsOptional()
  @IsString()
  browser?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class AuthResponseDto {
  user!: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    fullName: string;
    avatar?: string;
    isVerified: boolean;
    nearWalletAddress?: string;
  };
  message!: string;
}

export class VerifyEmailResponseDto {
  user!: AuthResponseDto["user"];
  nearAccountId!: string;
  message!: string;
}

export class OnboardingStatusDto {
  isEmailVerified!: boolean;
  hasNearAccount!: boolean;
  onboardingCompleted!: boolean;
  nearAccountId?: string;
}

export class SessionResponseDto {
  sessionId!: string;
  deviceId!: string;
  metadata!: {
    ip: string;
    device: {
      os: string;
      browser: string;
    };
  };
  createdAt!: Date;
  lastActive!: Date;
  isCurrent!: boolean;
}
