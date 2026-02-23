/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import {
  ApiKeyAuthMiddleware,
  createAuthMiddleware,
} from "../../src/middleware/auth.js";
import type { AuthConfig } from "../../src/config.js";
import type { WinstonLogger } from "../../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLogger: WinstonLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
} as unknown as WinstonLogger;

function makeRequest(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    method: "POST",
    url: "/mcp",
    socket: { remoteAddress: "127.0.0.1" } as Socket,
  } as unknown as IncomingMessage;
}

const VALID_KEY_A = "key-alpha-0000000000000000000000000000";
const VALID_KEY_B = "key-beta-0000000000000000000000000000000";

// ---------------------------------------------------------------------------
// ApiKeyAuthMiddleware — validate()
// ---------------------------------------------------------------------------

describe("ApiKeyAuthMiddleware", () => {
  let middleware: ApiKeyAuthMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new ApiKeyAuthMiddleware([VALID_KEY_A, VALID_KEY_B], mockLogger);
  });

  describe("authorize: valid keys", () => {
    it("authorizes a request with the first valid key", () => {
      const result = middleware.validate(makeRequest(`Bearer ${VALID_KEY_A}`));
      expect(result.authorized).toBe(true);
    });

    it("authorizes a request with the second valid key", () => {
      const result = middleware.validate(makeRequest(`Bearer ${VALID_KEY_B}`));
      expect(result.authorized).toBe(true);
    });
  });

  describe("reject: invalid or missing tokens", () => {
    it("rejects a request with no Authorization header", () => {
      const result = middleware.validate(makeRequest());
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.statusCode).toBe(401);
        expect(result.message).toMatch(/missing or malformed/i);
      }
    });

    it("rejects a request with a wrong Bearer token", () => {
      const result = middleware.validate(makeRequest("Bearer wrong-key"));
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.statusCode).toBe(401);
      }
    });

    it("rejects a request with a non-Bearer scheme", () => {
      const result = middleware.validate(makeRequest("Basic dXNlcjpwYXNz"));
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.statusCode).toBe(401);
        expect(result.message).toMatch(/missing or malformed/i);
      }
    });

    it("rejects a request with 'Bearer ' and no token", () => {
      const result = middleware.validate(makeRequest("Bearer "));
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.statusCode).toBe(401);
      }
    });

    it("rejects a request with an empty Authorization header", () => {
      const result = middleware.validate(makeRequest(""));
      expect(result.authorized).toBe(false);
    });
  });

  describe("security: sensitive data not logged", () => {
    it("does not log the token value on rejection", () => {
      middleware.validate(makeRequest("Bearer secret-token-value"));
      const allLogCalls = [
        ...(mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.error as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.info as ReturnType<typeof vi.fn>).mock.calls,
      ];
      const allLogText = JSON.stringify(allLogCalls);
      expect(allLogText).not.toContain("secret-token-value");
    });

    it("does not log the token value on success", () => {
      middleware.validate(makeRequest(`Bearer ${VALID_KEY_A}`));
      const allLogCalls = [
        ...(mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.error as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls,
        ...(mockLogger.info as ReturnType<typeof vi.fn>).mock.calls,
      ];
      const allLogText = JSON.stringify(allLogCalls);
      expect(allLogText).not.toContain(VALID_KEY_A);
    });
  });

  describe("header format edge cases", () => {
    it("handles Authorization header as an array (takes first value)", () => {
      const req = {
        headers: { authorization: [`Bearer ${VALID_KEY_A}`, "Bearer other"] },
        method: "POST",
        url: "/mcp",
        socket: { remoteAddress: "127.0.0.1" } as Socket,
      } as unknown as IncomingMessage;
      const result = middleware.validate(req);
      expect(result.authorized).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createAuthMiddleware factory
// ---------------------------------------------------------------------------

describe("createAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when auth is disabled", () => {
    const config: AuthConfig = { enabled: false, apiKeys: [] };
    const result = createAuthMiddleware(config, mockLogger);
    expect(result).toBeNull();
  });

  it("returns an AuthMiddleware instance when auth is enabled", () => {
    const config: AuthConfig = { enabled: true, apiKeys: [VALID_KEY_A] };
    const result = createAuthMiddleware(config, mockLogger);
    expect(result).not.toBeNull();
    expect(typeof result?.validate).toBe("function");
  });

  it("created middleware correctly validates a known key", () => {
    const config: AuthConfig = { enabled: true, apiKeys: [VALID_KEY_A] };
    const mw = createAuthMiddleware(config, mockLogger)!;
    expect(mw.validate(makeRequest(`Bearer ${VALID_KEY_A}`)).authorized).toBe(true);
  });

  it("created middleware correctly rejects an unknown key", () => {
    const config: AuthConfig = { enabled: true, apiKeys: [VALID_KEY_A] };
    const mw = createAuthMiddleware(config, mockLogger)!;
    expect(mw.validate(makeRequest("Bearer unknown")).authorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Config-level fail-fast (covered in config.test.ts but asserted here too)
// ---------------------------------------------------------------------------

describe("ApiKeyAuthMiddleware — empty key list", () => {
  it("accepts construction with an empty key list (config guards this, not middleware)", () => {
    // The fail-fast for empty keys happens at loadConfig(), not here.
    // The middleware itself should construct without throwing.
    expect(
      () => new ApiKeyAuthMiddleware([], mockLogger)
    ).not.toThrow();
  });

  it("rejects all requests when constructed with zero keys", () => {
    const mw = new ApiKeyAuthMiddleware([], mockLogger);
    const result = mw.validate(makeRequest(`Bearer ${VALID_KEY_A}`));
    expect(result.authorized).toBe(false);
  });
});
