/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { WinstonLogger } from "../utils/logger.js";
import type { McpServerFactory } from "./http.js";

/**
 * Connects the MCP server to the STDIO transport and keeps the process alive
 * until the parent process closes stdin.
 *
 * This is the default transport mode, suitable for local MCP clients such as
 * Claude Desktop, Cursor, and the MCP Inspector.
 */
export async function startStdioServer(
  serverFactory: McpServerFactory,
  logger: WinstonLogger
): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    const server = serverFactory();
    await server.connect(transport);
    logger.info("FastSpring MCP STDIO server started");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.fatal("Failed to start STDIO server", { error: message });
    throw err;
  }
}
