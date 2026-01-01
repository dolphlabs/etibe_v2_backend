import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { CacheModule } from "@nestjs/cache-manager";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { redisStore } from "cache-manager-ioredis-yet";

import {
  validate,
  appConfig,
  databaseConfig,
  redisConfig,
  securityConfig,
  loggingConfig,
} from "./config";
import {
  GlobalExceptionFilter,
  ResponseInterceptor,
  LoggingInterceptor,
  XssSanitizeMiddleware,
  RequestIdMiddleware,
} from "./core";
import { UsersModule } from "./modules/users";

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
      ],
      envFilePath: [".env.local", ".env"],
      expandVariables: true,
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
      useFactory: async (configService: ConfigService) => ({
        store: await redisStore({
          host: configService.get<string>("redis.host", "localhost"),
          port: configService.get<number>("redis.port", 6379),
          password: configService.get<string>("redis.password") || undefined,
          ttl: configService.get<number>("redis.ttl", 3600) * 1000,
        }),
      }),
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

    UsersModule,
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
    consumer.apply(RequestIdMiddleware, XssSanitizeMiddleware).forRoutes("*");
  }
}
