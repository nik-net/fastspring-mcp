/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { getOrder, findOrdersByEmail, findOrdersByReference, getOrderByReference, lookupOrder } from "../../src/services/orders.service.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { Platform } from "../../src/types/lookup-results.types.js";

vi.mock("axios");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeXmlOrderResponse(ref: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<order>
  <reference>${ref}</reference>
  <status>completed</status>
  <statusChanged>2026-02-12T16:46:39.299Z</statusChanged>
  <test>false</test>
  <returnStatus>none</returnStatus>
  <customer>
    <firstName>Jane</firstName>
    <lastName>Doe</lastName>
    <company>Acme Corp</company>
    <email>jane@acme.com</email>
    <phoneNumber>+1234567890</phoneNumber>
  </customer>
  <currency>USD</currency>
  <total>99</total>
  <tax>0</tax>
  <shipping>0</shipping>
  <orderItems>
    <orderItem>
      <productDisplay>Test Product</productDisplay>
      <productName>test-product-annual</productName>
      <quantity>1</quantity>
    </orderItem>
  </orderItems>
  <payments>
    <payment>
      <status>completed</status>
      <statusChanged>2026-02-12T00:00:00Z</statusChanged>
      <methodType>creditcard</methodType>
      <currency>USD</currency>
      <total>99</total>
    </payment>
  </payments>
</order>`;
}

function makeXmlSearchResponse(ref: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<orders>
  <order>
    <reference>${ref}</reference>
    <status>completed</status>
    <statusChanged>2026-02-12T16:46:39.299Z</statusChanged>
    <test>false</test>
    <returnStatus>none</returnStatus>
    <customer>
      <firstName>Jane</firstName>
      <lastName>Doe</lastName>
      <company>Acme Corp</company>
      <email>jane@acme.com</email>
    </customer>
  </order>
</orders>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orders.service", () => {
  const mockHttp = {
    get: vi.fn(),
  } as unknown as ReturnType<typeof axios.create>;

  const mockLegacyHttp = {
    get: vi.fn(),
  } as unknown as ReturnType<typeof axios.create>;

  const depsWithCompany = { http: mockHttp, companyId: "testco" };
  const depsWithoutCompany = { http: mockHttp };
  const depsWithLegacy = {
    http: mockHttp,
    companyId: "testco",
    legacyHttp: mockLegacyHttp,
    legacyCompanyId: "legacyco",
  };

  beforeEach(() => {
    // resetAllMocks clears both call history AND unconsumed mockResolvedValueOnce
    // queues, preventing stale state from leaking between tests.
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("getOrder", () => {
    it("returns order on success", async () => {
      const order = { id: "ord-1", reference: "REF-1", status: "completed" };
      mockHttp.get.mockResolvedValueOnce({ data: order });
      const result = await getOrder(depsWithCompany, "ord-1");
      expect(result).toEqual(order);
      expect(mockHttp.get).toHaveBeenCalledWith("/orders/ord-1");
    });

    it("throws FastSpringError on 404", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new (await import("../../src/utils/errors.js")).FastSpringError(
          "Not found",
          404,
          {}
        )
      );
      await expect(getOrder(depsWithCompany, "missing")).rejects.toThrow(FastSpringError);
    });

    it("throws FastSpringError on 401", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Unauthorized", 401)
      );
      await expect(getOrder(depsWithCompany, "ord-1")).rejects.toThrow(FastSpringError);
    });

    it("throws on network error", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(getOrder(depsWithCompany, "ord-1")).rejects.toThrow("ECONNREFUSED");
    });

    it("falls back to query-param lookup when path returns Not found error body", async () => {
      const notFoundBody = { orders: [{ error: { order: "Not found" } }] };
      const targetOrder = { id: "ord-1", reference: "REF-1", status: "completed" };
      mockHttp.get
        .mockRejectedValueOnce(new FastSpringError("Not found", 400, notFoundBody))
        .mockResolvedValueOnce({ data: { orders: [targetOrder] } });

      const result = await getOrder(depsWithCompany, "ord-1");
      expect(result).toEqual(targetOrder);
      expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/orders", { params: { order: "ord-1" } });
    });

    it("rethrows path error when query-param fallback returns empty orders", async () => {
      const notFoundBody = { orders: [{ error: { order: "Not found" } }] };
      const originalErr = new FastSpringError("Not found", 400, notFoundBody);
      mockHttp.get
        .mockRejectedValueOnce(originalErr)
        .mockResolvedValueOnce({ data: { orders: [] } });

      await expect(getOrder(depsWithCompany, "ord-1")).rejects.toThrow(FastSpringError);
    });

    it("rethrows path error when query-param fallback returns an error object", async () => {
      const notFoundBody = { orders: [{ error: { order: "Not found" } }] };
      const originalErr = new FastSpringError("Not found", 400, notFoundBody);
      mockHttp.get
        .mockRejectedValueOnce(originalErr)
        .mockResolvedValueOnce({ data: { orders: [{ error: "invalid" }] } });

      await expect(getOrder(depsWithCompany, "ord-1")).rejects.toThrow(FastSpringError);
    });
  });

  // -------------------------------------------------------------------------
  describe("findOrdersByEmail", () => {
    it("returns orders array on success", async () => {
      const orders = [{ id: "ord-1" }, { id: "ord-2" }];
      mockHttp.get.mockResolvedValueOnce({ data: { orders } });
      const result = await findOrdersByEmail(depsWithCompany, "a@b.com");
      expect(result).toEqual(orders);
      expect(mockHttp.get).toHaveBeenCalledWith("/orders", {
        params: { email: "a@b.com" },
      });
    });

    it("returns empty array when response has no orders", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: {} });
      const result = await findOrdersByEmail(depsWithCompany, "a@b.com");
      expect(result).toEqual([]);
    });

    it("throws FastSpringError on 401", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Unauthorized", 401)
      );
      await expect(
        findOrdersByEmail(depsWithCompany, "a@b.com")
      ).rejects.toThrow(FastSpringError);
    });
  });

  // -------------------------------------------------------------------------
  describe("findOrdersByReference", () => {
    it("uses the Classic API search endpoint and returns LegacyOrderSearchResult[]", async () => {
      const ref = "VI0000000-0000-00000";
      mockHttp.get.mockResolvedValueOnce({ data: makeXmlSearchResponse(ref) });

      const result = await findOrdersByReference(depsWithCompany, ref);

      expect(mockHttp.get).toHaveBeenCalledWith(
        `/company/testco/orders/search`,
        expect.objectContaining({ params: { query: ref }, responseType: "text" })
      );
      expect(result).toHaveLength(1);
      // Returns native LegacyOrderSearchResult fields (no mapping)
      expect(result[0].reference).toBe(ref);
      expect(result[0].status).toBe("completed");
      expect(result[0].returnStatus).toBe("none");
      expect(result[0].customer?.email).toBe("jane@acme.com");
      expect(result[0].customer?.firstName).toBe("Jane");
      expect(result[0].customer?.company).toBe("Acme Corp");
    });

    it("returns empty array when search finds no orders", async () => {
      const emptyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><orders></orders>`;
      mockHttp.get.mockResolvedValueOnce({ data: emptyXml });
      const result = await findOrdersByReference(depsWithCompany, "NONEXISTENT");
      expect(result).toEqual([]);
    });

    it("throws an error when companyId is not configured", async () => {
      await expect(
        findOrdersByReference(depsWithoutCompany, "VI0000000-0000-00000")
      ).rejects.toThrow("FS_COMPANY_ID is not configured");
    });

    it("throws on network error", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      await expect(
        findOrdersByReference(depsWithCompany, "REF")
      ).rejects.toThrow("ETIMEDOUT");
    });

    it("retries with legacy credentials on 401 from primary", async () => {
      const ref = "VI0000000-0000-00002";
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401, {}));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlSearchResponse(ref) });

      const result = await findOrdersByReference(depsWithLegacy, ref);

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        `/company/legacyco/orders/search`,
        expect.objectContaining({ params: { query: ref }, responseType: "text" })
      );
      expect(result[0].reference).toBe(ref);
    });

    it("retries with legacy credentials when primary returns access-denied XML parse error", async () => {
      const ref = "VI0000000-0000-00002";
      // Simulate Classic API returning "Access denied to site." plain text (non-XML)
      mockHttp.get.mockResolvedValueOnce({ data: "Access denied to site." });
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlSearchResponse(ref) });

      const result = await findOrdersByReference(depsWithLegacy, ref);

      expect(result[0].reference).toBe(ref);
    });

    it("does not retry with legacy on network error (transient failure)", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      await expect(
        findOrdersByReference(depsWithLegacy, "REF")
      ).rejects.toThrow("ETIMEDOUT");
      expect(mockLegacyHttp.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("getOrderByReference", () => {
    it("returns full LegacyOrder from Classic API direct endpoint", async () => {
      const ref = "VI0000000-0000-00000";
      mockHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(ref) });

      const result = await getOrderByReference(depsWithCompany, ref);

      expect(mockHttp.get).toHaveBeenCalledWith(
        `/company/testco/order/${ref}`,
        expect.objectContaining({ responseType: "text" })
      );
      expect(result).not.toBeNull();

      // Full LegacyOrder fields — not stripped by mapping
      expect(result?.reference).toBe(ref);
      expect(result?.status).toBe("completed");
      expect(result?.total).toBe(99);
      expect(result?.tax).toBe(0);
      expect(result?.shipping).toBe(0);
      expect(result?.currency).toBe("USD");
      expect(result?.returnStatus).toBe("none");

      // Customer with all fields
      expect(result?.customer?.email).toBe("jane@acme.com");
      expect(result?.customer?.firstName).toBe("Jane");
      expect(result?.customer?.lastName).toBe("Doe");
      expect(result?.customer?.company).toBe("Acme Corp");
      expect(result?.customer?.phoneNumber).toBe("+1234567890");

      // Line items with productDisplay preserved
      expect(result?.orderItems).toHaveLength(1);
      expect(result?.orderItems?.[0].productName).toBe("test-product-annual");
      expect(result?.orderItems?.[0].productDisplay).toBe("Test Product");
      expect(result?.orderItems?.[0].quantity).toBe(1);

      // Payments included
      expect(result?.payments).toHaveLength(1);
      expect(result?.payments?.[0].status).toBe("completed");
      expect(result?.payments?.[0].methodType).toBe("creditcard");
      expect(result?.payments?.[0].total).toBe(99);
    });

    it("falls back to search endpoint on 404 and returns abbreviated LegacyOrder", async () => {
      const ref = "VI0000000-0000-00000";
      mockHttp.get
        .mockRejectedValueOnce(new FastSpringError("Not Found", 404, {}))
        .mockResolvedValueOnce({ data: makeXmlSearchResponse(ref) });

      const result = await getOrderByReference(depsWithCompany, ref);

      expect(mockHttp.get).toHaveBeenCalledTimes(2);
      expect(result?.reference).toBe(ref);
      expect(result?.status).toBe("completed");
    });

    it("returns null when both direct lookup and search find nothing", async () => {
      const emptyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><orders></orders>`;
      mockHttp.get
        .mockRejectedValueOnce(new FastSpringError("Not Found", 404, {}))
        .mockResolvedValueOnce({ data: emptyXml });

      const result = await getOrderByReference(depsWithCompany, "NONEXISTENT");
      expect(result).toBeNull();
    });

    it("throws a non-404 error without falling back to search", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401, {}));
      await expect(
        getOrderByReference(depsWithCompany, "VI0000000-0000-00000")
      ).rejects.toThrow(FastSpringError);
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("throws an error when companyId is not configured", async () => {
      await expect(
        getOrderByReference(depsWithoutCompany, "VI0000000-0000-00000")
      ).rejects.toThrow("FS_COMPANY_ID is not configured");
    });

    it("retries with legacy credentials when primary returns access-denied plain text", async () => {
      const ref = "VI0000000-0000-00002";
      // Primary returns "Access denied to site." (non-XML body, HTTP 200)
      mockHttp.get.mockResolvedValueOnce({ data: "Access denied to site." });
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(ref) });

      const result = await getOrderByReference(depsWithLegacy, ref);

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        `/company/legacyco/order/${ref}`,
        expect.objectContaining({ responseType: "text" })
      );
      expect(result?.reference).toBe(ref);
      expect(result?.status).toBe("completed");
      expect(result?.total).toBe(99);
    });

    it("retries with legacy credentials on 401 from primary", async () => {
      const ref = "VI0000000-0000-00002";
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401, {}));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(ref) });

      const result = await getOrderByReference(depsWithLegacy, ref);

      expect(result?.reference).toBe(ref);
    });

    it("retries with legacy when primary returns 404 (order may be on legacy platform)", async () => {
      const ref = "VI0000000-0000-00002";
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not Found", 404, {}));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(ref) });

      const result = await getOrderByReference(depsWithLegacy, ref);

      expect(result?.reference).toBe(ref);
    });

    it("falls back to search when both direct lookups fail with 404", async () => {
      const ref = "NONEXISTENT";
      const emptyOrdersXml = `<?xml version="1.0" encoding="UTF-8"?><orders></orders>`;
      // Call sequence:
      // 1. primary direct lookup  → 404
      // 2. legacy direct lookup   → 404  (triggers search fallback)
      // 3. primary search         → 403  (triggers legacy search)
      // 4. legacy search          → empty orders XML → null
      mockHttp.get
        .mockRejectedValueOnce(new FastSpringError("Not Found", 404, {}))   // 1
        .mockRejectedValueOnce(new FastSpringError("Forbidden", 403, {}));  // 3
      mockLegacyHttp.get
        .mockRejectedValueOnce(new FastSpringError("Not Found", 404, {}))   // 2
        .mockResolvedValueOnce({ data: emptyOrdersXml });                   // 4

      const result = await getOrderByReference(depsWithLegacy, ref);

      expect(result).toBeNull();
    });

    it("does not retry with legacy on network error (transient failure)", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(
        getOrderByReference(depsWithLegacy, "VI0000000-0000-00002")
      ).rejects.toThrow("ECONNREFUSED");
      expect(mockLegacyHttp.get).not.toHaveBeenCalled();
    });

    it("uses legacyCompanyId (not companyId) when retrying", async () => {
      const ref = "VI0000000-0000-00002";
      mockHttp.get.mockResolvedValueOnce({ data: "Access denied to site." });
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(ref) });

      await getOrderByReference(depsWithLegacy, ref);

      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        `/company/legacyco/order/${ref}`,
        expect.objectContaining({ responseType: "text" })
      );
    });
  });

  // -------------------------------------------------------------------------
  // lookupOrder
  // -------------------------------------------------------------------------

  describe("lookupOrder", () => {
    const sblOrder = { id: "ord-sbl-1", status: "completed", customer: { email: "a@b.com" } };
    const classicRef = "VI0000000-0000-00000";

    it("returns { platform: sbl, data } when SBL lookup succeeds", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: sblOrder });

      const result = await lookupOrder(depsWithLegacy, "ord-sbl-1");

      expect(result).not.toBeNull();
      expect(result?.platform).toBe(Platform.SBL);
      expect(result?.data).toEqual(sblOrder);
    });

    it("returns { platform: classic, data } when SBL fails, Classic succeeds, and SBL email cross-check finds no match", async () => {
      // SBL getOrder: path form fails, query-param form also fails
      const notFoundErr = new FastSpringError("Not found", 400, {
        orders: [{ result: "error", error: { order: "Not found" } }],
      });
      mockHttp.get
        .mockRejectedValueOnce(notFoundErr)   // SBL path-based lookup
        .mockRejectedValueOnce(notFoundErr);  // SBL query-param retry
      // Classic direct lookup
      mockHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(classicRef) });
      // SBL email cross-check returns no orders for this customer — pure Classic order
      mockHttp.get.mockResolvedValueOnce({ data: { orders: [] } });

      const result = await lookupOrder(depsWithLegacy, classicRef);

      expect(result?.platform).toBe(Platform.CLASSIC);
      expect((result?.data as { reference: string }).reference).toBe(classicRef);
    });

    it("returns { platform: sbl, data } when Classic finds order and SBL email cross-check finds a matching SBL record", async () => {
      // SBL getOrder: path form fails, query-param form also fails
      const notFoundErr = new FastSpringError("Not found", 400, {
        orders: [{ result: "error", error: { order: "Not found" } }],
      });
      mockHttp.get
        .mockRejectedValueOnce(notFoundErr)   // SBL path-based lookup
        .mockRejectedValueOnce(notFoundErr);  // SBL query-param retry
      // Classic direct lookup (provides customer email: jane@acme.com)
      mockHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(classicRef) });
      // SBL email cross-check returns an SBL order with the same VI reference
      const sblEquivalent = {
        id: "gAzO0KiZRBWvZM1xjDWY2A",
        reference: classicRef,
        status: "completed",
        customer: { email: "jane@acme.com" },
      };
      mockHttp.get.mockResolvedValueOnce({ data: { orders: [sblEquivalent] } });

      const result = await lookupOrder(depsWithLegacy, classicRef);

      expect(result?.platform).toBe(Platform.SBL);
      expect((result?.data as { id: string }).id).toBe("gAzO0KiZRBWvZM1xjDWY2A");
      expect((result?.data as { reference: string }).reference).toBe(classicRef);
    });

    it("returns null when SBL fails and Classic also returns null", async () => {
      // Use depsWithCompany (no legacyHttp) so a Classic 404 does not trigger a
      // legacy-credential retry, keeping the mock sequence simple.
      const notFoundErr = new FastSpringError("Not found", 400, {
        orders: [{ result: "error", error: { order: "Not found" } }],
      });
      // SBL: path form + query-param form both fail
      mockHttp.get
        .mockRejectedValueOnce(notFoundErr)
        .mockRejectedValueOnce(notFoundErr);
      // Classic direct → 404 (no legacyHttp → thrown to getOrderByReference)
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // getOrderByReference falls back to Classic search on 404 → empty results
      mockHttp.get.mockResolvedValueOnce({ data: `<?xml version="1.0"?><orders></orders>` });

      const result = await lookupOrder(depsWithCompany, "DOES-NOT-EXIST");

      expect(result).toBeNull();
    });

    it("skips Classic when companyId is not configured", async () => {
      const notFoundErr = new FastSpringError("Not found", 400, {
        orders: [{ result: "error", error: { order: "Not found" } }],
      });
      mockHttp.get
        .mockRejectedValueOnce(notFoundErr)
        .mockRejectedValueOnce(notFoundErr);

      const result = await lookupOrder(depsWithoutCompany, "UNKNOWN");

      expect(result).toBeNull();
    });

    it("propagates auth errors (401) from SBL without trying Classic", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));

      await expect(lookupOrder(depsWithLegacy, "ord-1")).rejects.toThrow(FastSpringError);
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("propagates network errors without trying Classic", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(lookupOrder(depsWithLegacy, "ord-1")).rejects.toThrow("ECONNREFUSED");
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("uses legacy credentials when Classic primary is access-denied", async () => {
      const notFoundErr = new FastSpringError("Not found", 400, {
        orders: [{ result: "error", error: { order: "Not found" } }],
      });
      mockHttp.get
        .mockRejectedValueOnce(notFoundErr)                          // SBL path-based
        .mockRejectedValueOnce(notFoundErr);                         // SBL query-param retry
      // Classic primary → access denied
      mockHttp.get.mockResolvedValueOnce({ data: "Access denied to site." });
      // Classic legacy → success
      mockLegacyHttp.get.mockResolvedValueOnce({ data: makeXmlOrderResponse(classicRef) });
      // SBL email cross-check → no match (pure Classic order)
      mockHttp.get.mockResolvedValueOnce({ data: { orders: [] } });

      const result = await lookupOrder(depsWithLegacy, classicRef);

      expect(result?.platform).toBe(Platform.CLASSIC);
    });
  });
});
