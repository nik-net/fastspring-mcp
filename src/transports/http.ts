/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Config } from "../config.js";
import type { WinstonLogger } from "../utils/logger.js";
import { createAuthMiddleware, type AuthMiddleware } from "../middleware/auth.js";

/** Factory that produces a fully-configured MCP Server instance. */
export type McpServerFactory = () => Server;

/**
 * Handle returned by buildHttpServer.
 * `server`        — the raw http.Server (not yet listening).
 * `closeSessions` — gracefully closes all active MCP sessions; call before server.close().
 */
export interface HttpServerHandle {
  readonly server: http.Server;
  readonly closeSessions: () => Promise<void>;
}

/**
 * Reads the full request body and parses it as JSON.
 * Returns `undefined` for empty bodies.
 */
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += String(chunk);
      });
      req.on("end", () => {
        try {
          resolve(data.trim() ? (JSON.parse(data) as unknown) : undefined);
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read request body: ${message}`);
  }
}

/**
 * Sends a JSON error response, safe to call even if headers have already been sent.
 */
function sendErrorResponse(
  res: http.ServerResponse,
  statusCode: number,
  message: string
): void {
  try {
    if (!res.headersSent) {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  } catch {
    // best-effort — connection may already be closed
  }
}

/**
 * Creates a configured http.Server with the full MCP request handler wired up.
 * The server is **not yet listening** — call `server.listen()` to bind to a port.
 *
 * Separating creation from binding enables integration testing: tests can call
 * `server.listen(0)` to get a random port and `server.close()` to clean up
 * without touching process signals or the infinite-wait lifecycle.
 *
 * Production code uses `startHttpServer` which wraps this with port binding,
 * startup logging, and SIGTERM/SIGINT handling.
 */
export function buildHttpServer(
  serverFactory: McpServerFactory,
  config: Config,
  logger: WinstonLogger,
  authMiddleware: AuthMiddleware | null
): HttpServerHandle {
  try {
    const { path: mcpPath, stateless } = config.httpConfig;

    /** sessionId → transport; only populated in stateful mode. */
    const sessions = new Map<string, StreamableHTTPServerTransport>();

    const server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        void handleRequest(req, res);
      }
    );

    async function handleRequest(
      req: http.IncomingMessage,
      res: http.ServerResponse
    ): Promise<void> {
      try {
        // ----- Health check (always unauthenticated — needed for Docker probes) -----
        if (req.url === "/health" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          const healthPayload = JSON.stringify({
            status: "ok",
            transport: "streamable-http",
            mode: stateless ? "stateless" : "stateful",
            sessions: stateless ? undefined : sessions.size,
          });
          res.end(healthPayload);
          logger.debug("Health check", { response: healthPayload });
          return;
        }

        // ----- Auth guard (all non-health routes) -----
        if (authMiddleware !== null) {
          const authResult = authMiddleware.validate(req);
          if (!authResult.authorized) {
            res.writeHead(authResult.statusCode, {
              "Content-Type": "application/json",
              "WWW-Authenticate": 'Bearer realm="FastSpring MCP"',
            });
            res.end(JSON.stringify({ error: authResult.message }));
            return;
          }
        }

        // ----- Route guard -----
        if (req.url !== mcpPath) {
          sendErrorResponse(
            res,
            404,
            `Not found. MCP endpoint is available at ${mcpPath}`
          );
          return;
        }

        // ----- DELETE — session termination -----
        if (req.method === "DELETE") {
          const sessionId = req.headers["mcp-session-id"];
          const sid = Array.isArray(sessionId) ? sessionId[0] : sessionId;
          if (sid && sessions.has(sid)) {
            const transport = sessions.get(sid)!;
            await transport.close();
            sessions.delete(sid);
            logger.info("MCP session terminated via DELETE", { sessionId: sid });
          }
          res.writeHead(200);
          res.end();
          return;
        }

        // ----- Only POST and GET are valid for MCP -----
        if (req.method !== "POST" && req.method !== "GET") {
          sendErrorResponse(res, 405, "Method not allowed");
          return;
        }

        const sessionHeader = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(sessionHeader)
          ? sessionHeader[0]
          : sessionHeader;

        // ----- Route to existing session (stateful only) -----
        if (!stateless && sessionId && sessions.has(sessionId)) {
          const transport = sessions.get(sessionId)!;
          logger.debug("Routing to existing MCP session", {
            sessionId,
            method: req.method,
          });

          let parsedBody: unknown;
          if (req.method === "POST") {
            parsedBody = await readJsonBody(req);
            logger.debug("MCP request body", { sessionId, body: parsedBody });
          }

          await transport.handleRequest(req, res, parsedBody);
          return;
        }

        // ----- New session or stateless request -----
        logger.debug("Creating new MCP transport instance", {
          method: req.method,
          mode: stateless ? "stateless" : "stateful",
        });

        // exactOptionalPropertyTypes requires we omit sessionIdGenerator entirely
        // rather than set it to undefined, so we use a conditional spread.
        const transport = new StreamableHTTPServerTransport({
          ...(stateless ? {} : { sessionIdGenerator: () => randomUUID() }),
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, transport);
            logger.info("New MCP session initialized", {
              sessionId: newSessionId,
            });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
            logger.info("MCP session closed", { sessionId: closedSessionId });
          },
        });

        const mcpServer = serverFactory();
        // Cast required: exactOptionalPropertyTypes causes SDK Transport interface
        // mismatch for optional callbacks on StreamableHTTPServerTransport.
        await mcpServer.connect(transport as unknown as Transport);

        let parsedBody: unknown;
        if (req.method === "POST") {
          parsedBody = await readJsonBody(req);
          logger.debug("MCP new-session request body", { body: parsedBody });
        }

        await transport.handleRequest(req, res, parsedBody);

        if (stateless) {
          await transport.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error handling HTTP request", {
          error: message,
          url: req.url,
          method: req.method,
        });
        sendErrorResponse(res, 500, "Internal server error");
      }
    }

    const closeSessions = async (): Promise<void> => {
      try {
        for (const [sid, transport] of sessions) {
          try {
            await transport.close();
            logger.debug("Session closed during shutdown", { sessionId: sid });
          } catch {
            // best-effort cleanup
          }
        }
        sessions.clear();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error closing sessions", { error: message });
      }
    };

    return { server, closeSessions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to build HTTP server: ${message}`);
  }
}

