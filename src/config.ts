/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { config as loadDotenv } from "dotenv";

const ENV = {
  FS_API_USERNAME: "FS_API_USERNAME",
  FS_API_PASSWORD: "FS_API_PASSWORD",
  FS_COMPANY_ID: "FS_COMPANY_ID",
  FS_LEGACY_API_USERNAME: "FS_LEGACY_API_USERNAME",
  FS_LEGACY_API_PASSWORD: "FS_LEGACY_API_PASSWORD",
  FS_LEGACY_COMPANY_ID: "FS_LEGACY_COMPANY_ID",
  FS_DEBUG: "FS_DEBUG",
  FS_LOG_LEVEL: "FS_LOG_LEVEL",
  FS_LOG_DIR: "FS_LOG_DIR",
  MCP_TRANSPORT: "MCP_TRANSPORT",
  MCP_HTTP_PORT: "MCP_HTTP_PORT",
  MCP_HTTP_HOST: "MCP_HTTP_HOST",
  MCP_HTTP_PATH: "MCP_HTTP_PATH",
  MCP_HTTP_STATELESS: "MCP_HTTP_STATELESS",
  MCP_AUTH_ENABLED: "MCP_AUTH_ENABLED",
  MCP_API_KEYS: "MCP_API_KEYS",
} as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export enum TransportMode {
  STDIO = "stdio",
  HTTP = "http",
}

export interface HttpConfig {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  readonly stateless: boolean;
}

export interface AuthConfig {
  /** Whether Bearer token authentication is enforced on the HTTP transport. */
  readonly enabled: boolean;
  /** Valid API keys. Any single key grants access. */
  readonly apiKeys: string[];
}

const DEFAULT_BASE_URL = "https://api.fastspring.com";
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_HOST = "0.0.0.0";
const DEFAULT_HTTP_PATH = "/mcp";

/** Load .env from cwd so the server works when env is not passed (e.g. MCP Inspector). */
function loadEnvFile(): void {
  try {
    loadDotenv();
  } catch {
    // dotenv failed; rely on process.env only
  }
}

export interface Config {
  readonly username: string;
  readonly password: string;
  /**
   * FastSpring Classic (legacy) API company ID (e.g. "example-company").
   * Required for order reference lookups via GET /company/{companyId}/order/{reference}.
   * Set via FS_COMPANY_ID environment variable.
   */
  readonly companyId: string | undefined;
  /**
   * Credentials for the FastSpring Classic (legacy) platform when a separate
   * account is used alongside the SBL platform.  When set, order reference
   * lookups automatically fall back to these credentials if the primary
   * credentials are denied or return no result.
   * Set via FS_LEGACY_API_USERNAME / FS_LEGACY_API_PASSWORD.
   */
  readonly legacyUsername: string | undefined;
  readonly legacyPassword: string | undefined;
  /**
   * Company ID for the legacy Classic platform.
   * Defaults to companyId when not set.
   * Set via FS_LEGACY_COMPANY_ID.
   */
  readonly legacyCompanyId: string | undefined;
  readonly baseUrl: string;
  readonly debug: boolean;
  readonly logLevel: LogLevel;
  readonly logDir: string;
  /** Transport mode: "stdio" (default) or "http" (Streamable HTTP). Set via MCP_TRANSPORT. */
  readonly transport: TransportMode;
  /** HTTP transport configuration. Only used when transport === TransportMode.HTTP. */
  readonly httpConfig: HttpConfig;
  /** Authentication configuration for the HTTP transport. */
  readonly authConfig: AuthConfig;
}

function getEnv(key: string): string | undefined {
  try {
    return process.env[key];
  } catch {
    return undefined;
  }
}

function requireEnv(name: string): string {
  const value = getEnv(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env or your environment.`
    );
  }
  return value.trim();
}

/**
 * Load and validate config from environment. Call once at startup.
 * Fails fast with a clear message if required vars are missing.
 */
export function loadConfig(): Config {
  try {
    if (!process.env[ENV.FS_API_USERNAME]?.trim() || !process.env[ENV.FS_API_PASSWORD]?.trim()) {
      loadEnvFile();
    }
    const username = requireEnv(ENV.FS_API_USERNAME);
    const password = requireEnv(ENV.FS_API_PASSWORD);
    const companyId = getEnv(ENV.FS_COMPANY_ID)?.trim() || undefined;
    const legacyUsername = getEnv(ENV.FS_LEGACY_API_USERNAME)?.trim() || undefined;
    const legacyPassword = getEnv(ENV.FS_LEGACY_API_PASSWORD)?.trim() || undefined;
    const legacyCompanyId = getEnv(ENV.FS_LEGACY_COMPANY_ID)?.trim() || undefined;
    const baseUrl = getEnv("FS_BASE_URL")?.trim() ?? DEFAULT_BASE_URL;
    const debugRaw = getEnv(ENV.FS_DEBUG);
    const debug =
      debugRaw === "true" ||
      debugRaw === "1" ||
      (typeof debugRaw === "string" && debugRaw.toLowerCase() === "true");

    const logLevelRaw = getEnv(ENV.FS_LOG_LEVEL)?.toLowerCase()?.trim();
    const logLevel: LogLevel =
      LOG_LEVELS.includes(logLevelRaw as LogLevel) && logLevelRaw
        ? (logLevelRaw as LogLevel)
        : debug
          ? "debug"
          : "debug";
    const logDir = getEnv(ENV.FS_LOG_DIR)?.trim() || "logs";

    const transportRaw = getEnv(ENV.MCP_TRANSPORT)?.toLowerCase().trim();
    const transport: TransportMode =
      transportRaw === TransportMode.HTTP ? TransportMode.HTTP : TransportMode.STDIO;

    const httpPortRaw = getEnv(ENV.MCP_HTTP_PORT)?.trim();
    const httpPort = httpPortRaw ? parseInt(httpPortRaw, 10) : DEFAULT_HTTP_PORT;
    const httpConfig: HttpConfig = {
      port: Number.isFinite(httpPort) && httpPort > 0 ? httpPort : DEFAULT_HTTP_PORT,
      host: getEnv(ENV.MCP_HTTP_HOST)?.trim() || DEFAULT_HTTP_HOST,
      path: getEnv(ENV.MCP_HTTP_PATH)?.trim() || DEFAULT_HTTP_PATH,
      stateless:
        getEnv(ENV.MCP_HTTP_STATELESS)?.toLowerCase().trim() === "true" ||
        getEnv(ENV.MCP_HTTP_STATELESS)?.trim() === "1",
    };

    const authEnabled =
      getEnv(ENV.MCP_AUTH_ENABLED)?.toLowerCase().trim() === "true" ||
      getEnv(ENV.MCP_AUTH_ENABLED)?.trim() === "1";

    const apiKeysRaw = getEnv(ENV.MCP_API_KEYS) ?? "";
    const apiKeys = apiKeysRaw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (authEnabled && apiKeys.length === 0) {
      throw new Error(
        "MCP_AUTH_ENABLED is true but MCP_API_KEYS is empty. " +
          "Provide at least one API key in MCP_API_KEYS."
      );
    }

    const authConfig: AuthConfig = { enabled: authEnabled, apiKeys };

    return {
      username,
      password,
      companyId,
      legacyUsername,
      legacyPassword,
      legacyCompanyId,
      baseUrl,
      debug,
      logLevel,
      logDir,
      transport,
      httpConfig,
      authConfig,
    };
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error("Failed to load configuration.");
  }
}
