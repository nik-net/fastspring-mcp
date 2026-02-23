/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import type { Config } from "../config.js";
import { FastSpringError } from "./errors.js";
import type winston from "winston";

function createAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString(
    "base64"
  );
  return `Basic ${encoded}`;
}

function safeLogData(logger: winston.Logger, level: "debug" | "error", message: string, meta: Record<string, unknown>): void {
  try {
    if (level === "debug") {
      logger.debug(message, meta);
    } else {
      logger.error(message, meta);
    }
  } catch {
    // ignore logging failure
  }
}

/**
 * Build a single axios instance with base URL, Basic auth, and centralised error handling.
 * Converts HTTP errors to FastSpringError with status and body.
 * Logs all requests and responses at DEBUG level when a logger is provided.
 *
 * @param credentialOverride - Optional username/password to use instead of config.username/password.
 *   Use this to create a second client with legacy Classic API credentials.
 */
export function createHttpClient(
  config: Config,
  logger?: winston.Logger,
  credentialOverride?: { username: string; password: string }
): AxiosInstance {
  const username = credentialOverride?.username ?? config.username;
  const password = credentialOverride?.password ?? config.password;

  const client = axios.create({
    baseURL: config.baseUrl.replace(/\/$/, ""),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: createAuthHeader(username, password),
    },
  });

  client.interceptors.response.use(
    (response) => {
      if (response.config) {
        const query = response.config.params
          ? `?${new URLSearchParams(response.config.params).toString()}`
          : "";
        const url = `${response.config.baseURL ?? ""}${response.config.url ?? ""}${query}`;
        const payload = {
          method: response.config.method?.toUpperCase(),
          url,
          status: response.status,
          data: response.data,
        };
        if (logger) {
          safeLogData(logger, "debug", "FastSpring API response", payload);
        } else if (config.debug) {
          console.debug("[FS_DEBUG] Response:", JSON.stringify(payload, null, 2));
        }
      }
      return response;
    },
    (error: AxiosError) => {
      if (error.config) {
        const query = error.config.params
          ? `?${new URLSearchParams(error.config.params).toString()}`
          : "";
        const url = `${error.config.baseURL ?? ""}${error.config.url ?? ""}${query}`;
        const requestMeta = { method: error.config.method?.toUpperCase(), url };
        const errorMeta = {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        };
        if (logger) {
          safeLogData(logger, "debug", "FastSpring API request (failed)", requestMeta);
          safeLogData(logger, "error", "FastSpring API error", errorMeta);
        } else if (config.debug) {
          console.debug("[FS_DEBUG] Request:", requestMeta);
          console.debug("[FS_DEBUG] Error:", JSON.stringify(errorMeta, null, 2));
        }
      }

      const status = error.response?.status ?? 0;
      const data = error.response?.data;
      const message =
        typeof data === "object" && data !== null && "message" in data
          ? String((data as { message: unknown }).message)
          : error.message || `HTTP ${status}`;
      throw new FastSpringError(message, status, data);
    }
  );

  return client;
}
