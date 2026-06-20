import { IsNumber, IsPositive, IsString, IsNotEmpty } from "class-validator";

export class GetRateDto {
  @IsNumber()
  @IsPositive()
  amount!: number; // NGN amount for on-ramp quote
}

export class InitiateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  cNgnAmount!: number; // amount of cNGN to swap to NGN

  @IsString()
  @IsNotEmpty()
  institutionCode!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  otp!: string;
}
