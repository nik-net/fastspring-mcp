#!/usr/bin/env node
/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Start the fastspring-mcp stack as a persistent container (restarts on reboot).
 * Uses Docker Compose so the container has restart: unless-stopped and survives reboots.
 * Usage: node scripts/docker-run.mjs (from repo root)
 */

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env");
  const env = { ...process.env };
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

try {
  const proc = spawn(
    "docker",
    ["compose", "up", "-d", "--build"],
    {
      stdio: "inherit",
      cwd: ROOT,
      shell: false,
    }
  );
  proc.on("exit", (code) => {
    if (code !== 0) process.exit(code ?? 1);
    const env = loadEnv();
    const port = env.MCP_HTTP_PORT?.trim() || "3000";
    const path = env.MCP_HTTP_PATH?.trim() || "/mcp";
    console.log("Container running (persistent; restarts on reboot).");
    console.log(`MCP endpoint: http://localhost:${port}${path}`);
    console.log("Stop with: npm run docker:stop");
  });
} catch (err) {
  console.error("Failed to start Docker:", err);
  process.exit(1);
}
