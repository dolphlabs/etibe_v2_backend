import { Module, Global } from "@nestjs/common";
import {
  NearService,
  VaultService,
  NearAccountService,
  TokenService,
  BaseService,
  BaseAccountService,
  BaseTokenService,
} from "./services";

@Global()
@Module({
  providers: [
    NearService,
    VaultService,
    NearAccountService,
    TokenService,
    BaseService,
    BaseAccountService,
    BaseTokenService,
  ],
  exports: [
    NearService,
    VaultService,
    NearAccountService,
    TokenService,
    BaseService,
    BaseAccountService,
    BaseTokenService,
  ],
})
export class BlockchainModule {}
