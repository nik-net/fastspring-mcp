/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Integration tests for the HTTP transport layer.
 *
 * These tests start a real http.Server on a random port, make actual HTTP
 * requests using the built-in fetch API, and assert on real status codes and
 * response headers — proving that auth is wired end-to-end, not just in unit
 * isolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { buildHttpServer, type McpServerFactory } from "../../src/transports/http.js";
import { ApiKeyAuthMiddleware } from "../../src/middleware/auth.js";
import type { Config } from "../../src/config.js";
import { TransportMode } from "../../src/config.js";
import type { WinstonLogger } from "../../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_KEY_A = "integration-test-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_KEY_B = "integration-test-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Silent logger — suppresses all log output during tests. */
const silentLogger: WinstonLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
} as unknown as WinstonLogger;

/** Minimal MCP server stub — no tools, just enough to accept a connection. */
const stubMcpServerFactory: McpServerFactory = () =>
  new Server({ name: "test-server", version: "0.0.1" }, { capabilities: { tools: {} } });

function makeConfig(authEnabled: boolean, apiKeys: string[] = []): Config {
  return {
    username: "test-user",
    password: "test-pass",
    companyId: undefined,
    baseUrl: "https://api.fastspring.com",
    debug: false,
    logLevel: "debug",
    logDir: "/tmp",
    transport: TransportMode.HTTP,
    httpConfig: {
      port: 0,
      host: "127.0.0.1",
      path: "/mcp",
      stateless: true,
    },
    authConfig: { enabled: authEnabled, apiKeys },
  };
}

// ---------------------------------------------------------------------------
// Test lifecycle helpers
// ---------------------------------------------------------------------------

let testServer: http.Server;
let closeSessions: () => Promise<void>;
let baseUrl: string;

async function startServer(
  config: Config,
  authMiddleware: ApiKeyAuthMiddleware | null
): Promise<void> {
  const handle = buildHttpServer(
    stubMcpServerFactory,
    config,
    silentLogger,
    authMiddleware
  );
  testServer = handle.server;
  closeSessions = handle.closeSessions;

  await new Promise<void>((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = testServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  await closeSessions();
  await new Promise<void>((resolve) => testServer.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// MCP initialize request helper
// ---------------------------------------------------------------------------

const MCP_INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  },
});

function mcpPostHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...extraHeaders,
  };
}

// ---------------------------------------------------------------------------
// Tests: auth DISABLED
// ---------------------------------------------------------------------------

describe("HTTP transport — auth disabled", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await startServer(makeConfig(false), null);
  });

  afterEach(async () => {
    await stopServer();
  });

  it("GET /health returns 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("POST /mcp without Authorization header is not rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: MCP_INIT_BODY,
    });
    expect(res.status).not.toBe(401);
  });

  it("POST /mcp without Authorization header reaches the MCP layer (no WWW-Authenticate header)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: MCP_INIT_BODY,
    });
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: auth ENABLED
// ---------------------------------------------------------------------------

describe("HTTP transport — auth enabled", () => {
  let middleware: ApiKeyAuthMiddleware;

  beforeEach(async () => {
    vi.clearAllMocks();
    middleware = new ApiKeyAuthMiddleware([TEST_KEY_A, TEST_KEY_B], silentLogger);
    await startServer(makeConfig(true, [TEST_KEY_A, TEST_KEY_B]), middleware);
  });

  afterEach(async () => {
    await stopServer();
  });

  // --- Health check is always exempt ---

  it("GET /health returns 200 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("GET /health returns 200 even when a wrong token is sent", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(200);
  });

  // --- Rejection cases ---

  it("POST /mcp with no Authorization header returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: MCP_INIT_BODY,
    });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with wrong Bearer token returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders({ Authorization: "Bearer totally-wrong-key" }),
      body: MCP_INIT_BODY,
    });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with a non-Bearer scheme returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders({ Authorization: "Basic dXNlcjpwYXNz" }),
      body: MCP_INIT_BODY,
    });
    expect(res.status).toBe(401);
  });

  it("401 response includes WWW-Authenticate: Bearer header", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: MCP_INIT_BODY,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
  });

  it("401 response body contains an error field", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: MCP_INIT_BODY,
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  // --- Authorization cases ---

  it("POST /mcp with valid key A is not rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders({ Authorization: `Bearer ${TEST_KEY_A}` }),
      body: MCP_INIT_BODY,
    });
    expect(res.status).not.toBe(401);
  });

  it("POST /mcp with valid key B is not rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders({ Authorization: `Bearer ${TEST_KEY_B}` }),
      body: MCP_INIT_BODY,
    });
    expect(res.status).not.toBe(401);
  });

  it("POST /mcp with valid key reaches the MCP layer (no WWW-Authenticate header)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpPostHeaders({ Authorization: `Bearer ${TEST_KEY_A}` }),
      body: MCP_INIT_BODY,
    });
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });

  // --- Other routes are also protected ---

  it("GET /unknown-path with no auth returns 401 (not 404)", async () => {
    const res = await fetch(`${baseUrl}/some-other-path`);
    expect(res.status).toBe(401);
  });
});
