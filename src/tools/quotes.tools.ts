/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { z } from "zod";
import * as quotesService from "../services/quotes.service.js";
import type { QuotesServiceDeps } from "../services/quotes.service.js";
import { FastSpringError } from "../utils/errors.js";
import { QuoteFulfillmentTerm } from "../types/quotes.types.js";
import type {
  CreateQuoteRequest,
  QuoteRequestItem,
  QuoteRecipient,
  QuoteRecipientAddress,
  QuoteTag,
} from "../types/quotes.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trimString = (s: string) => s.trim();
const toUpper = (s: string) => s.toUpperCase();

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const QuoteItemSchema = z
  .object({
    product: z
      .string()
      .min(1, "product path is required")
      .transform(trimString)
      .describe(
        "FastSpring product path (SKU) as configured in the catalog, e.g. " +
          '"my-annual-subscription". Must already exist in FastSpring.'
      ),
    quantity: z
      .number()
      .int()
      .min(1, "quantity must be at least 1")
      .optional()
      .describe(
        "Number of units to include in the quote. Defaults to 1 when omitted."
      ),
    unitListPrice: z
      .number()
      .min(0, "unitListPrice must be non-negative")
      .optional()
      .describe(
        "Override the catalog list price per unit in the quote's base currency. " +
          "When omitted the current catalog price is used."
      ),
  })
  .describe("A single product line item to include in the quote.");

const QuoteRecipientSchema = z
  .object({
    first: z
      .string()
      .min(1, "recipient first name is required")
      .max(255)
      .transform(trimString)
      .describe("Buyer's first name."),
    last: z
      .string()
      .min(1, "recipient last name is required")
      .max(255)
      .transform(trimString)
      .describe("Buyer's last name."),
    email: z
      .preprocess(
        (val) => (typeof val === "string" ? val.trim() : val),
        z.string().email()
      )
      .describe("Buyer's email address. Must be a valid email."),
    company: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("Buyer's company name (optional)."),
    phone: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("Buyer's phone number in any format (optional)."),
  })
  .describe("Buyer contact information.");

const QuoteRecipientAddressSchema = z
  .object({
    country: z
      .string()
      .length(2, "country must be a 2-letter ISO 3166-1 alpha-2 code")
      .transform(toUpper)
      .describe(
        "2-letter ISO 3166-1 alpha-2 country code, e.g. GB, US, DE. Required."
      ),
    postalCode: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe(
        "Postal or ZIP code. Optional — omit or leave empty when not applicable."
      ),
    addressLine1: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("First line of the street address (optional)."),
    addressLine2: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("Second line of the street address (optional)."),
    city: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("City or municipality (optional)."),
    region: z
      .string()
      .max(255)
      .transform(trimString)
      .optional()
      .describe("State, province, or region (optional)."),
  })
  .describe("Billing address for the quote recipient.");

const QuoteTagSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .transform(trimString)
      .describe("Tag key/name."),
    value: z
      .string()
      .transform(trimString)
      .describe("Tag value."),
  })
  .describe(
    "A key-value tag. Note: quotes use an array of tag objects (not a flat map)."
  );

/**
 * Input schema for the create_quote MCP tool.
 *
 * Only `name`, `items`, `recipient`, and `recipientAddress` (with `country`) are
 * required. Everything else is optional.
 */
export const CreateQuoteSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(255)
    .transform(trimString)
    .describe(
      "Internal label for this quote — shown in the FastSpring dashboard and " +
        "on the quote document sent to the buyer. Required."
    ),

  items: z
    .array(QuoteItemSchema)
    .min(1, "at least one item is required")
    .describe(
      "One or more products to include in the quote. " +
        "Each item must reference a valid FastSpring product SKU. Required."
    ),

  recipient: QuoteRecipientSchema.describe(
    "Buyer contact details. first, last, and email are required."
  ),

  recipientAddress: QuoteRecipientAddressSchema.describe(
    "Billing address for the buyer. country (2-letter ISO code) is required."
  ),

  // ---  Optional fields  ---

  coupon: z
    .string()
    .max(255)
    .transform(trimString)
    .optional()
    .describe("Coupon code to apply to the quote (optional), e.g. SAVE20."),

  currency: z
    .string()
    .length(3, "currency must be a 3-letter ISO 4217 code")
    .transform(toUpper)
    .optional()
    .describe(
      "3-letter ISO 4217 currency code (e.g. USD, GBP, EUR). " +
        "Defaults to the store's base currency when omitted."
    ),

  expirationDateDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe(
      "Number of days until the quote expires (1–90). Defaults to 30 when omitted. " +
        "After expiry the quoteUrl is no longer accessible."
    ),

  fulfillmentTerm: z
    .nativeEnum(QuoteFulfillmentTerm)
    .optional()
    .describe(
      "When the quote is considered fulfilled. " +
        "ON_PAYMENT (default): fulfilled when payment is received. " +
        "ON_QUOTE_ACCEPTANCE: fulfilled when the buyer accepts the document before payment."
    ),

  notes: z
    .string()
    .max(5000)
    .transform(trimString)
    .optional()
    .describe(
      "Optional notes displayed on the quote document (max 5000 characters)."
    ),

  netTermsDays: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Net payment terms in days (e.g. 30 for Net 30). Optional."),

  tags: z
    .array(QuoteTagSchema)
    .optional()
    .describe(
      "Array of {key, value} tag objects to attach to the quote. " +
        "Useful for tracking source, sales rep, CRM deal ID, etc."
    ),

  taxId: z
    .string()
    .max(255)
    .transform(trimString)
    .optional()
    .describe(
      "Buyer's VAT or tax registration number (e.g. GB123456789). " +
        "Shown on the quote/invoice and may affect tax calculation."
    ),
});

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export type QuotesToolsDeps = QuotesServiceDeps;

