import { Module, Global } from "@nestjs/common";
import { NearService, VaultService, NearAccountService } from "./services";

@Global()
@Module({
  providers: [NearService, VaultService, NearAccountService],
  exports: [NearService, VaultService, NearAccountService],
})
export class BlockchainModule {}
