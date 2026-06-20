import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { FiatRampService } from "../services/fiat-ramp.service";
import { PaycrestService } from "../services/paycrest.service";
import { VerifiedUserGuard } from "../../circles/guards/verified-user.guard";
import { CurrentUserId } from "../../auth/decorators";
import { AddBankAccountDto } from "../dto/bank-account.dto";
import { InitiateWithdrawalDto, GetRateDto } from "../dto/fiat-ramp.dto";

@Controller("fiat")
@UseGuards(VerifiedUserGuard)
export class FiatRampController {
  constructor(
    private readonly fiatRampService: FiatRampService,
    private readonly paycrestService: PaycrestService,
  ) {}

  // Fiat Wallet
  @Get("wallet")
  getMyWallet(@CurrentUserId() userId: string) {
    return this.fiatRampService.getMyFiatWallet(userId);
  }

  @Get("balance")
  getBalance(@CurrentUserId() userId: string) {
    return this.fiatRampService.getMyFiatBalance(userId);
  }

  // Bank Accounts
  @Get("banks")
  getSupportedBanks() {
    return this.paycrestService.getSupportedInstitutions("NGN");
  }

  @Post("bank-accounts")
  @HttpCode(HttpStatus.CREATED)
  addBankAccount(
    @Body() dto: AddBankAccountDto,
    @CurrentUserId() userId: string,
  ) {
    return this.fiatRampService.addBankAccount(userId, dto);
  }

  @Get("bank-accounts")
  getBankAccounts(@CurrentUserId() userId: string) {
    return this.fiatRampService.getBankAccounts(userId);
  }

  @Delete("bank-accounts/:accountNumber")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBankAccount(
    @Param("accountNumber") accountNumber: string,
    @CurrentUserId() userId: string,
  ) {
    return this.fiatRampService.removeBankAccount(userId, accountNumber);
  }

  // On-ramp
  @Post("deposit/quote")
  @HttpCode(HttpStatus.OK)
  getDepositQuote(@Body() dto: GetRateDto) {
    return this.fiatRampService.getOnRampQuote(dto.amount);
  }

  // Off-ramp
  @Post("withdraw/quote")
  @HttpCode(HttpStatus.OK)
  getWithdrawQuote(@Body() dto: GetRateDto) {
    return this.fiatRampService.getOffRampQuote(dto.amount);
  }

  @Post("withdraw/request-otp")
  @HttpCode(HttpStatus.OK)
  requestOtp(@CurrentUserId() userId: string) {
    return this.fiatRampService.requestWithdrawalOtp(userId);
  }

  @Post("withdraw/initiate")
  @HttpCode(HttpStatus.CREATED)
  initiateWithdrawal(
    @Body() dto: InitiateWithdrawalDto,
    @CurrentUserId() userId: string,
  ) {
    return this.fiatRampService.initiateOffRamp(userId, dto);
  }
}
