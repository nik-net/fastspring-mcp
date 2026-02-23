/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import path from "node:path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import type { LogLevel } from "../config.js";

const LOG_FILE_PREFIX = "fastspring-mcp";

const customLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const prettyFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : "";
  return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
});

/**
 * Create a logger that writes to a daily-rotating file under logDir.
 * One file per day: logs/fastspring-mcp-2025-02-18.log
 * Uses levels: fatal, error, warn, info, debug.
 * Output is pretty-printed for readability.
 */
export function createLogger(logDir: string, level: LogLevel): WinstonLogger {
  try {
    const dir = path.isAbsolute(logDir) ? logDir : path.resolve(process.cwd(), logDir);
    const transport = new DailyRotateFile({
      dirname: dir,
      filename: `${LOG_FILE_PREFIX}-%DATE%.log`,
      datePattern: "YYYY-MM-DD",
      level,
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.errors({ stack: true }),
        prettyFormat
      ),
      maxFiles: "14d",
      zippedArchive: false,
    });

    const transports: winston.transport[] = [transport];
    // In Docker we log to /app/logs; also write to console so docker logs works.
    if (dir === "/app/logs" || process.env.FS_LOG_TO_CONSOLE === "true") {
      transports.push(
        new winston.transports.Console({
          level,
          format: winston.format.combine(
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
            winston.format.errors({ stack: true }),
            prettyFormat
          ),
        })
      );
    }

    const logger = winston.createLogger({
      levels: customLevels,
      level,
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.errors({ stack: true }),
        prettyFormat
      ),
      transports,
    });

    return logger as WinstonLogger;
  } catch (err) {
    const fallback = winston.createLogger({
      levels: customLevels,
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        prettyFormat
      ),
      transports: [new winston.transports.Console()],
    });
    fallback.warn("Logger file transport failed, using console", { error: String(err) });
    return fallback as WinstonLogger;
  }
}

export interface WinstonLogger extends winston.Logger {
  fatal: (message: string, meta?: object) => WinstonLogger;
}
