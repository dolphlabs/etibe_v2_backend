import { NestFactory, Reflector } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe, Logger } from "@nestjs/common";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import fastifyCookie from "@fastify/cookie";
import { Logger as PinoLogger } from "nestjs-pino";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Main");

  const fastifyAdapter = new FastifyAdapter({
    logger: false,
    trustProxy: true,
    ignoreTrailingSlash: true,
    caseSensitive: false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      bufferLogs: true,
    }
  );

  const configService = app.get(ConfigService);

  app.useLogger(app.get(PinoLogger));

  await app.register(fastifyCookie, {
    secret: configService.get<string>("session.secret"),
    parseOptions: {
      httpOnly: true,
      secure: configService.get("app.isProduction"),
      sameSite: "lax",
      path: "/",
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    noSniff: true,
    xssFilter: true,
  });

  await app.register(compress, {
    encodings: ["gzip", "deflate"],
    threshold: 1024,
  });

  await app.register(rateLimit, {
    max: configService.get<number>("security.throttleLimit", 100),
    timeWindow: configService.get<number>("security.throttleTtl", 60000),
    ban: 3,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Please retry after ${Math.round(
        context.ttl / 1000
      )} seconds.`,
    }),
  });

  const corsOrigin = configService.get<string>("app.corsOrigin", "*");
  app.enableCors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(","),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Api-Key",
      "X-Device-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: configService.get("app.isProduction"),
      stopAtFirstError: false,
    })
  );

  const apiPrefix = configService.get<string>("app.apiPrefix", "api");
  const apiVersion = configService.get<string>("app.apiVersion", "v1");
  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`);

  app.enableShutdownHooks();

  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, starting graceful shutdown...`);

      try {
        await app.close();
        logger.log("Application closed gracefully");
        process.exit(0);
      } catch (error) {
        logger.error("Error during graceful shutdown", error);
        process.exit(1);
      }
    });
  });

  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: configService.get("app.nodeEnv"),
  }));

  const port = configService.get<number>("app.port", 3000);
  const host = "0.0.0.0";

  await app.listen(port, host);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(
    `API endpoint: http://localhost:${port}/${apiPrefix}/${apiVersion}`
  );
  logger.log(`Health check: http://localhost:${port}/health`);
  logger.log(`Environment: ${configService.get("app.nodeEnv")}`);
}

bootstrap().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
