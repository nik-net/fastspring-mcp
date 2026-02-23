#!/usr/bin/env node
/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Smoke test: spawns the FastSpring MCP server, runs MCP handshake (initialize
 * + notifications/initialized + tools/list), and prints all server output and
 * any errors. Run from repo root: node scripts/smoke-test-mcp.mjs
 *
 * Captures stdout/stderr so we can see exactly what the server sends and any
 * errors without needing the Inspector or browser.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVER_PATH = join(ROOT, "dist", "index.js");

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

function send(proc, msg) {
  const line = JSON.stringify(msg) + "\n";
  proc.stdin.write(line);
}

async function main() {
  const env = loadEnv();
  if (!env.FS_API_USERNAME || !env.FS_API_PASSWORD) {
    console.error("Missing FS_API_USERNAME or FS_API_PASSWORD in .env");
    process.exit(1);
  }
  if (!existsSync(SERVER_PATH)) {
    console.error("Run npm run build first. Not found:", SERVER_PATH);
    process.exit(1);
  }

  const proc = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  const lines = [];
  proc.stdout.on("data", (chunk) => {
    const s = chunk.toString();
    for (const line of s.split("\n")) {
      if (line.trim()) lines.push(line);
    }
  });

  proc.on("error", (err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });

  proc.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error("\n--- Server exited with code", code, "signal", signal);
      if (stderr) console.error("--- stderr:\n", stderr);
    }
  });

  // Give process a moment to start
  await new Promise((r) => setTimeout(r, 500));

  const initReq = {
    jsonrpc: "2.0",
    id: "1",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    },
  };
  send(proc, initReq);
  send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  send(proc, { jsonrpc: "2.0", id: "2", method: "tools/list", params: {} });
  proc.stdin.end();

  const timeout = 5000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && lines.length < 10) {
    await new Promise((r) => setTimeout(r, 100));
  }

  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 200));

  console.log("\n--- Server stdout (MCP messages):");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(line);
    }
  }
  if (lines.length === 0) {
    console.log("(no messages received)");
    if (stderr) console.log("stderr was:", stderr);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
