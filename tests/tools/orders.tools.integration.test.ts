/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Integration tests for order tools.
 *
 * Calls the actual MCP tool handlers with real HTTP and config from .env.
 * TEST_ORDER_REFERENCE is golden data — the order must exist; tests fail if
 * the tool returns "No order found".
 *
 * Required in .env: FS_API_USERNAME, FS_API_PASSWORD, TEST_ORDER_REFERENCE.
 */

import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/utils/logger.js";
import { createHttpClient } from "../../src/utils/http.js";
import type { OrdersServiceDeps } from "../../src/services/orders.service.js";
import {
  handleGetOrder,
  GetOrderSchema,
} from "../../src/tools/orders.tools.js";

const TEST_ORDER_REFERENCE = process.env.TEST_ORDER_REFERENCE?.trim() ?? "";

function hasRequiredEnv(): boolean {
  return (
    Boolean(process.env.FS_API_USERNAME?.trim()) &&
    Boolean(process.env.FS_API_PASSWORD?.trim()) &&
    TEST_ORDER_REFERENCE.length > 0
  );
}

describe.skipIf(!hasRequiredEnv())(
  "orders tools (integration)",
  () => {
    let deps: OrdersServiceDeps;

    beforeAll(() => {
      const config = loadConfig();
      const logger = createLogger(config.logDir, config.logLevel);
      const http = createHttpClient(config, logger);
      const legacyHttp =
        config.legacyUsername !== undefined && config.legacyPassword !== undefined
          ? createHttpClient(config, logger, {
              username: config.legacyUsername,
              password: config.legacyPassword,
            })
          : undefined;

      deps = {
        http,
        ...(config.companyId !== undefined ? { companyId: config.companyId } : {}),
        ...(legacyHttp !== undefined ? { legacyHttp } : {}),
        ...(config.legacyCompanyId !== undefined
          ? { legacyCompanyId: config.legacyCompanyId }
          : {}),
      };
    });

    describe("get_order", () => {
      it("returns order data for TEST_ORDER_REFERENCE (golden data must exist)", async () => {
        const parsed = GetOrderSchema.safeParse({
          reference: TEST_ORDER_REFERENCE,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const result = await handleGetOrder(deps, parsed.data);

        expect(result.isError).toBeFalsy();
        expect(result.content).toHaveLength(1);
        const body = JSON.parse(result.content[0].text);

        expect(body.data).toBeDefined();
        expect(body.platform).toMatch(/^(modern|legacy)$/);
        expect(typeof body.data).toBe("object");
        expect(body.data?.id != null || body.data?.reference != null).toBe(true);
        if (body.message != null) {
          expect(String(body.message)).not.toContain("No order found");
        }
      });
    });
  }
);
