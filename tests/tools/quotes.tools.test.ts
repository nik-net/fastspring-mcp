/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreateQuoteSchema,
  handleCreateQuote,
  quotesToolDefinitions,
} from "../../src/tools/quotes.tools.js";
import { FastSpringError } from "../../src/utils/errors.js";
import { QuoteFulfillmentTerm, QuoteStatus } from "../../src/types/quotes.types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_MINIMAL_INPUT = {
  name: "Test Quote",
  items: [{ product: "basic-subscription" }],
  recipient: { first: "Jane", last: "Doe", email: "jane@example.com" },
  recipientAddress: { country: "US" },
};

const QUOTE_RESPONSE = {
  id: "QUXU7RGI3XVNG53EAC6QJIMK4MVA",
  quoteUrl:
    "https://test.onfastspring.com/popup-defaultB2B/account/order/quote/QUXU7RGI3XVNG53EAC6QJIMK4MVA",
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
  recipientAddress: { country: "US", postalCode: "" },
  items: [{ product: "basic-subscription", quantity: 1, unitListPrice: 89.0 }],
  tags: [],
  orderReference: null,
};

// ---------------------------------------------------------------------------
// Schema Validation
// ---------------------------------------------------------------------------

describe("CreateQuoteSchema", () => {
  describe("required fields", () => {
    it("parses minimal valid input", () => {
      const result = CreateQuoteSchema.safeParse(VALID_MINIMAL_INPUT);
      expect(result.success).toBe(true);
    });

    it("rejects when name is missing", () => {
      const { name: _, ...input } = VALID_MINIMAL_INPUT;
      const result = CreateQuoteSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects when items is missing", () => {
      const { items: _, ...input } = VALID_MINIMAL_INPUT;
      const result = CreateQuoteSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects when items array is empty", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects when recipient is missing", () => {
      const { recipient: _, ...input } = VALID_MINIMAL_INPUT;
      const result = CreateQuoteSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects when recipientAddress is missing", () => {
      const { recipientAddress: _, ...input } = VALID_MINIMAL_INPUT;
      const result = CreateQuoteSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects when recipient.email is missing", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipient: { first: "Jane", last: "Doe" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects when recipient.first is missing", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipient: { last: "Doe", email: "jane@example.com" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects when recipient.last is missing", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipient: { first: "Jane", email: "jane@example.com" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects when recipientAddress.country is missing", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipientAddress: { postalCode: "90210" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects when item.product is missing", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [{ quantity: 2 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("recipient email validation", () => {
    it("rejects an invalid email", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipient: { ...VALID_MINIMAL_INPUT.recipient, email: "not-an-email" },
      });
      expect(result.success).toBe(false);
    });

    it("trims whitespace from email before validation", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipient: {
          ...VALID_MINIMAL_INPUT.recipient,
          email: "  jane@example.com  ",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recipient.email).toBe("jane@example.com");
      }
    });
  });

  describe("country code validation", () => {
    it("rejects a country code that is not exactly 2 characters", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipientAddress: { country: "USA" },
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid 2-letter country code", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipientAddress: { country: "GB" },
      });
      expect(result.success).toBe(true);
    });

    it("normalises country code to uppercase", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        recipientAddress: { country: "gb" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recipientAddress.country).toBe("GB");
      }
    });
  });

  describe("optional item fields", () => {
    it("accepts item with only product set", () => {
      const result = CreateQuoteSchema.safeParse(VALID_MINIMAL_INPUT);
      expect(result.success).toBe(true);
    });

    it("accepts item with product, quantity, and unitListPrice", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [{ product: "basic-subscription", quantity: 5, unitListPrice: 79.0 }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects item quantity of 0", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [{ product: "basic-subscription", quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative unitListPrice", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [{ product: "basic-subscription", unitListPrice: -1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("optional top-level fields", () => {
    it("accepts expirationDateDays within 1-90 range", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        expirationDateDays: 30,
      });
      expect(result.success).toBe(true);
    });

    it("rejects expirationDateDays of 0", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        expirationDateDays: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects expirationDateDays greater than 90", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        expirationDateDays: 91,
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid fulfillmentTerm enum value", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        fulfillmentTerm: QuoteFulfillmentTerm.ON_PAYMENT,
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown fulfillmentTerm value", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        fulfillmentTerm: "INVALID_TERM",
      });
      expect(result.success).toBe(false);
    });

    it("accepts tags as array of {key, value} objects", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        tags: [{ key: "channel", value: "direct" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid 3-letter currency code", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        currency: "GBP",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a currency code that is not 3 characters", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        currency: "US",
      });
      expect(result.success).toBe(false);
    });

    it("accepts multiple items", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [
          { product: "product-a", quantity: 1 },
          { product: "product-b", quantity: 2, unitListPrice: 49.0 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("trims whitespace from name", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        name: "  My Quote  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Quote");
      }
    });

    it("trims whitespace from product path", () => {
      const result = CreateQuoteSchema.safeParse({
        ...VALID_MINIMAL_INPUT,
        items: [{ product: "  basic-subscription  " }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items[0].product).toBe("basic-subscription");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe("handleCreateQuote", () => {
  const mockPost = vi.fn();
  const mockDeps = {
    http: { post: mockPost },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns structured content with quoteId and quoteUrl on success", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.quoteId).toBe("QUXU7RGI3XVNG53EAC6QJIMK4MVA");
    expect(parsed.quoteUrl).toContain("/popup-defaultB2B/account/order/quote/");
  });

  it("includes status OPEN in the response", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe(QuoteStatus.OPEN);
  });

  it("includes pricing summary fields in the response", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalDisplay).toBe("$89.00");
    expect(parsed.currency).toBe("USD");
    expect(parsed.expires).toBeDefined();
  });

  it("maps input correctly — sends trimmed name and uppercased country to the API", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    await handleCreateQuote(mockDeps, {
      ...VALID_MINIMAL_INPUT,
      name: "  Q2 Deal  ",
      recipientAddress: { country: "gb" },
    });

    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody.name).toBe("Q2 Deal");
    expect(postedBody.recipientAddress.country).toBe("GB");
  });

  it("sends tags as array of {key, value} objects to the API", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    await handleCreateQuote(mockDeps, {
      ...VALID_MINIMAL_INPUT,
      tags: [
        { key: "salesRep", value: "alice" },
        { key: "dealId", value: "crm-1234" },
      ],
    });

    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody.tags).toEqual([
      { key: "salesRep", value: "alice" },
      { key: "dealId", value: "crm-1234" },
    ]);
  });

  it("omits tags from request body when not provided", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody.tags).toBeUndefined();
  });

  it("omits optional fields from request body when not provided", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody.coupon).toBeUndefined();
    expect(postedBody.currency).toBeUndefined();
    expect(postedBody.expirationDateDays).toBeUndefined();
    expect(postedBody.fulfillmentTerm).toBeUndefined();
    expect(postedBody.notes).toBeUndefined();
    expect(postedBody.netTermsDays).toBeUndefined();
    expect(postedBody.taxId).toBeUndefined();
  });

  it("passes through all optional fields when provided", async () => {
    mockPost.mockResolvedValueOnce({ data: QUOTE_RESPONSE });

    await handleCreateQuote(mockDeps, {
      ...VALID_MINIMAL_INPUT,
      coupon: "SAVE20",
      currency: "GBP",
      expirationDateDays: 14,
      fulfillmentTerm: QuoteFulfillmentTerm.ON_PAYMENT,
      notes: "Pay within 14 days",
      netTermsDays: 14,
      taxId: "GB123456789",
    });

    const postedBody = mockPost.mock.calls[0][1];
    expect(postedBody.coupon).toBe("SAVE20");
    expect(postedBody.currency).toBe("GBP");
    expect(postedBody.expirationDateDays).toBe(14);
    expect(postedBody.fulfillmentTerm).toBe(QuoteFulfillmentTerm.ON_PAYMENT);
    expect(postedBody.notes).toBe("Pay within 14 days");
    expect(postedBody.netTermsDays).toBe(14);
    expect(postedBody.taxId).toBe("GB123456789");
  });

  describe("error handling", () => {
    it("returns an error content block on FastSpringError", async () => {
      mockPost.mockRejectedValueOnce(
        new FastSpringError("Product not found", 400)
      );

      const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Product not found");
    });

    it("returns an error content block on generic Error", async () => {
      mockPost.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ECONNREFUSED");
    });

    it("returns a safe error message on non-Error thrown value", async () => {
      mockPost.mockRejectedValueOnce("string error");

      const result = await handleCreateQuote(mockDeps, VALID_MINIMAL_INPUT);

      expect(result.isError).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe("quotesToolDefinitions", () => {
  it("exposes exactly one tool definition", () => {
    expect(quotesToolDefinitions).toHaveLength(1);
  });

  it("names the tool create_quote", () => {
    expect(quotesToolDefinitions[0].name).toBe("create_quote");
  });

  it("has a non-empty description", () => {
    expect(quotesToolDefinitions[0].description.length).toBeGreaterThan(10);
  });

  it("description explicitly mentions quotes and payment link", () => {
    const desc = quotesToolDefinitions[0].description.toLowerCase();
    expect(desc).toContain("quote");
    expect(desc).toContain("payment");
  });

  it("exposes a handler function", () => {
    expect(typeof quotesToolDefinitions[0].handler).toBe("function");
  });

  it("exposes an inputSchema", () => {
    expect(quotesToolDefinitions[0].inputSchema).toBeDefined();
  });
});
