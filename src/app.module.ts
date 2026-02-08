import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { CacheModule } from "@nestjs/cache-manager";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { redisStore } from "cache-manager-ioredis-yet";

import {
  validate,
  appConfig,
  databaseConfig,
  redisConfig,
  securityConfig,
  loggingConfig,
  nearConfig,
  sessionConfig,
  resendConfig,
  vaultConfig,
  cloudinaryConfig,
} from "./config";
import {
  GlobalExceptionFilter,
  ResponseInterceptor,
  LoggingInterceptor,
  XssSanitizeMiddleware,
  RequestIdMiddleware,
  AuthGuard,
  CoreModule,
} from "./core";
import { UsersModule } from "./modules/users";
import { AuthModule } from "./modules/auth";
import { CirclesModule } from "./modules/circles";
import { BlockchainModule } from "./modules/blockchain";
import { WalletModule } from "./modules/wallet";
import { UtilitiesModule } from "./modules/utilities";
import { TransactionsModule } from "./modules/transactions";
import { NotificationsModule } from "./modules/notifications";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        securityConfig,
        loggingConfig,
        nearConfig,
        sessionConfig,
        resendConfig,
        vaultConfig,
        cloudinaryConfig,
      ],
      envFilePath: [".env.local", ".env"],
      expandVariables: true,
    }),

    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: ".",
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>("logging.level", "info"),
          transport:
            configService.get("app.nodeEnv") !== "production"
              ? {
                  target: "pino-pretty",
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: "SYS:standard",
                    ignore: "pid,hostname",
                  },
                }
              : undefined,
          customProps: () => ({
            context: "HTTP",
          }),
          autoLogging: false,
          quietReqLogger: true,
        },
      }),
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>("database.uri"),
        autoIndex: configService.get("app.nodeEnv") !== "production",
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const host = configService.get<string>("redis.host", "localhost");
        const port = configService.get<number>("redis.port", 6379);
        const password =
          configService.get<string>("redis.password") || undefined;
        const ttl = configService.get<number>("redis.ttl", 3600) * 1000;

        console.log(`[CACHE] Initializing Redis store: ${host}:${port}`);

        try {
          const store = await redisStore({
            host,
            port,
            password,
            ttl,
          });
          console.log(`[CACHE] Redis store initialized successfully`);
          return { store, ttl };
        } catch (error) {
          console.error(`[CACHE] Failed to initialize Redis store:`, error);
          throw error;
        }
      },
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>("security.throttleTtl", 60000),
            limit: configService.get<number>("security.throttleLimit", 100),
          },
        ],
      }),
    }),

    CoreModule,

    // Feature Modules
    UsersModule,
    AuthModule,
    CirclesModule,
    BlockchainModule,
    WalletModule,
    UtilitiesModule,
    TransactionsModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },

    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },

    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },

    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, XssSanitizeMiddleware)
      .forRoutes("{*path}");
  }
}