// ---------------------------------------------------------------------------
// Request mapper
// ---------------------------------------------------------------------------

/**
 * Maps validated Zod-parsed input to the FastSpring API request shape.
 * Only includes optional fields when they are actually present, so we
 * never send `undefined` keys to the API.
 */
function mapInputToRequest(input: CreateQuoteInput): CreateQuoteRequest {
  const request: CreateQuoteRequest = {
    name: input.name,
    items: input.items as QuoteRequestItem[],
    recipient: input.recipient as QuoteRecipient,
    recipientAddress: input.recipientAddress as QuoteRecipientAddress,
  };

  if (input.coupon !== undefined) request.coupon = input.coupon;
  if (input.currency !== undefined) request.currency = input.currency;
  if (input.expirationDateDays !== undefined)
    request.expirationDateDays = input.expirationDateDays;
  if (input.fulfillmentTerm !== undefined)
    request.fulfillmentTerm = input.fulfillmentTerm;
  if (input.notes !== undefined) request.notes = input.notes;
  if (input.netTermsDays !== undefined)
    request.netTermsDays = input.netTermsDays;
  if (input.tags !== undefined) request.tags = input.tags as QuoteTag[];
  if (input.taxId !== undefined) request.taxId = input.taxId;

  return request;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles a create_quote tool call.
 * Returns a JSON content block containing the key fields the caller needs:
 * primarily `quoteUrl` (the shareable payment link) and `quoteId`.
 */
export async function handleCreateQuote(
  deps: QuotesToolsDeps,
  input: unknown
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const parsed = CreateQuoteSchema.parse(input);
    const request = mapInputToRequest(parsed);

    const quote = await quotesService.createQuote(deps, request);

    const responsePayload = {
      quoteId: quote.id,
      quoteUrl: quote.quoteUrl,
      status: quote.status,
      name: quote.name,
      currency: quote.currency,
      subtotal: quote.subtotal,
      subtotalDisplay: quote.subtotalDisplay,
      tax: quote.tax,
      taxRate: quote.taxRate,
      taxType: quote.taxType,
      total: quote.total,
      totalDisplay: quote.totalDisplay,
      expires: quote.expires,
      created: quote.created,
      recipient: quote.recipient,
      recipientAddress: quote.recipientAddress,
      items: quote.items,
      tags: quote.tags,
      orderReference: quote.orderReference,
      fulfillmentTerm: quote.fulfillmentTerm,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof FastSpringError
        ? `FastSpring API error (${error.statusCode}): ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const quotesToolDefinitions = [
  {
    name: "create_quote",
    description:
      "Use this tool to create a new quote (formal order document) for one or more " +
      "FastSpring subscription or product SKUs on behalf of a buyer. " +
      "\n\n" +
      "A quote is the correct way to programmatically generate a Custom Order in " +
      "FastSpring — it is NOT a checkout session and does NOT charge the buyer. " +
      "\n\n" +
      "On success the tool returns a `quoteUrl` — a permanent payment link you can " +
      "send to the buyer. The buyer opens the link, sees a full B2B quote document " +
      "with line items, VAT/tax breakdown, and pricing, then pays on the FastSpring " +
      "storefront at their convenience. The quote appears immediately in the " +
      "FastSpring dashboard under Quotes and remains open until paid, cancelled, or " +
      "expired (default 30 days, maximum 90 days). " +
      "\n\n" +
      "Required inputs: quote name, at least one product SKU, buyer first name, " +
      "last name, email, and billing country (2-letter ISO code). " +
      "\n\n" +
      "Optional: quantity and price overrides per item, coupon code, currency, " +
      "expiration days (1–90), fulfilment term, notes, net-terms days, tags " +
      "(array of {key, value} objects), and buyer VAT/tax ID.",
    description_for_model:
      "Creates a FastSpring quote. Returns quoteUrl (permanent payment link to share " +
      "with buyer), quoteId, status (OPEN), and full pricing summary. The buyer pays " +
      "via the link — no payment is taken by this call.",
    inputSchema: CreateQuoteSchema,
    handler: handleCreateQuote,
  },
] as const;
