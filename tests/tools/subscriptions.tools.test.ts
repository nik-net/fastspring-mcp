/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetSubscription,
  handleListSubscriptions,
  handleGetSubscriptionLineItems,
  GetSubscriptionSchema,
  ListSubscriptionsSchema,
} from "../../src/tools/subscriptions.tools.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { Platform } from "../../src/types/lookup-results.types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SBL_SUB = { id: "sub-sbl-1", reference: "SBL-REF-1", status: "active", customer: { email: "a@b.com" } };
const CLASSIC_SUB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<subscription>
  <reference>VI0000000-0000-00000S</reference>
  <status>active</status>
  <productName>my-software</productName>
  <quantity>1</quantity>
  <customer><firstName>John</firstName><email>john@acme.com</email></customer>
</subscription>`;

describe("subscriptions.tools", () => {
  const mockGet = vi.fn();
  const mockLegacyGet = vi.fn();
  const mockDeps = {
    http: { get: mockGet },
    companyId: "testco",
    legacyHttp: { get: mockLegacyGet },
    legacyCompanyId: "testco-legacy",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Input schemas
  // -------------------------------------------------------------------------

  describe("input schemas", () => {
    it("GetSubscriptionSchema accepts any non-empty reference", () => {
      expect(GetSubscriptionSchema.safeParse({ reference: "sub-1" }).success).toBe(true);
      expect(GetSubscriptionSchema.safeParse({ reference: "VI8201014-6538-11102S" }).success).toBe(true);
    });

    it("GetSubscriptionSchema rejects an empty reference", () => {
      expect(GetSubscriptionSchema.safeParse({ reference: "" }).success).toBe(false);
    });

    it("ListSubscriptionsSchema accepts optional filters", () => {
      const parsed = ListSubscriptionsSchema.safeParse({ status: "active", email: "a@b.com" });
      expect(parsed.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // handleGetSubscription — found on modern platform
  // -------------------------------------------------------------------------

  describe("handleGetSubscription — found on modern platform", () => {
    it("returns { platform: 'modern', data: subscription } when modern lookup succeeds", async () => {
      mockGet.mockResolvedValueOnce({ data: SBL_SUB });

      const result = await handleGetSubscription(mockDeps, { reference: "sub-sbl-1" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe(Platform.SBL);
      expect(body.data).toEqual(SBL_SUB);
    });

    it("response platform value is 'modern' (not 'sbl')", async () => {
      mockGet.mockResolvedValueOnce({ data: SBL_SUB });
      const result = await handleGetSubscription(mockDeps, { reference: "sub-sbl-1" });
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe("modern");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetSubscription — found on legacy platform
  // -------------------------------------------------------------------------

  describe("handleGetSubscription — found on legacy platform", () => {
    it("returns { platform: 'legacy', data: ... } when only legacy succeeds", async () => {
      // Step 1 SBL by ID → 404, Step 2 SBL by reference → empty, Step 3 company-scoped → 404, Step 4 Classic → success
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockGet.mockResolvedValueOnce({ data: { subscriptions: [] } });
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockGet.mockResolvedValueOnce({ data: CLASSIC_SUB_XML });

      const result = await handleGetSubscription(mockDeps, { reference: "VI0000000-0000-00000S" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe("legacy");
      expect(body.data.reference).toBe("VI0000000-0000-00000S");
      expect(body.data.productName).toBe("my-software");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetSubscription — not found
  // -------------------------------------------------------------------------

  describe("handleGetSubscription — not found", () => {
    it("returns a not-found message when reference is absent on all platforms", async () => {
      const mockDepsNoLegacy = { http: { get: mockGet }, companyId: "testco" };

      // Step 1 SBL by ID → 404, Step 2 SBL by reference → empty, Step 3 company-scoped → 404, Step 4 Classic → 404
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockGet.mockResolvedValueOnce({ data: { subscriptions: [] } });
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));

      const result = await handleGetSubscription(mockDepsNoLegacy, { reference: "UNKNOWN" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.message).toContain("No subscription found");
      expect(body.reference).toBe("UNKNOWN");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetSubscription — error propagation
  // -------------------------------------------------------------------------

  describe("handleGetSubscription — error propagation", () => {
    it("returns isError when auth fails (401)", async () => {
      mockGet.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));

      const result = await handleGetSubscription(mockDeps, { reference: "sub-1" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).statusCode).toBe(401);
    });

    it("returns isError on network failure", async () => {
      mockGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await handleGetSubscription(mockDeps, { reference: "sub-1" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain("ECONNREFUSED");
    });
  });

  // -------------------------------------------------------------------------
  // handleListSubscriptions
  // -------------------------------------------------------------------------

  describe("handleListSubscriptions", () => {
    it("returns content with subscriptions array", async () => {
      const subs = [{ id: "sub-1" }];
      mockGet.mockResolvedValueOnce({ data: { subscriptions: subs } });
      const result = await handleListSubscriptions(mockDeps, {});
      expect(JSON.parse(result.content[0].text)).toEqual(subs);
    });

    it("passes status and product filters", async () => {
      mockGet.mockResolvedValueOnce({ data: { subscriptions: [] } });
      await handleListSubscriptions(mockDeps, { status: "active", product: "my-product" });
      expect(mockGet).toHaveBeenCalledWith("/subscriptions", {
        params: { status: "active", product: "my-product" },
      });
    });
  });

  // -------------------------------------------------------------------------
  // handleGetSubscriptionLineItems
  // -------------------------------------------------------------------------

  describe("handleGetSubscriptionLineItems", () => {
    it("returns line items array", async () => {
      const entries = [{ product: "prod-1", quantity: 1 }];
      mockGet.mockResolvedValueOnce({ data: { id: "sub-1", entries } });
      const result = await handleGetSubscriptionLineItems(mockDeps, { subscriptionId: "sub-1" });
      expect(JSON.parse(result.content[0].text)).toEqual(entries);
    });

    it("returns isError on FastSpringError", async () => {
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      const result = await handleGetSubscriptionLineItems(mockDeps, { subscriptionId: "missing" });
      expect(result.isError).toBe(true);
    });
  });
});
