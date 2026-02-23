/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Integration tests for subscription tools.
 *
 * Calls the actual MCP tool handlers with real HTTP and config from .env.
 * TEST_SUBSCRIPTION_ID and TEST_ORDER_REFERENCE are golden data — the corresponding
 * subscription and order must exist; tests fail if the tool returns "No subscription found".
 *
 * Required in .env: FS_API_USERNAME, FS_API_PASSWORD, TEST_SUBSCRIPTION_ID, TEST_ORDER_REFERENCE.
 */

import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/utils/logger.js";
import { createHttpClient } from "../../src/utils/http.js";
import type { SubscriptionsServiceDeps } from "../../src/services/subscriptions.service.js";
import {
  handleGetSubscription,
  handleGetSubscriptionLineItems,
  GetSubscriptionSchema,
  GetSubscriptionLineItemsSchema,
} from "../../src/tools/subscriptions.tools.js";
import * as subscriptionsService from "../../src/services/subscriptions.service.js";

const TEST_SUBSCRIPTION_ID = process.env.TEST_SUBSCRIPTION_ID?.trim() ?? "";
const TEST_ORDER_REFERENCE = process.env.TEST_ORDER_REFERENCE?.trim() ?? "";

function hasRequiredEnv(): boolean {
  return (
    Boolean(process.env.FS_API_USERNAME?.trim()) &&
    Boolean(process.env.FS_API_PASSWORD?.trim()) &&
    TEST_SUBSCRIPTION_ID.length > 0 &&
    TEST_ORDER_REFERENCE.length > 0
  );
}

describe.skipIf(!hasRequiredEnv())(
  "subscriptions tools (integration)",
  () => {
    let deps: SubscriptionsServiceDeps;

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

    describe("get_subscription", () => {
      it("service getSubscription finds TEST_SUBSCRIPTION_ID (sanity: same as integration script)", async () => {
        const sub = await subscriptionsService.getSubscription(deps, TEST_SUBSCRIPTION_ID);
        expect(sub).toBeDefined();
        expect(typeof sub).toBe("object");
        expect((sub as { id?: string }).id != null || (sub as { reference?: string }).reference != null).toBe(true);
      });

      it("returns subscription data for TEST_SUBSCRIPTION_ID (golden data must exist)", async () => {
        const parsed = GetSubscriptionSchema.safeParse({
          reference: TEST_SUBSCRIPTION_ID,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const result = await handleGetSubscription(deps, parsed.data);

        expect(result.isError).toBeFalsy();
        expect(result.content).toHaveLength(1);
        const body = JSON.parse(result.content[0].text);

        expect(body.data).toBeDefined();
        expect(body.platform).toMatch(/^(modern|legacy)$/);
        expect(typeof body.data).toBe("object");
        expect(body.data?.id != null || body.data?.reference != null).toBe(true);
        if (body.message != null) {
          expect(String(body.message)).not.toContain("No subscription found");
        }
      });

      it("returns subscription data or not-found for TEST_ORDER_REFERENCE (order ref; subscription may exist)", async () => {
        const parsed = GetSubscriptionSchema.safeParse({
          reference: TEST_ORDER_REFERENCE,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const result = await handleGetSubscription(deps, parsed.data);

        expect(result.isError).toBeFalsy();
        expect(result.content).toHaveLength(1);
        const body = JSON.parse(result.content[0].text);

        if (body.message?.includes("No subscription found")) {
          expect(body.reference).toBe(TEST_ORDER_REFERENCE);
          return;
        }
        expect(body.data).toBeDefined();
        expect(body.platform).toMatch(/^(modern|legacy)$/);
        expect(typeof body.data).toBe("object");
      });
    });

    describe("get_subscription_line_items", () => {
      it("returns entries when given subscription id from get_subscription (golden data)", async () => {
        const getParsed = GetSubscriptionSchema.safeParse({
          reference: TEST_SUBSCRIPTION_ID,
        });
        expect(getParsed.success).toBe(true);
        if (!getParsed.success) return;

        const getResult = await handleGetSubscription(deps, getParsed.data);
        expect(getResult.isError).toBeFalsy();

      const getBody = JSON.parse(getResult.content[0].text);
      expect(getBody.data).toBeDefined();
      if (getBody.message != null) {
        expect(String(getBody.message)).not.toContain("No subscription found");
      }

        const subscriptionId =
          getBody.data?.id ?? getBody.data?.reference ?? null;
        expect(subscriptionId).toBeTruthy();

        const lineItemsParsed = GetSubscriptionLineItemsSchema.safeParse({
          subscriptionId,
        });
        expect(lineItemsParsed.success).toBe(true);
        if (!lineItemsParsed.success) return;

        const lineItemsResult = await handleGetSubscriptionLineItems(
          deps,
          lineItemsParsed.data
        );

        expect(lineItemsResult.isError).toBeFalsy();
        expect(lineItemsResult.content).toHaveLength(1);
        const entries = JSON.parse(lineItemsResult.content[0].text);
        expect(Array.isArray(entries)).toBe(true);
      });
    });
  }
);
