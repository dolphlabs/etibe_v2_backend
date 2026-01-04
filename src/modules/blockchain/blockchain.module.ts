import { Module, Global } from "@nestjs/common";
import {
  NearService,
  VaultService,
  NearAccountService,
  TokenService,
} from "./services";

@Global()
@Module({
  providers: [NearService, VaultService, NearAccountService, TokenService],
  exports: [NearService, VaultService, NearAccountService, TokenService],
})
export class BlockchainModule {}
