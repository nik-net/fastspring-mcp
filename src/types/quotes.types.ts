/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * FastSpring Quotes API types.
 * Aligned with POST https://api.fastspring.com/quotes
 * https://developer.fastspring.com/reference/create-a-quote
 */

/** When the quote is considered fulfilled. */
export enum QuoteFulfillmentTerm {
  /** Fulfilled as soon as payment is received. Use this for normal orders. */
  ON_PAYMENT = "ON_PAYMENT",
  /** Fulfilled when the buyer accepts the quote document (before payment). */
  ON_QUOTE_ACCEPTANCE = "ON_QUOTE_ACCEPTANCE",
}

/** Possible statuses a quote can be in. */
export enum QuoteStatus {
  OPEN = "OPEN",
  CANCELED = "CANCELED",
  AWAITING_PAYMENT = "AWAITING_PAYMENT",
  COMPLETED = "COMPLETED",
  EXPIRED = "EXPIRED",
}

/** A single line item on the quote request. */
export interface QuoteRequestItem {
  /** Product path as configured in the FastSpring catalog (e.g. "my-annual-subscription"). */
  product: string;
  /** Number of units. Defaults to 1 when omitted. */
  quantity?: number;
  /**
   * Override the catalogue list price per unit in the quote's base currency.
   * When omitted, the catalogue price is used.
   */
  unitListPrice?: number;
}

/** Recipient (buyer) contact information. */
export interface QuoteRecipient {
  /** Buyer's first name (required). */
  first: string;
  /** Buyer's last name (required). */
  last: string;
  /** Buyer's email address (required). */
  email: string;
  /** Buyer's company name (optional). */
  company?: string;
  /** Buyer's phone number (optional). */
  phone?: string;
}

/** Billing address for the quote recipient. */
export interface QuoteRecipientAddress {
  /** ISO 3166-1 alpha-2 country code, e.g. GB, US, DE (required). */
  country: string;
  /** Postal or ZIP code. May be empty string when not applicable. */
  postalCode?: string;
  /** First address line (optional). */
  addressLine1?: string;
  /** Second address line (optional). */
  addressLine2?: string;
  /** City (optional). */
  city?: string;
  /** State, province, or region (optional). */
  region?: string;
}

/** A tag attached to a quote. Tags use an array of key-value objects (unlike orders which use a flat map). */
export interface QuoteTag {
  key: string;
  value: string;
}

/**
 * Request body for POST /quotes.
 * Required: items, name, recipient, recipientAddress.
 */
export interface CreateQuoteRequest {
  /** One or more products to include in the quote (required, min 1). */
  items: QuoteRequestItem[];
  /** Internal name / label for the quote — visible in the FastSpring dashboard (required). */
  name: string;
  /** Buyer contact information (required). */
  recipient: QuoteRecipient;
  /** Buyer billing address (required). country and postalCode are required by the API. */
  recipientAddress: QuoteRecipientAddress;
  /** Optional coupon code to apply to the quote. */
  coupon?: string;
  /** 3-letter ISO currency code (e.g. USD, GBP, EUR). Defaults to store currency when omitted. */
  currency?: string;
  /** Number of days before the quote expires (1–90). Defaults to 30. */
  expirationDateDays?: number;
  /** When the quote is considered fulfilled. Defaults to ON_PAYMENT. */
  fulfillmentTerm?: QuoteFulfillmentTerm;
  /** Optional notes shown on the quote document (max 5000 chars). */
  notes?: string;
  /** Net payment terms in days (e.g. 30 = Net 30). */
  netTermsDays?: number;
  /** Tags to attach to the quote. Array of {key, value} objects. */
  tags?: QuoteTag[];
  /** Buyer's VAT/tax ID (e.g. "GB123456789"). */
  taxId?: string;
}

/** Summary of a line item in the quote response. */
export interface QuoteResponseItem {
  product: string;
  display?: string;
  quantity: number;
  unitListPrice?: number;
  unitListPriceDisplay?: string;
  unitPrice?: number;
  unitPriceDisplay?: string;
  period?: string | null;
  subscription?: boolean;
  taxes?: Array<{ taxValue: number; totalTaxable: number }>;
}

/**
 * Response from POST /quotes.
 * The key field for callers is `quoteUrl` — the shareable payment link.
 */
export interface CreateQuoteResponse {
  /** Unique quote identifier. */
  id: string;
  /**
   * The shareable URL to send to the buyer.
   * The buyer opens this link, reviews the quote with full line items and tax
   * breakdown, then pays on the FastSpring store.
   */
  quoteUrl: string;
  /** Current quote status. Will be OPEN on successful creation. */
  status: QuoteStatus;
  /** Quote name as set in the request. */
  name: string;
  /** Currency code used in the quote. */
  currency?: string;
  /** Subtotal before tax. */
  subtotal?: number;
  /** Formatted subtotal (e.g. "$89.00"). */
  subtotalDisplay?: string;
  /** Total tax amount. */
  tax?: number;
  /** Tax rate as a percentage (e.g. 20.0 for 20%). */
  taxRate?: number;
  /** Tax type (e.g. VAT, TAX). */
  taxType?: string;
  /** Total including tax. */
  total?: number;
  /** Formatted total (e.g. "$106.80"). */
  totalDisplay?: string;
  /** ISO datetime string when the quote expires. */
  expires?: string;
  /** ISO datetime string when the quote was created. */
  created?: string;
  /** Recipient information echoed back from the request. */
  recipient?: QuoteRecipient & { userId?: string | null };
  /** Recipient address echoed back from the request. */
  recipientAddress?: QuoteRecipientAddress;
  /** Line items with full pricing detail. */
  items?: QuoteResponseItem[];
  /** Tags attached to the quote. */
  tags?: QuoteTag[];
  /** Net terms days. */
  netTermsDays?: number;
  /** Order reference once the quote is paid and becomes an order. null until paid. */
  orderReference?: string | null;
  /** Fulfillment term used for this quote. */
  fulfillmentTerm?: QuoteFulfillmentTerm;
}
