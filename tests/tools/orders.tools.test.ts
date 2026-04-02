/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetOrder,
  handleListOrdersByEmail,
  GetOrderSchema,
  ListOrdersByEmailSchema,
} from "../../src/tools/orders.tools.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { Platform } from "../../src/types/lookup-results.types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODERN_ORDER = {
  id: "ord-modern-1",
  reference: "MOD-REF-1",
  status: "completed",
  customer: { email: "a@b.com" },
};

const CLASSIC_ORDER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <reference>VI0000000-0000-00000</reference>
  <status>complete</status>
  <customer><firstName>John</firstName><lastName>Doe</lastName><email>john@acme.com</email></customer>
  <items>
    <item><product>my-product</product><quantity>1</quantity><total>29.95</total></item>
  </items>
  <currency>USD</currency>
  <totalWithTax>29.95</totalWithTax>
</order>`;

describe("orders.tools", () => {
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
    it("GetOrderSchema accepts any non-empty reference", () => {
      expect(GetOrderSchema.safeParse({ reference: "ord-1" }).success).toBe(true);
      expect(GetOrderSchema.safeParse({ reference: "VI0000000-0000-00000" }).success).toBe(true);
    });

    it("GetOrderSchema rejects empty reference", () => {
      expect(GetOrderSchema.safeParse({ reference: "" }).success).toBe(false);
    });

    it("ListOrdersByEmailSchema accepts valid email", () => {
      expect(ListOrdersByEmailSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    });

    it("ListOrdersByEmailSchema rejects invalid email", () => {
      expect(ListOrdersByEmailSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // handleGetOrder — found on modern platform
  // -------------------------------------------------------------------------

  describe("handleGetOrder — found on modern platform", () => {
    it("returns { platform: 'sbl', data: order } when SBL lookup succeeds", async () => {
      mockGet.mockResolvedValueOnce({ data: MODERN_ORDER });

      const result = await handleGetOrder(mockDeps, { reference: "ord-modern-1" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe(Platform.SBL);
      expect(body.data).toEqual(MODERN_ORDER);
    });

    it("response platform value is 'sbl'", async () => {
      mockGet.mockResolvedValueOnce({ data: MODERN_ORDER });
      const result = await handleGetOrder(mockDeps, { reference: "ord-modern-1" });
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe("sbl");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetOrder — found on classic platform
  // -------------------------------------------------------------------------

  describe("handleGetOrder — found on classic platform", () => {
    it("returns { platform: 'classic', data: ... } when Classic lookup succeeds and SBL email cross-check finds no match", async () => {
      // Modern: 404
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // Classic primary: success
      mockGet.mockResolvedValueOnce({ data: CLASSIC_ORDER_XML });
      // SBL email cross-check: no matching SBL order → stays classic
      mockGet.mockResolvedValueOnce({ data: { orders: [] } });

      const result = await handleGetOrder(mockDeps, { reference: "VI0000000-0000-00000" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe("classic");
      expect(body.data.reference).toBe("VI0000000-0000-00000");
    });

    it("returns { platform: 'sbl', data: ... } when Classic finds order and SBL email cross-check matches modern record", async () => {
      const SBL_EQUIVALENT = {
        id: "gAzO0KiZRBWvZM1xjDWY2A",
        reference: "VI0000000-0000-00000",
        status: "completed",
        customer: { email: "john@acme.com" },
      };
      // Modern path-based: 404
      mockGet.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // Classic primary: success (CLASSIC_ORDER_XML has email john@acme.com)
      mockGet.mockResolvedValueOnce({ data: CLASSIC_ORDER_XML });
      // SBL email cross-check: finds the modern record
      mockGet.mockResolvedValueOnce({ data: { orders: [SBL_EQUIVALENT] } });

      const result = await handleGetOrder(mockDeps, { reference: "VI0000000-0000-00000" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.platform).toBe("sbl");
      expect(body.data.id).toBe("gAzO0KiZRBWvZM1xjDWY2A");
      expect(body.data.reference).toBe("VI0000000-0000-00000");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetOrder — not found
  // -------------------------------------------------------------------------

  describe("handleGetOrder — not found", () => {
    it("returns a not-found message when absent on all platforms", async () => {
      const mockDepsNoLegacy = { http: { get: mockGet }, companyId: "testco" };
      const notFoundErr = new FastSpringError("Not found", 404);

      // getOrder: path form → plain 404 (no response body ⟹ isOrderNotFoundError=false, no retry)
      mockGet.mockRejectedValueOnce(notFoundErr);
      // Classic direct → 404 → no legacyHttp → rethrows → triggers search fallback
      mockGet.mockRejectedValueOnce(notFoundErr);
      // Classic search → empty orders XML → returns []
      mockGet.mockResolvedValueOnce({ data: `<?xml version="1.0"?><orders></orders>` });

      const result = await handleGetOrder(mockDepsNoLegacy, { reference: "UNKNOWN" });

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.message).toContain("No order found");
      expect(body.reference).toBe("UNKNOWN");
    });
  });

  // -------------------------------------------------------------------------
  // handleGetOrder — error propagation
  // -------------------------------------------------------------------------

  describe("handleGetOrder — error propagation", () => {
    it("returns isError when auth fails (401)", async () => {
      mockGet.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));

      const result = await handleGetOrder(mockDeps, { reference: "ord-1" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).statusCode).toBe(401);
    });

    it("returns isError on network failure", async () => {
      mockGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await handleGetOrder(mockDeps, { reference: "ord-1" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain("ECONNREFUSED");
    });
  });

  // -------------------------------------------------------------------------
  // handleListOrdersByEmail
  // -------------------------------------------------------------------------

  describe("handleListOrdersByEmail", () => {
    it("returns array of orders", async () => {
      const orders = [{ id: "ord-1" }, { id: "ord-2" }];
      mockGet.mockResolvedValueOnce({ data: { orders } });
      const result = await handleListOrdersByEmail(mockDeps, { email: "a@b.com" });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0].text)).toEqual(orders);
    });

    it("returns isError on FastSpringError", async () => {
      mockGet.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));
      const result = await handleListOrdersByEmail(mockDeps, { email: "a@b.com" });
      expect(result.isError).toBe(true);
    });
  });
});
