/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

import { loadConfig, TransportMode } from "../src/config.js";

const originalEnv = process.env;

describe("loadConfig", () => {
  beforeEach(() => {
    vi.stubEnv("FS_API_USERNAME", "test-user");
    vi.stubEnv("FS_API_PASSWORD", "test-pass");
    vi.stubEnv("FS_DEBUG", "false");
    delete process.env.FS_BASE_URL;
    delete process.env.FS_LOG_LEVEL;
    delete process.env.FS_LOG_DIR;
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_HTTP_PORT;
    delete process.env.MCP_HTTP_HOST;
    delete process.env.MCP_HTTP_PATH;
    delete process.env.MCP_HTTP_STATELESS;
    delete process.env.MCP_AUTH_ENABLED;
    delete process.env.MCP_API_KEYS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns config with required env vars", () => {
    const config = loadConfig();
    expect(config.username).toBe("test-user");
    expect(config.password).toBe("test-pass");
    expect(config.baseUrl).toBe("https://api.fastspring.com");
    expect(config.debug).toBe(false);
    expect(config.logLevel).toBe("debug");
    expect(config.logDir).toBe("logs");
  });

  it("uses FS_BASE_URL when set", () => {
    process.env.FS_BASE_URL = "https://custom.api.com";
    const config = loadConfig();
    expect(config.baseUrl).toBe("https://custom.api.com");
  });

  it("treats FS_DEBUG=true as debug true", () => {
    process.env.FS_DEBUG = "true";
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.logLevel).toBe("debug");
  });

  it("uses FS_LOG_LEVEL when set", () => {
    process.env.FS_LOG_LEVEL = "warn";
    const config = loadConfig();
    expect(config.logLevel).toBe("warn");
  });

  it("uses FS_LOG_DIR when set", () => {
    process.env.FS_LOG_DIR = "/var/log/fs-mcp";
    const config = loadConfig();
    expect(config.logDir).toBe("/var/log/fs-mcp");
  });

  it("throws when FS_API_USERNAME is missing", () => {
    delete process.env.FS_API_USERNAME;
    expect(() => loadConfig()).toThrow(/FS_API_USERNAME/);
  });

  it("throws when FS_API_PASSWORD is missing", () => {
    delete process.env.FS_API_PASSWORD;
    expect(() => loadConfig()).toThrow(/FS_API_PASSWORD/);
  });

  // ── Transport mode ──────────────────────────────────────────────────────

  it("defaults to STDIO transport", () => {
    const config = loadConfig();
    expect(config.transport).toBe(TransportMode.STDIO);
  });

  it("sets HTTP transport when MCP_TRANSPORT=http", () => {
    process.env.MCP_TRANSPORT = "http";
    const config = loadConfig();
    expect(config.transport).toBe(TransportMode.HTTP);
  });

  it("falls back to STDIO for an unrecognised MCP_TRANSPORT value", () => {
    process.env.MCP_TRANSPORT = "websocket";
    const config = loadConfig();
    expect(config.transport).toBe(TransportMode.STDIO);
  });

  // ── HTTP config defaults ────────────────────────────────────────────────

  it("returns default httpConfig values", () => {
    const config = loadConfig();
    expect(config.httpConfig.port).toBe(3000);
    expect(config.httpConfig.host).toBe("0.0.0.0");
    expect(config.httpConfig.path).toBe("/mcp");
    expect(config.httpConfig.stateless).toBe(false);
  });

  it("uses MCP_HTTP_PORT when set", () => {
    process.env.MCP_HTTP_PORT = "8080";
    const config = loadConfig();
    expect(config.httpConfig.port).toBe(8080);
  });

  it("falls back to default port for invalid MCP_HTTP_PORT", () => {
    process.env.MCP_HTTP_PORT = "not-a-number";
    const config = loadConfig();
    expect(config.httpConfig.port).toBe(3000);
  });

  it("uses MCP_HTTP_HOST when set", () => {
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    const config = loadConfig();
    expect(config.httpConfig.host).toBe("127.0.0.1");
  });

  it("uses MCP_HTTP_PATH when set", () => {
    process.env.MCP_HTTP_PATH = "/api/mcp";
    const config = loadConfig();
    expect(config.httpConfig.path).toBe("/api/mcp");
  });

  it("sets stateless=true when MCP_HTTP_STATELESS=true", () => {
    process.env.MCP_HTTP_STATELESS = "true";
    const config = loadConfig();
    expect(config.httpConfig.stateless).toBe(true);
  });

  it("sets stateless=true when MCP_HTTP_STATELESS=1", () => {
    process.env.MCP_HTTP_STATELESS = "1";
    const config = loadConfig();
    expect(config.httpConfig.stateless).toBe(true);
  });

  it("sets stateless=false for other MCP_HTTP_STATELESS values", () => {
    process.env.MCP_HTTP_STATELESS = "false";
    const config = loadConfig();
    expect(config.httpConfig.stateless).toBe(false);
  });

  // ── Auth config ─────────────────────────────────────────────────────────

  it("defaults authConfig.enabled to false", () => {
    const config = loadConfig();
    expect(config.authConfig.enabled).toBe(false);
  });

  it("defaults authConfig.apiKeys to empty array", () => {
    const config = loadConfig();
    expect(config.authConfig.apiKeys).toEqual([]);
  });

  it("sets authConfig.enabled=true when MCP_AUTH_ENABLED=true", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "key-one";
    const config = loadConfig();
    expect(config.authConfig.enabled).toBe(true);
  });

  it("sets authConfig.enabled=true when MCP_AUTH_ENABLED=1", () => {
    process.env.MCP_AUTH_ENABLED = "1";
    process.env.MCP_API_KEYS = "key-one";
    const config = loadConfig();
    expect(config.authConfig.enabled).toBe(true);
  });

  it("parses a single key from MCP_API_KEYS", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "only-key";
    const config = loadConfig();
    expect(config.authConfig.apiKeys).toEqual(["only-key"]);
  });

  it("parses multiple comma-separated keys from MCP_API_KEYS", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "key-a,key-b,key-c";
    const config = loadConfig();
    expect(config.authConfig.apiKeys).toEqual(["key-a", "key-b", "key-c"]);
  });

  it("trims whitespace from each key in MCP_API_KEYS", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "  key-a , key-b  ";
    const config = loadConfig();
    expect(config.authConfig.apiKeys).toEqual(["key-a", "key-b"]);
  });

  it("filters empty entries from MCP_API_KEYS", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "key-a,,key-b,";
    const config = loadConfig();
    expect(config.authConfig.apiKeys).toEqual(["key-a", "key-b"]);
  });

  it("throws when MCP_AUTH_ENABLED=true but MCP_API_KEYS is empty", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "";
    expect(() => loadConfig()).toThrow(/MCP_API_KEYS/);
  });

  it("throws when MCP_AUTH_ENABLED=true and MCP_API_KEYS is only whitespace/commas", () => {
    process.env.MCP_AUTH_ENABLED = "true";
    process.env.MCP_API_KEYS = "  ,  ,  ";
    expect(() => loadConfig()).toThrow(/MCP_API_KEYS/);
  });

  it("does not throw when auth is disabled and MCP_API_KEYS is empty", () => {
    process.env.MCP_AUTH_ENABLED = "false";
    process.env.MCP_API_KEYS = "";
    expect(() => loadConfig()).not.toThrow();
  });
});
