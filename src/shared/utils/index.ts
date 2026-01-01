import * as xssFilters from "xss-filters";

export function sanitizeString(input: string): string {
  if (typeof input !== "string") return input;
  return xssFilters.inHTMLData(input);
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "string"
          ? sanitizeString(item)
          : typeof item === "object" && item !== null
          ? sanitizeObject(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function calculatePagination(
  totalItems: number,
  page: number,
  limit: number
): {
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
} {
  const totalPages = Math.ceil(totalItems / limit);
  return {
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export function maskSensitiveData(
  data: Record<string, unknown>,
  sensitiveKeys: string[] = ["password", "token", "secret", "authorization"]
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      masked[key] = "***REDACTED***";
    } else if (typeof value === "object" && value !== null) {
      masked[key] = maskSensitiveData(
        value as Record<string, unknown>,
        sensitiveKeys
      );
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

export function extractDuplicateKeyField(errorMessage: string): string | null {
  const match = errorMessage.match(/index: (\w+)_/);
  return match ? match[1] : null;
}
