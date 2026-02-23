#!/usr/bin/env node
/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, TransportMode } from "./config.js";
import { createLogger, type WinstonLogger } from "./utils/logger.js";
import { createHttpClient } from "./utils/http.js";
import type { OrdersServiceDeps } from "./services/orders.service.js";
import type { SubscriptionsServiceDeps } from "./services/subscriptions.service.js";
import type { AccountsServiceDeps } from "./services/accounts.service.js";
import { ordersToolDefinitions } from "./tools/orders.tools.js";
import { subscriptionsToolDefinitions } from "./tools/subscriptions.tools.js";
import {
  accountsToolDefinitions,
  type AccountsToolsDeps,
} from "./tools/accounts.tools.js";
import { startStdioServer } from "./transports/stdio.js";
import { startHttpServer, type McpServerFactory } from "./transports/http.js";
import { z } from "zod";

const SERVER_NAME = "fastspring-mcp";
const SERVER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Zod → JSON Schema helpers
// ---------------------------------------------------------------------------

function zSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const def = (
    schema as {
      _def?: {
        typeName?: string;
        schema?: z.ZodType;
        innerType?: z.ZodType;
      };
    }
  )._def;
  if (!def) return { type: "object", properties: {} };
  if (def.typeName === "ZodEffects" && def.schema) {
    return zSchemaToJsonSchema(def.schema);
  }
  if (def.typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const sub = value as z.ZodType;
      const subDef = (
        sub as {
          _def?: {
            typeName?: string;
            innerType?: z.ZodType;
            schema?: z.ZodType;
          };
        }
      )._def;
      const isOptional =
        subDef?.typeName === "ZodOptional" ||
        subDef?.typeName === "ZodDefault";
      let inner: z.ZodType | undefined = isOptional ? subDef?.innerType : sub;
      if (inner && subDef?.typeName === "ZodEffects" && subDef?.schema)
        inner = subDef.schema;
      if (inner) properties[key] = zodTypeToJsonSchema(inner);
      if (!isOptional) required.push(key);
    }
    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  if (def.typeName === "ZodString") return { type: "string" };
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodArray") return { type: "array" };
  return { type: "object", properties: {} };
}

function zodTypeToJsonSchema(zodType: z.ZodType): Record<string, unknown> {
  const def = (zodType as { _def?: { typeName?: string; description?: string } })
    ._def;
  const base = zSchemaToJsonSchema(zodType);
  if (def?.description)
    (base as Record<string, unknown>).description = def.description;
  return base;
}

// ---------------------------------------------------------------------------
// Tool definition aggregate type
// ---------------------------------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (deps: unknown, input: unknown) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
  deps: unknown;
};

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------

/**
 * Creates a fully-configured MCP `Server` instance bound to the provided tool
 * definitions.  Called once per transport connection (once for STDIO, once per
 * session or request for HTTP).
 */
function buildMcpServer(toolDefs: ToolDef[], logger: WinstonLogger): Server {
  try {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        const tools = toolDefs.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: zodTypeToJsonSchema(t.inputSchema),
        }));
        logger.debug("ListTools request handled", { count: tools.length });
        return { tools };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error handling ListTools request", { error: message });
        throw err;
      }
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const toolName = request.params.name;
        logger.debug("CallTool request received", { tool: toolName });

        const def = toolDefs.find((t) => t.name === toolName);
        if (!def) {
          logger.warn("Unknown tool requested", { tool: toolName });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
              },
            ],
            isError: true,
          };
        }

        const parsed = def.inputSchema.safeParse(
          request.params.arguments ?? {}
        );
        if (!parsed.success) {
          const details = parsed.error.flatten();
          logger.warn("Invalid tool arguments", { tool: toolName, details });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Invalid arguments", details }),
              },
            ],
            isError: true,
          };
        }

        const result = await (
          def.handler as (
            deps: unknown,
            input: unknown
          ) => Promise<{
            content: { type: "text"; text: string }[];
            isError?: boolean;
          }>
        )(def.deps, parsed.data);

        logger.debug("CallTool request completed", {
          tool: toolName,
          isError: result.isError ?? false,
        });

        return { content: result.content, isError: result.isError };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error handling CallTool request", {
          tool: request.params.name,
          error: message,
        });
        throw err;
      }
    });

    return server;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error building MCP server", { error: message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let logger: WinstonLogger | undefined;
  try {
    const config = loadConfig();
    logger = createLogger(config.logDir, config.logLevel);

    logger.info("FastSpring MCP server starting", {
      transport: config.transport,
      version: SERVER_VERSION,
    });

    const http = createHttpClient(config, logger);

    // Create a separate HTTP client for the legacy Classic platform when
    // FS_LEGACY_API_USERNAME / FS_LEGACY_API_PASSWORD are configured.
    const legacyHttp =
      config.legacyUsername !== undefined && config.legacyPassword !== undefined
        ? createHttpClient(config, logger, {
            username: config.legacyUsername,
            password: config.legacyPassword,
          })
        : undefined;

    const ordersDeps: OrdersServiceDeps = {
      http,
      ...(config.companyId !== undefined ? { companyId: config.companyId } : {}),
      ...(legacyHttp !== undefined ? { legacyHttp } : {}),
      ...(config.legacyCompanyId !== undefined
        ? { legacyCompanyId: config.legacyCompanyId }
        : {}),
    };
    const subscriptionsDeps: SubscriptionsServiceDeps = {
      http,
      ...(config.companyId !== undefined ? { companyId: config.companyId } : {}),
      ...(legacyHttp !== undefined ? { legacyHttp } : {}),
      ...(config.legacyCompanyId !== undefined
        ? { legacyCompanyId: config.legacyCompanyId }
        : {}),
    };
    const accountsDeps: AccountsServiceDeps = { http };
    const accountsToolsDeps: AccountsToolsDeps = {
      accounts: accountsDeps,
      orders: ordersDeps,
    };

    const allToolDefs: ToolDef[] = [
      ...ordersToolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        handler: t.handler as ToolDef["handler"],
        deps: ordersDeps,
      })),
      ...subscriptionsToolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        handler: t.handler as ToolDef["handler"],
        deps: subscriptionsDeps,
      })),
      ...accountsToolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        handler: t.handler as ToolDef["handler"],
        deps: t.depsKey === "both" ? accountsToolsDeps : accountsDeps,
      })),
    ];

    const serverFactory: McpServerFactory = () =>
      buildMcpServer(allToolDefs, logger!);

    if (config.transport === TransportMode.HTTP) {
      await startHttpServer(serverFactory, config, logger);
    } else {
      await startStdioServer(serverFactory, logger);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logger) {
      try {
        logger.fatal(`${SERVER_NAME} fatal: ${message}`, {
          error: String(err),
        });
      } catch {
        console.error(`[${SERVER_NAME}] Fatal: ${message}`);
      }
    } else {
      console.error(`[${SERVER_NAME}] Fatal: ${message}`);
    }
    process.exit(1);
  }
}

main();