/**
 * Starts a Node.js HTTP server exposing the MCP Streamable HTTP transport.
 *
 * Supports two modes controlled by `config.httpConfig.stateless`:
 *
 * **Stateful (default)** — A `Mcp-Session-Id` header is assigned on the first
 * request (initialize) and must be echoed by the client on all subsequent
 * requests.  Each session has its own `StreamableHTTPServerTransport` and MCP
 * `Server` instance kept in memory until the client sends a DELETE or the
 * process exits.
 *
 * **Stateless** — Every POST creates a fresh transport + server pair that is
 * closed immediately after the response is sent.  No session IDs are issued.
 * Suitable for serverless or ephemeral deployments.
 *
 * The server also exposes a `GET /health` endpoint for readiness probes.
 */
export async function startHttpServer(
  serverFactory: McpServerFactory,
  config: Config,
  logger: WinstonLogger,
  authMiddleware: AuthMiddleware | null = createAuthMiddleware(config.authConfig, logger)
): Promise<void> {
  try {
    const { port, host, path: mcpPath, stateless } = config.httpConfig;

    const { server: httpServer, closeSessions } = buildHttpServer(
      serverFactory,
      config,
      logger,
      authMiddleware
    );

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        resolve();
      });
    });

    logger.info("FastSpring MCP HTTP server started", {
      host,
      port,
      path: mcpPath,
      mode: stateless ? "stateless" : "stateful",
      endpoint: `http://${host}:${port}${mcpPath}`,
      healthEndpoint: `http://${host}:${port}/health`,
    });

    const shutdown = async (signal: string): Promise<void> => {
      try {
        logger.info(`${signal} received — shutting down HTTP server`, {
          activeSessions: 0,
        });

        await closeSessions();

        httpServer.close(() => {
          logger.info("HTTP server closed");
          process.exit(0);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error during shutdown", { error: message });
        process.exit(1);
      }
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    // Keep the process alive until a signal is received.
    await new Promise<never>(() => {
      // intentionally never resolves — server runs until shutdown
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.fatal("Failed to start HTTP server", { error: message });
    throw err;
  }
}
