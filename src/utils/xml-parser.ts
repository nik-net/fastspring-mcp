/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { XMLParser } from "fast-xml-parser";
import type {
  LegacyOrder,
  LegacyOrderSearchResult,
  LegacyOrderItem,
  LegacyOrderPayment,
  LegacyOrderCustomer,
  LegacyOrderAddress,
} from "../types/legacy-orders.types.js";
import type { LegacySubscription, LegacySubscriptionCustomer } from "../types/legacy-subscriptions.types.js";

/**
 * Shared XMLParser instance configured for FastSpring Classic API responses.
 * - ignoreAttributes: false keeps all attributes (though the API has none)
 * - parseTagValue: true converts numbers/booleans from strings automatically
 * - numberParseOptions.skipLike: prevents phone-number-like values (e.g. +1234567890)
 *   from being incorrectly coerced to numeric types
 * - isArray: ensures single-item collections are always arrays
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  numberParseOptions: {
    hex: false,
    leadingZeros: false,
    skipLike: /^\+\d+/,
  },
  isArray: (tagName) =>
    tagName === "orderItem" || tagName === "payment" || tagName === "order",
});

/**
 * Normalise a raw orderItems node from the XML parser into a flat array.
 * The parser returns `{ orderItem: [...] }` for the <orderItems> wrapper.
 */
function extractOrderItems(raw: unknown): LegacyOrderItem[] {
  try {
    if (!raw || typeof raw !== "object") return [];
    const wrapper = raw as Record<string, unknown>;
    const items = wrapper["orderItem"];
    if (!Array.isArray(items)) return [];
    return items as LegacyOrderItem[];
  } catch {
    return [];
  }
}

/**
 * Normalise a raw payments node from the XML parser into a flat array.
 */
function extractPayments(raw: unknown): LegacyOrderPayment[] {
  try {
    if (!raw || typeof raw !== "object") return [];
    const wrapper = raw as Record<string, unknown>;
    const payments = wrapper["payment"];
    if (!Array.isArray(payments)) return [];
    return payments as LegacyOrderPayment[];
  } catch {
    return [];
  }
}

/**
 * Parse the XML response from GET /company/{company}/order/{reference}.
 * Returns the parsed LegacyOrder or throws on malformed input.
 *
 * @throws Error if the XML is missing the expected <order> root element
 */
export function parseLegacyOrderXml(xml: string): LegacyOrder {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const parsedOrder = parsed["order"];

    // When the XMLParser's isArray config includes "order", a root <order> element
    // is wrapped in an array. Unwrap it to get the single order object.
    const raw = Array.isArray(parsedOrder) ? parsedOrder[0] : parsedOrder;

    if (!raw || typeof raw !== "object") {
      throw new Error("Legacy API response missing <order> root element");
    }

    const r = raw as Record<string, unknown>;
    const order: LegacyOrder = {
      reference: String(r["reference"] ?? ""),
      status: String(r["status"] ?? ""),
      ...(r["statusChanged"] != null ? { statusChanged: String(r["statusChanged"]) } : {}),
      ...(r["test"] != null ? { test: Boolean(r["test"]) } : {}),
      ...(r["due"] != null ? { due: String(r["due"]) } : {}),
      ...(r["returnStatus"] != null ? { returnStatus: String(r["returnStatus"]) } : {}),
      ...(r["currency"] != null ? { currency: String(r["currency"]) } : {}),
      ...(r["referrer"] != null ? { referrer: String(r["referrer"]) } : {}),
      ...(r["originIp"] != null ? { originIp: String(r["originIp"]) } : {}),
      ...(r["total"] != null ? { total: Number(r["total"]) } : {}),
      ...(r["tax"] != null ? { tax: Number(r["tax"]) } : {}),
      ...(r["shipping"] != null ? { shipping: Number(r["shipping"]) } : {}),
      ...(r["sourceName"] != null ? { sourceName: String(r["sourceName"]) } : {}),
      ...(r["sourceKey"] != null ? { sourceKey: String(r["sourceKey"]) } : {}),
      ...(r["sourceCampaign"] != null ? { sourceCampaign: String(r["sourceCampaign"]) } : {}),
      ...(r["customer"] != null ? { customer: r["customer"] as LegacyOrderCustomer } : {}),
      ...(r["purchaser"] != null ? { purchaser: r["purchaser"] as LegacyOrderCustomer } : {}),
      ...(r["address"] != null ? { address: r["address"] as LegacyOrderAddress } : {}),
      orderItems: extractOrderItems(r["orderItems"]),
      payments: extractPayments(r["payments"]),
    };

    return order;
  } catch (err) {
    throw err;
  }
}

