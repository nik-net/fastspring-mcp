/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSubscription,
  getSubscriptionByReference,
  listSubscriptions,
  getSubscriptionEntries,
  getClassicSubscriptionByReference,
  lookupSubscription,
} from "../../src/services/subscriptions.service.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { Platform } from "../../src/types/lookup-results.types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBSCRIPTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<subscription>
  <reference>VI0000000-0000-00000S</reference>
  <status>active</status>
  <productName>my-software-annual</productName>
  <quantity>1</quantity>
  <customer>
    <firstName>John</firstName>
    <email>john@acme.com</email>
  </customer>
</subscription>`;

describe("subscriptions.service", () => {
  const mockHttp = { get: vi.fn() } as unknown as Parameters<
    typeof getSubscription
  >[0]["http"];
  const mockLegacyHttp = { get: vi.fn() } as unknown as Parameters<
    typeof getSubscription
  >[0]["http"];

  const deps = { http: mockHttp };
  const depsWithClassic = {
    http: mockHttp,
    companyId: "example-company",
  };
  const depsWithLegacy = {
    http: mockHttp,
    companyId: "example-company",
    legacyHttp: mockLegacyHttp,
    legacyCompanyId: "example-company-legacy",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getSubscription", () => {
    it("returns subscription on success", async () => {
      const sub = { id: "sub-1", status: "active", customer: { email: "a@b.com" } };
      mockHttp.get.mockResolvedValueOnce({ data: sub });
      const result = await getSubscription(deps, "sub-1");
      expect(result).toEqual(sub);
      expect(mockHttp.get).toHaveBeenCalledWith("/subscriptions/sub-1");
    });

    it("throws FastSpringError on 404", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Not found", 404)
      );
      await expect(getSubscription(deps, "missing")).rejects.toThrow(
        FastSpringError
      );
    });

    it("throws on 401", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Unauthorized", 401)
      );
      await expect(getSubscription(deps, "sub-1")).rejects.toThrow(
        FastSpringError
      );
    });
  });

  describe("getSubscriptionByReference", () => {
    it("returns subscription when found", async () => {
      const sub = { id: "sub-1", reference: "REF-1" };
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [sub] } });
      const result = await getSubscriptionByReference(deps, "REF-1");
      expect(result).toEqual(sub);
    });

    it("returns null when no subscription found", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });
      const result = await getSubscriptionByReference(deps, "REF-1");
      expect(result).toBeNull();
    });

    it("throws on network error", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(
        getSubscriptionByReference(deps, "REF-1")
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("listSubscriptions", () => {
    it("returns subscriptions with no filters", async () => {
      const subs = [{ id: "sub-1" }];
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: subs } });
      const result = await listSubscriptions(deps, {});
      expect(result).toEqual(subs);
      expect(mockHttp.get).toHaveBeenCalledWith("/subscriptions", {
        params: undefined,
      });
    });

    it("passes status, product, email filters", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });
      await listSubscriptions(deps, {
        status: "active",
        product: "my-product",
        email: "a@b.com",
      });
      expect(mockHttp.get).toHaveBeenCalledWith("/subscriptions", {
        params: { status: "active", product: "my-product", email: "a@b.com" },
      });
    });
  });

  describe("getSubscriptionEntries", () => {
    it("returns entries from subscription", async () => {
      const entries = [{ product: "prod-1", quantity: 1 }];
      mockHttp.get
        .mockResolvedValueOnce({
          data: { id: "sub-1", entries },
        });
      const result = await getSubscriptionEntries(deps, "sub-1");
      expect(result).toEqual(entries);
    });

    it("returns empty array when subscription has no entries", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: { id: "sub-1" } });
      const result = await getSubscriptionEntries(deps, "sub-1");
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getClassicSubscriptionByReference
  // -------------------------------------------------------------------------

  describe("getClassicSubscriptionByReference", () => {
    it("throws when companyId is not configured", async () => {
      await expect(
        getClassicSubscriptionByReference(deps, "VI0000000-0000-00000S")
      ).rejects.toThrow("FS_COMPANY_ID is not configured");
    });

    it("returns parsed subscription on primary-credentials success", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await getClassicSubscriptionByReference(
        depsWithClassic,
        "VI0000000-0000-00000S"
      );

      expect(result).not.toBeNull();
      expect(result?.reference).toBe("VI0000000-0000-00000S");
      expect(result?.status).toBe("active");
      expect(result?.productName).toBe("my-software-annual");
      expect(result?.customer?.email).toBe("john@acme.com");
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/company/example-company/subscription/VI0000000-0000-00000S",
        expect.objectContaining({ responseType: "text" })
      );
    });

    it("trims whitespace from the reference before requesting", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      await getClassicSubscriptionByReference(depsWithClassic, "  VI0000000-0000-00000S  ");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/company/example-company/subscription/VI0000000-0000-00000S",
        expect.objectContaining({ responseType: "text" })
      );
    });

    it("returns null when primary returns 404 and no legacy credentials", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));

      const result = await getClassicSubscriptionByReference(
        depsWithClassic,
        "VI0000000-0000-00000S"
      );

      expect(result).toBeNull();
    });

    it("throws when primary returns non-404 error and no legacy credentials", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Server error", 500));

      await expect(
        getClassicSubscriptionByReference(depsWithClassic, "VI0000000-0000-00000S")
      ).rejects.toThrow(FastSpringError);
    });

    it("retries with legacy credentials on primary 401", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await getClassicSubscriptionByReference(
        depsWithLegacy,
        "VI0000000-0000-00000S"
      );

      expect(result).not.toBeNull();
      expect(result?.reference).toBe("VI0000000-0000-00000S");
      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        "/company/example-company-legacy/subscription/VI0000000-0000-00000S",
        expect.objectContaining({ responseType: "text" })
      );
    });

    it("retries with legacy credentials on primary 403", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Forbidden", 403));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await getClassicSubscriptionByReference(
        depsWithLegacy,
        "VI0000000-0000-00000S"
      );

      expect(result).not.toBeNull();
      expect(result?.reference).toBe("VI0000000-0000-00000S");
    });

    it("retries with legacy credentials on primary non-XML response (access denied body)", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: "Access denied to site." });
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await getClassicSubscriptionByReference(
        depsWithLegacy,
        "VI0000000-0000-00000S"
      );

      expect(result).not.toBeNull();
      expect(result?.reference).toBe("VI0000000-0000-00000S");
    });

    it("retries with legacy credentials when primary returns 404", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await getClassicSubscriptionByReference(
        depsWithLegacy,
        "VI0000000-0000-00000S"
      );

      expect(result).not.toBeNull();
      expect(result?.reference).toBe("VI0000000-0000-00000S");
    });

    it("returns null when primary 404 and legacy 404", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockLegacyHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));

      const result = await getClassicSubscriptionByReference(
        depsWithLegacy,
        "VI0000000-0000-00000S"
      );

      expect(result).toBeNull();
    });

    it("throws when primary is denied, legacy is configured but also fails with non-404", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));
      mockLegacyHttp.get.mockRejectedValueOnce(new FastSpringError("Server error", 500));

      await expect(
        getClassicSubscriptionByReference(depsWithLegacy, "VI0000000-0000-00000S")
      ).rejects.toThrow(FastSpringError);
    });

    it("uses legacyCompanyId (not companyId) when retrying with legacy credentials", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      await getClassicSubscriptionByReference(depsWithLegacy, "VI0000000-0000-00000S");

      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        "/company/example-company-legacy/subscription/VI0000000-0000-00000S",
        expect.anything()
      );
    });

    it("falls back to companyId when legacyCompanyId is not set", async () => {
      const depsNoLegacyCompanyId = {
        http: mockHttp,
        companyId: "example-company",
        legacyHttp: mockLegacyHttp,
      };

      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));
      mockLegacyHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      await getClassicSubscriptionByReference(depsNoLegacyCompanyId, "VI0000000-0000-00000S");

      expect(mockLegacyHttp.get).toHaveBeenCalledWith(
        "/company/example-company/subscription/VI0000000-0000-00000S",
        expect.anything()
      );
    });

    it("throws network errors without retrying", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        getClassicSubscriptionByReference(depsWithLegacy, "VI0000000-0000-00000S")
      ).rejects.toThrow("ECONNREFUSED");

      expect(mockLegacyHttp.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // lookupSubscription
  // -------------------------------------------------------------------------

  describe("lookupSubscription", () => {
    const sblSub = { id: "sub-sbl-1", reference: "SBL-REF-1", status: "active", customer: { email: "a@b.com" } };

    it("returns { platform: sbl, data } when SBL ID lookup succeeds", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: sblSub });

      const result = await lookupSubscription(depsWithLegacy, "sub-sbl-1");

      expect(result).not.toBeNull();
      expect(result?.platform).toBe(Platform.SBL);
      expect(result?.data).toEqual(sblSub);
    });

    it("falls through to SBL-by-reference when SBL ID returns 404", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [sblSub] } });

      const result = await lookupSubscription(depsWithLegacy, "SBL-REF-1");

      expect(result?.platform).toBe(Platform.SBL);
      expect(result?.data).toEqual(sblSub);
    });

    it("falls through to Classic when SBL ID returns 400 and SBL reference returns empty", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Bad request", 400));
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404)); // company-scoped
      mockHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await lookupSubscription(depsWithLegacy, "VI0000000-0000-00000S");

      expect(result?.platform).toBe(Platform.CLASSIC);
      expect((result?.data as { reference: string }).reference).toBe("VI0000000-0000-00000S");
    });

    it("returns null when not found on any platform", async () => {
      // Use deps without legacyHttp so a Classic 404 returns null directly,
      // without triggering a legacy-credential retry (tested separately above).
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404)); // SBL ID
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });       // SBL ref
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404)); // company-scoped
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404)); // Classic primary → null

      const result = await lookupSubscription(depsWithClassic, "DOES-NOT-EXIST");

      expect(result).toBeNull();
    });

    it("falls through to Classic when SBL step 2 throws a 400 (e.g. unrecognized Classic reference)", async () => {
      // Step 1: SBL by ID → 404
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // Step 2: SBL by reference → 400 (Classic ref is unrecognized by SBL)
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Bad Request", 400));
      // Step 3: company-scoped → 404
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // Step 4: Classic → success
      mockHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await lookupSubscription(depsWithClassic, "VI0000000-0000-00000S");

      expect(result?.platform).toBe(Platform.CLASSIC);
      expect((result?.data as { reference: string }).reference).toBe("VI0000000-0000-00000S");
    });

    it("falls through to Classic when SBL step 1 returns an error body as HTTP 200", async () => {
      // SBL returns HTTP 200 with an error body (no "id" field)
      mockHttp.get.mockResolvedValueOnce({
        data: { action: "subscription.get", result: "error", error: { id: "Not found" } },
      });
      // Step 2: SBL by reference → not found (empty)
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });
      // Step 3: company-scoped → 404
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      // Step 4: Classic → success
      mockHttp.get.mockResolvedValueOnce({ data: SUBSCRIPTION_XML });

      const result = await lookupSubscription(depsWithClassic, "VI0000000-0000-00000S");

      expect(result?.platform).toBe(Platform.CLASSIC);
    });

    it("propagates auth errors (401) from SBL without trying further", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));

      await expect(lookupSubscription(depsWithLegacy, "sub-1")).rejects.toThrow(FastSpringError);
      // SBL reference and Classic should NOT be attempted
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("propagates network errors without trying further", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(lookupSubscription(depsWithLegacy, "sub-1")).rejects.toThrow("ECONNREFUSED");
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("skips Classic step when companyId is not configured", async () => {
      const depsNoCompany = { http: mockHttp };

      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      mockHttp.get.mockResolvedValueOnce({ data: { subscriptions: [] } });

      const result = await lookupSubscription(depsNoCompany, "UNKNOWN");

      expect(result).toBeNull();
      // Classic was not called — only 2 SBL calls (ID + reference)
      expect(mockHttp.get).toHaveBeenCalledTimes(2);
    });
  });
});
