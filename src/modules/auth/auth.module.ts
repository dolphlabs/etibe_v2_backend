import { Module, Global, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService, SessionService, MailService } from "./services";
import { AuthController } from "./controllers";
import { SessionGuard, DeviceSessionGuard } from "./guards";
import { UsersModule } from "../users";
import { BlockchainModule } from "../blockchain";
import { CirclesModule } from "../circles";
import { TransactionsModule } from "../transactions";

@Global()
@Module({
  imports: [
    forwardRef(() => UsersModule),
    BlockchainModule,
    forwardRef(() => CirclesModule),
    TransactionsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      global: true,
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("session.secret"),
        signOptions: {
          expiresIn: "7d" as const,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    MailService,
    SessionGuard,
    DeviceSessionGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    MailService,
    SessionGuard,
    DeviceSessionGuard,
    JwtModule,
  ],
})
export class AuthModule {}
