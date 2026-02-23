#!/usr/bin/env node
/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Run the fastspring-mcp Docker container with port and path from .env.
 * Stops any existing container using the same image first so the port is free.
 * Usage: node scripts/docker-run.mjs (from repo root)
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
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

// Stop any existing container using the fastspring-mcp image so the port is free
const ps = spawnSync("docker", ["ps", "-q", "-f", "ancestor=fastspring-mcp"], {
  encoding: "utf-8",
  cwd: ROOT,
});
const ids = (ps.stdout || "").trim().split(/\s+/).filter(Boolean);
if (ids.length > 0) {
  spawnSync("docker", ["stop", ...ids], { stdio: "inherit", cwd: ROOT });
}

const env = loadEnv();
const port = env.MCP_HTTP_PORT?.trim() || "3000";
const path = env.MCP_HTTP_PATH?.trim() || "/mcp";

const envFile = join(ROOT, ".env");
const args = [
  "run", "-d", "--rm",
  "-v", `${ROOT}/logs:/app/logs`,
  "-p", `${port}:${port}`,
  "fastspring-mcp",
];
if (existsSync(envFile)) {
  args.splice(2, 0, "--env-file", envFile);
}

const proc = spawn("docker", args, {
  stdio: "inherit",
  cwd: ROOT,
  shell: false,
});
proc.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log(`Container running. MCP endpoint: http://localhost:${port}${path}`);
});
