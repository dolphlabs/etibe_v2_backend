# Etibé API

Enterprise-grade NestJS application with Fastify adapter and MongoDB, following Twelve-Factor App methodologies.

## 🚀 Features

- **Fastify Integration**: High-performance HTTP server with Fastify adapter
- **MongoDB with Mongoose**: Type-safe database operations with BaseRepository pattern
- **Redis Caching**: Distributed caching for frequently accessed queries
- **Security**: Helmet, rate limiting, XSS sanitization, throttling
- **Pino Logging**: Structured JSON logging with pretty-print for development
- **Global Exception Handling**: Mongoose validation errors, duplicate key errors, HTTP exceptions
- **Standardized Responses**: Consistent API envelope format `{ success, data, meta }`
- **Graceful Shutdown**: Proper shutdown hooks for containerized environments
- **Docker Ready**: Multi-stage Dockerfile and docker-compose configuration

## 📁 Project Structure

```
src/
├── config/                 # Environment validation and configuration
│   ├── app.config.ts       # Namespaced configuration modules
│   ├── env.validation.ts   # Class-based env validation
│   └── index.ts
├── core/                   # Global components
│   ├── decorators/         # Custom decorators
│   ├── filters/            # Exception filters
│   ├── guards/             # Authentication guards
│   ├── interceptors/       # Request/Response interceptors
│   ├── middleware/         # Security middleware
│   ├── pipes/              # Validation pipes
│   ├── repositories/       # Base repository class
│   └── index.ts
├── modules/                # Feature modules
│   └── users/              # Sample user module
│       ├── controllers/
│       ├── dto/
│       ├── repositories/
│       ├── schemas/
│       ├── services/
│       └── users.module.ts
├── shared/                 # Shared utilities
│   ├── constants/
│   ├── enums/
│   ├── types/
│   └── utils/
├── app.module.ts           # Root module
└── main.ts                 # Application bootstrap
```

## 🛠️ Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Start development server
pnpm dev
```

## ⛓️ Smart Contracts Setup

The EVM smart contracts (written in Solidity) are managed using Hardhat. Since compiled artifacts, caches, and TypeChain typings are git-omitted, you need to compile them locally on initial setup.

```bash
# Compile Solidity contracts and copy ABIs to the NestJS application
pnpm compile:sol
```

This command runs:
1. `hardhat compile` to compile Solidity contracts under `contracts/` and generate artifacts.
2. `ts-node scripts/copy-abi.ts` to copy the generated JSON ABI + bytecode to `src/modules/blockchain/abis/EtibeCircle.json` so the backend can deploy circles on-chain.

## 🐳 Docker

```bash
# Start all services (API, MongoDB, Redis)
pnpm docker:up

# View logs
pnpm docker:logs

# Stop services
pnpm docker:down
```

## 📜 Available Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `pnpm dev`        | Start development server with watch mode |
| `pnpm build`      | Build for production                     |
| `pnpm start:prod` | Start production server                  |
| `pnpm lint`       | Run ESLint                               |
| `pnpm test`       | Run tests                                |
| `pnpm docker:up`  | Start Docker containers                  |

## 🔧 Environment Variables

| Variable         | Description               | Default       |
| ---------------- | ------------------------- | ------------- |
| `NODE_ENV`       | Environment mode          | `development` |
| `PORT`           | Server port               | `3000`        |
| `MONGODB_URI`    | MongoDB connection string | -             |
| `REDIS_HOST`     | Redis host                | `localhost`   |
| `REDIS_PORT`     | Redis port                | `6379`        |
| `THROTTLE_TTL`   | Rate limit window (ms)    | `60000`       |
| `THROTTLE_LIMIT` | Max requests per window   | `100`         |
| `LOG_LEVEL`      | Logging level             | `info`        |

## 📚 API Response Format

All API responses follow a standardized envelope format:

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/v1/users",
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalItems": 100,
      "totalPages": 10,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

### Error Response

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": { ... }
  },
  "meta": {
    "timestamp": "2024-01-01T12:00:00.000Z",
    "path": "/api/v1/users"
  }
}
```

## 🔒 Security Features

- **Helmet**: Security headers (CSP, HSTS, XSS filter, etc.)
- **Rate Limiting**: Dual-layer rate limiting (Fastify + NestJS Throttler)
- **XSS Sanitization**: Input sanitization middleware
- **Request ID**: Unique request ID for tracing

## 📋 BaseRepository Methods

The `BaseRepository` abstract class provides these methods:

| Method                                   | Description                   |
| ---------------------------------------- | ----------------------------- |
| `create(data)`                           | Create a new document         |
| `findById(id)`                           | Find by ID (lean query)       |
| `findOne(filter)`                        | Find single document          |
| `findAll(filter)`                        | Find all matching documents   |
| `findAllWithPagination(filter, options)` | Paginated queries             |
| `update(id, data)`                       | Update document               |
| `softDelete(id)`                         | Soft delete with timestamp    |
| `restore(id)`                            | Restore soft-deleted document |
| `count(filter)`                          | Count documents               |
| `exists(filter)`                         | Check existence               |

## 🏗️ Adding a New Module

1. Create module directory in `src/modules/`
2. Create schema, DTOs, repository, service, and controller
3. Create module file extending patterns from `UsersModule`
4. Import module in `AppModule`

Example:

```bash
nest g module modules/products
nest g controller modules/products/controllers/product
nest g service modules/products/services/product
```

## 📝 License

MIT