/**
 * Guard against the Classic API returning a plain-text access-denial body
 * (e.g. "Access denied to site.", "Access Denied", "Password is required.")
 * with HTTP 200.  The XML parsers would silently return empty results for
 * these bodies; detecting them here and throwing allows retry logic to activate.
 *
 * @throws Error if the response text is not XML (does not start with `<` or `<?`)
 */
export function assertXmlResponse(text: string): void {
  const trimmed = text.trimStart();
  // A valid XML response must start with `<` and must NOT be an HTML DOCTYPE declaration.
  // Plain-text bodies like "Access denied to site." or HTML error pages are not XML.
  const isXml =
    trimmed.startsWith("<") && !trimmed.toUpperCase().startsWith("<!DOCTYPE");
  if (!isXml) {
    throw new Error(
      `Classic API returned a non-XML response (access denied or misconfigured): ${text.slice(0, 80)}`
    );
  }
}

/**
 * Parse the XML response from GET /company/{company}/orders/search?query=...
 * Returns an array of abbreviated order summaries.
 *
 * @throws Error if the XML is malformed
 */
export function parseLegacyOrdersSearchXml(xml: string): LegacyOrderSearchResult[] {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const wrapper = parsed["orders"];

    if (!wrapper || typeof wrapper !== "object") {
      return [];
    }

    const w = wrapper as Record<string, unknown>;
    const orders = w["order"];
    if (!Array.isArray(orders)) return [];

    return orders.map((o: unknown) => {
      const r = o as Record<string, unknown>;
      const result: LegacyOrderSearchResult = {
        reference: String(r["reference"] ?? ""),
        status: String(r["status"] ?? ""),
        ...(r["statusChanged"] != null ? { statusChanged: String(r["statusChanged"]) } : {}),
        ...(r["test"] != null ? { test: Boolean(r["test"]) } : {}),
        ...(r["returnStatus"] != null ? { returnStatus: String(r["returnStatus"]) } : {}),
        ...(r["customer"] != null ? { customer: r["customer"] as LegacyOrderCustomer } : {}),
      };
      return result;
    });
  } catch (err) {
    throw err;
  }
}

/**
 * Parse the XML response from GET /company/{company}/subscription/{reference}.
 * Returns the parsed LegacySubscription or throws on malformed input.
 *
 * The Classic API returns a single <subscription> root element (not a collection),
 * so no isArray unwrapping is needed here.
 *
 * @throws Error if the XML is missing the expected <subscription> root element
 */
export function parseLegacySubscriptionXml(xml: string): LegacySubscription {
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const raw = parsed["subscription"];

    if (!raw || typeof raw !== "object") {
      throw new Error("Legacy API response missing <subscription> root element");
    }

    const r = raw as Record<string, unknown>;
    const subscription: LegacySubscription = {
      reference: String(r["reference"] ?? ""),
      status: String(r["status"] ?? ""),
      ...(r["statusChanged"] != null ? { statusChanged: String(r["statusChanged"]) } : {}),
      ...(r["statusReason"] != null ? { statusReason: String(r["statusReason"]) } : {}),
      ...(r["cancelable"] != null ? { cancelable: Boolean(r["cancelable"]) } : {}),
      ...(r["test"] != null ? { test: Boolean(r["test"]) } : {}),
      ...(r["referrer"] != null ? { referrer: String(r["referrer"]) } : {}),
      ...(r["sourceName"] != null ? { sourceName: String(r["sourceName"]) } : {}),
      ...(r["sourceKey"] != null ? { sourceKey: String(r["sourceKey"]) } : {}),
      ...(r["sourceCampaign"] != null ? { sourceCampaign: String(r["sourceCampaign"]) } : {}),
      ...(r["customer"] != null ? { customer: r["customer"] as LegacySubscriptionCustomer } : {}),
      ...(r["customerUrl"] != null ? { customerUrl: String(r["customerUrl"]) } : {}),
      ...(r["productName"] != null ? { productName: String(r["productName"]) } : {}),
      ...(r["tags"] != null ? { tags: String(r["tags"]) } : {}),
      ...(r["quantity"] != null ? { quantity: Number(r["quantity"]) } : {}),
      ...(r["coupon"] != null ? { coupon: String(r["coupon"]) } : {}),
      ...(r["nextPeriodDate"] != null ? { nextPeriodDate: String(r["nextPeriodDate"]) } : {}),
      ...(r["end"] != null ? { end: String(r["end"]) } : {}),
    };

    return subscription;
  } catch (err) {
    throw err;
  }
}
