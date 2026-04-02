/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { createQuote } from "../../src/services/quotes.service.js";
import type { QuotesServiceDeps } from "../../src/services/quotes.service.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { QuoteFulfillmentTerm, QuoteStatus } from "../../src/types/quotes.types.js";
import type { CreateQuoteRequest } from "../../src/types/quotes.types.js";

vi.mock("axios");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_REQUEST: CreateQuoteRequest = {
  name: "Test Quote",
  items: [{ product: "basic-subscription" }],
  recipient: { first: "Jane", last: "Doe", email: "jane@example.com" },
  recipientAddress: { country: "US", postalCode: "90210" },
};

const QUOTE_RESPONSE = {
  id: "QUXU7RGI3XVNG53EAC6QJIMK4MVA",
  quoteUrl: "https://test.onfastspring.com/popup-defaultB2B/account/order/quote/QUXU7RGI3XVNG53EAC6QJIMK4MVA",
  status: QuoteStatus.OPEN,
  name: "Test Quote",
  currency: "USD",
  subtotal: 89.0,
  subtotalDisplay: "$89.00",
  tax: 0,
  taxRate: 0,
  taxType: "TAX",
  total: 89.0,
  totalDisplay: "$89.00",
  expires: "2026-05-02T15:01:57.508+00:00",
  created: "2026-04-02T15:01:57.652+00:00",
  recipient: { first: "Jane", last: "Doe", email: "jane@example.com" },
  items: [{ product: "basic-subscription", quantity: 1, unitListPrice: 89.0 }],
  tags: [],
  orderReference: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("quotes.service", () => {
  const mockHttp = {
    post: vi.fn(),
  } as unknown as ReturnType<typeof axios.create>;

  const deps: QuotesServiceDeps = { http: mockHttp };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("createQuote", () => {
    it("posts to /quotes and returns the quote response", async () => {
      mockHttp.post.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

      const result = await createQuote(deps, MINIMAL_REQUEST);

      expect(mockHttp.post).toHaveBeenCalledWith("/quotes", MINIMAL_REQUEST);
      expect(result).toEqual(QUOTE_RESPONSE);
    });

    it("returns quoteUrl and id from the response", async () => {
      mockHttp.post.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

      const result = await createQuote(deps, MINIMAL_REQUEST);

      expect(result.id).toBe("QUXU7RGI3XVNG53EAC6QJIMK4MVA");
      expect(result.quoteUrl).toContain("/popup-defaultB2B/account/order/quote/");
    });

    it("passes the full request body unchanged to the API", async () => {
      const fullRequest: CreateQuoteRequest = {
        name: "Enterprise Deal Q2",
        items: [
          { product: "pro-subscription", quantity: 5, unitListPrice: 99.0 },
          { product: "add-on-feature", quantity: 5 },
        ],
        recipient: {
          first: "Bob",
          last: "Smith",
          email: "bob@enterprise.com",
          company: "Enterprise Corp",
          phone: "+15555551234",
        },
        recipientAddress: {
          country: "US",
          postalCode: "10001",
          city: "New York",
          region: "NY",
          addressLine1: "100 Main St",
        },
        currency: "USD",
        expirationDateDays: 14,
        fulfillmentTerm: QuoteFulfillmentTerm.ON_PAYMENT,
        notes: "Please pay within 14 days.",
        coupon: "ENTERPRISE10",
        tags: [
          { key: "salesRep", value: "alice" },
          { key: "dealId", value: "crm-1234" },
        ],
        taxId: "US123456789",
        netTermsDays: 14,
      };
      mockHttp.post.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

      await createQuote(deps, fullRequest);

      expect(mockHttp.post).toHaveBeenCalledWith("/quotes", fullRequest);
    });

    it("passes tags as array of {key, value} objects", async () => {
      mockHttp.post.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

      const request: CreateQuoteRequest = {
        ...MINIMAL_REQUEST,
        tags: [
          { key: "channel", value: "direct" },
          { key: "region", value: "emea" },
        ],
      };
      await createQuote(deps, request);

      const posted = mockHttp.post.mock.calls[0][1] as CreateQuoteRequest;
      expect(posted.tags).toEqual([
        { key: "channel", value: "direct" },
        { key: "region", value: "emea" },
      ]);
    });

    it("passes price override per item when unitListPrice is set", async () => {
      mockHttp.post.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

      const request: CreateQuoteRequest = {
        ...MINIMAL_REQUEST,
        items: [{ product: "basic-subscription", quantity: 1, unitListPrice: 99.0 }],
      };
      await createQuote(deps, request);

      const posted = mockHttp.post.mock.calls[0][1] as CreateQuoteRequest;
      expect(posted.items[0].unitListPrice).toBe(99.0);
    });

    it("propagates FastSpringError on 400 bad request", async () => {
      mockHttp.post.mockRejectedValueOnce(
        new FastSpringError("Invalid product path", 400, {
          message: "Invalid product path",
        })
      );

      await expect(createQuote(deps, MINIMAL_REQUEST)).rejects.toThrow(FastSpringError);
    });

    it("propagates FastSpringError on 401 unauthorized", async () => {
      mockHttp.post.mockRejectedValueOnce(new FastSpringError("Unauthorized", 401));

      await expect(createQuote(deps, MINIMAL_REQUEST)).rejects.toThrow(FastSpringError);
    });

    it("propagates FastSpringError on 403 forbidden", async () => {
      mockHttp.post.mockRejectedValueOnce(new FastSpringError("Forbidden", 403));

      await expect(createQuote(deps, MINIMAL_REQUEST)).rejects.toThrow(FastSpringError);
    });

    it("propagates network errors", async () => {
      mockHttp.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(createQuote(deps, MINIMAL_REQUEST)).rejects.toThrow("ECONNREFUSED");
    });

    it("propagates timeout errors", async () => {
      mockHttp.post.mockRejectedValueOnce(new Error("ETIMEDOUT"));

      await expect(createQuote(deps, MINIMAL_REQUEST)).rejects.toThrow("ETIMEDOUT");
    });
  });
});
