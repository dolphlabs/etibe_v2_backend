import { IsString, IsNotEmpty, Matches } from "class-validator";

export class AddBankAccountDto {
  @IsString()
  @IsNotEmpty()
  institutionCode!: string; // Paycrest institution code e.g. "GTBINGLA"

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: "Must be exactly 10 digits" })
  accountNumber!: string;
}
