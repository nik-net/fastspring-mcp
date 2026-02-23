/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import * as http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthConfig } from "../config.js";
import type { WinstonLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Result & interface
// ---------------------------------------------------------------------------

export type AuthResult =
  | { authorized: true }
  | { authorized: false; statusCode: 401 | 403; message: string };

/**
 * Pluggable authentication middleware interface.
 * Implementations: ApiKeyAuthMiddleware (current), JwtAuthMiddleware / OAuthMiddleware (future).
 */
export interface AuthMiddleware {
  validate(req: http.IncomingMessage): AuthResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash of a string → fixed-length Buffer.
 * Used so that timingSafeEqual always receives equal-length buffers regardless
 * of the original key or token length, preventing length-oracle timing attacks.
 */
function hashKey(key: string): Buffer {
  try {
    return createHash("sha256").update(key).digest();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to hash key: ${message}`);
  }
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns undefined if the header is absent or not a Bearer scheme.
 */
function extractBearerToken(
  authHeader: string | string[] | undefined
): string | undefined {
  try {
    const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!raw) return undefined;
    const prefix = "Bearer ";
    if (!raw.startsWith(prefix)) return undefined;
    const token = raw.slice(prefix.length).trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validates incoming HTTP requests against a set of pre-shared API keys.
 *
 * Security properties:
 *  - Tokens are extracted from Authorization: Bearer <token> only (never query params).
 *  - Comparison is timing-safe via SHA-256 + crypto.timingSafeEqual.
 *  - All keys are iterated without short-circuiting on match to prevent
 *    timing side-channels that would reveal the position of the matching key.
 *  - Keys are never logged at any level.
 */
export class ApiKeyAuthMiddleware implements AuthMiddleware {
  private readonly hashedKeys: Buffer[];
  private readonly logger: WinstonLogger;

  constructor(apiKeys: string[], logger: WinstonLogger) {
    try {
      this.logger = logger;
      this.hashedKeys = apiKeys.map(hashKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to initialise ApiKeyAuthMiddleware: ${message}`);
    }
  }

  validate(req: http.IncomingMessage): AuthResult {
    try {
      const token = extractBearerToken(req.headers["authorization"]);

      if (token === undefined) {
        this.logger.warn("MCP auth: missing or malformed Authorization header", {
          method: req.method,
          url: req.url,
          ip: req.socket?.remoteAddress,
        });
        return {
          authorized: false,
          statusCode: 401,
          message: "Missing or malformed Authorization header. Expected: Authorization: Bearer <token>",
        };
      }

      const tokenHash = hashKey(token);

      // Iterate ALL keys without short-circuit to prevent timing side-channels.
      let isValid = false;
      for (const hk of this.hashedKeys) {
        if (timingSafeEqual(hk, tokenHash)) isValid = true;
      }

      if (!isValid) {
        this.logger.warn("MCP auth: invalid API key", {
          method: req.method,
          url: req.url,
          ip: req.socket?.remoteAddress,
        });
        return {
          authorized: false,
          statusCode: 401,
          message: "Invalid API key.",
        };
      }

      this.logger.debug("MCP auth: request authorized", {
        method: req.method,
        url: req.url,
      });

      return { authorized: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("MCP auth: unexpected error during validation", {
        error: message,
      });
      return {
        authorized: false,
        statusCode: 401,
        message: "Authentication error.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an AuthMiddleware from config, or returns null when auth is disabled.
 * Returns null for STDIO transport (auth is handled by the OS process model).
 */
export function createAuthMiddleware(
  authConfig: AuthConfig,
  logger: WinstonLogger
): AuthMiddleware | null {
  try {
    if (!authConfig.enabled) {
      logger.debug("MCP auth: disabled (MCP_AUTH_ENABLED is not true)");
      return null;
    }
    logger.info("MCP auth: API key authentication enabled", {
      keyCount: authConfig.apiKeys.length,
    });
    return new ApiKeyAuthMiddleware(authConfig.apiKeys, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create auth middleware: ${message}`);
  }
}
