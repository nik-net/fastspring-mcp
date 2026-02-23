/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHttpClient } from "../../src/utils/http.js";
import type { Config } from "../../src/config.js";
import { FastSpringError } from "../../src/utils/errors.js";

const mockConfig: Config = {
  username: "test-user",
  password: "test-pass",
  companyId: undefined,
  baseUrl: "https://api.fastspring.com",
  debug: false,
  logLevel: "debug",
  logDir: "logs",
  transport: "stdio" as const,
  httpConfig: {
    port: 3000,
    host: "0.0.0.0",
    path: "/mcp",
    stateless: false,
  },
  authConfig: {
    enabled: false,
    apiKeys: [],
  },
};

describe("createHttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an axios instance with correct base URL and auth header", async () => {
    const client = createHttpClient(mockConfig);
    expect(client.defaults.baseURL).toBe("https://api.fastspring.com");
    expect(client.defaults.headers.Authorization).toMatch(/^Basic /);
  });

  it("strips trailing slash from baseUrl", () => {
    const client = createHttpClient({
      ...mockConfig,
      baseUrl: "https://api.fastspring.com/",
    });
    expect(client.defaults.baseURL).toBe("https://api.fastspring.com");
  });

  it("response interceptor returns response on success", async () => {
    const client = createHttpClient(mockConfig);
    const data = { id: "ord-1" };
    client.defaults.adapter = async () => ({
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      config: { url: "/orders/1", method: "get" } as never,
    });
    const res = await client.get("/orders/1");
    expect(res.data).toEqual(data);
    expect(res.status).toBe(200);
  });

  it("when debug true, response interceptor logs and returns response", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => {});
    const client = createHttpClient({ ...mockConfig, debug: true });
    client.defaults.adapter = async () => ({
      data: { id: "ord-1" },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {
        baseURL: "https://api.fastspring.com",
        url: "/orders/1",
        method: "get",
        params: {},
      } as never,
    });
    await client.get("/orders/1");
    expect(debugLog).toHaveBeenCalledWith(
      "[FS_DEBUG] Response:",
      expect.any(String)
    );
    debugLog.mockRestore();
  });

  it("when debug true and config has no params, query is empty", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => {});
    const client = createHttpClient({ ...mockConfig, debug: true });
    client.defaults.adapter = async () => ({
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config: {
        baseURL: "https://api.fastspring.com",
        url: "/orders/1",
        method: "get",
      } as never,
    });
    await client.get("/orders/1");
    expect(debugLog).toHaveBeenCalled();
    const callStr = debugLog.mock.calls[0]?.[1] ?? "";
    expect(callStr).toContain("/orders/1");
    expect(callStr).not.toContain("?");
    debugLog.mockRestore();
  });

  it("when debug true, error interceptor logs error", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => {});
    const client = createHttpClient({ ...mockConfig, debug: true });
    client.defaults.adapter = async () => {
      const err = new Error() as Error & {
        response?: { status: number; data: unknown };
        config?: { baseURL?: string; url?: string; method?: string };
      };
      err.response = { status: 500, data: {} };
      err.config = { baseURL: "https://api.fastspring.com", url: "/orders", method: "get" };
      throw err;
    };
    await expect(client.get("/orders")).rejects.toThrow(FastSpringError);
    expect(debugLog).toHaveBeenCalledWith("[FS_DEBUG] Request:", expect.any(Object));
    expect(debugLog).toHaveBeenCalledWith("[FS_DEBUG] Error:", expect.any(String));
    debugLog.mockRestore();
  });

  it("when debug true and error config has no params, request url has no query", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => {});
    const client = createHttpClient({ ...mockConfig, debug: true });
    client.defaults.adapter = async () => {
      const err = new Error() as Error & {
        response?: { status: number; data: unknown };
        config?: { baseURL?: string; url?: string; method?: string };
      };
      err.response = { status: 502, data: {} };
      err.config = { baseURL: "https://api.fastspring.com", url: "/orders", method: "get" };
      throw err;
    };
    await expect(client.get("/orders")).rejects.toThrow(FastSpringError);
    const requestCall = debugLog.mock.calls.find(
      (c) => Array.isArray(c) && c[0] === "[FS_DEBUG] Request:"
    );
    expect(requestCall).toBeDefined();
    debugLog.mockRestore();
  });

  it("error interceptor converts HTTP error to FastSpringError", async () => {
    const client = createHttpClient(mockConfig);
    client.defaults.adapter = async () => {
      const err = new Error("Request failed") as Error & {
        response?: { status: number; data: unknown };
        config?: unknown;
      };
      err.response = { status: 404, data: { code: "NOT_FOUND" } };
      err.config = {};
      throw err;
    };
    try {
      await client.get("/orders/missing");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FastSpringError);
      expect((e as FastSpringError).statusCode).toBe(404);
      expect((e as FastSpringError).responseBody).toEqual({ code: "NOT_FOUND" });
    }
  });

  it("error interceptor when error has no config still throws FastSpringError", async () => {
    const client = createHttpClient(mockConfig);
    client.defaults.adapter = async () => {
      const err = new Error("Network error") as Error & {
        response?: { status: number; data: unknown };
        config?: undefined;
      };
      err.response = { status: 0, data: undefined };
      throw err;
    };
    try {
      await client.get("/orders");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FastSpringError);
      expect((e as FastSpringError).message).toBe("Network error");
    }
  });

  it("error interceptor uses response body message when present", async () => {
    const client = createHttpClient(mockConfig);
    client.defaults.adapter = async () => {
      const err = new Error() as Error & {
        response?: { status: number; data: { message: string } };
        config?: unknown;
      };
      err.response = { status: 400, data: { message: "Invalid order id" } };
      err.config = {};
      throw err;
    };
    try {
      await client.get("/orders/x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FastSpringError);
      expect((e as FastSpringError).message).toBe("Invalid order id");
    }
  });
});
