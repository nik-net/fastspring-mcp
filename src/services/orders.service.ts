/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import type { AxiosInstance } from "axios";
import type {
  FastSpringOrder,
  FastSpringOrdersResponse,
  FastSpringTags,
  UpdateOrderTagsItem,
  UpdateOrderTagsRequest,
  UpdateOrderTagsResponse,
} from "../types/orders.types.js";
import type { LegacyOrder, LegacyOrderSearchResult } from "../types/legacy-orders.types.js";
import { Platform, type OrderLookupResult } from "../types/lookup-results.types.js";
import { FastSpringError } from "../utils/errors.js";
import { assertXmlResponse, parseLegacyOrderXml, parseLegacyOrdersSearchXml } from "../utils/xml-parser.js";

const ORDERS_PATH = "/orders";

function trim(s: string): string {
  return s.trim();
}

export interface OrdersServiceDeps {
  http: AxiosInstance;
  /**
   * FastSpring Classic API company ID for the primary (SBL) account (e.g. "example-company").
   * Required for reference-based order lookups via the Classic API.
   * Set via FS_COMPANY_ID environment variable.
   */
  companyId?: string;
  /**
   * HTTP client authenticated with legacy Classic platform credentials.
   * When set, Classic API calls that fail due to access denial or a 404
   * (indicating the order may belong to the legacy platform) are automatically
   * retried using this client.
   * Created from FS_LEGACY_API_USERNAME / FS_LEGACY_API_PASSWORD.
   */
  legacyHttp?: AxiosInstance;
  /**
   * Company ID for the legacy Classic platform.
   * Falls back to companyId when not set.
   * Set via FS_LEGACY_COMPANY_ID environment variable.
   */
  legacyCompanyId?: string;
}

/**
 * Unwrap response from GET /orders/{order_id}.
 * Per https://developer.fastspring.com/reference/retrieve-an-order the API may return
 * a single order or an object with an orders array when multiple IDs are specified.
 */
function unwrapOrderResponse(
  data: FastSpringOrder | FastSpringOrdersResponse
): FastSpringOrder {
  if (data && typeof data === "object" && "orders" in data && Array.isArray((data as FastSpringOrdersResponse).orders)) {
    const orders = (data as FastSpringOrdersResponse).orders;
    if (orders.length > 0) return orders[0];
  }
  return data as FastSpringOrder;
}

function isOrderNotFoundError(err: unknown): boolean {
  if (!(err instanceof FastSpringError)) return false;
  try {
    const body = err.responseBody as { orders?: Array<{ error?: { order?: string }; result?: string }> } | undefined;
    const first = body?.orders?.[0];
    return first?.error?.order === "Not found" || first?.result === "error";
  } catch {
    return false;
  }
}


/**
 * Fetch a single order by ID.
 * Tries GET /orders/{order_id} first; if API returns 400 "Not found", retries with
 * GET /orders?order={order_id} (query-param form supported by FastSpring for lookup).
 * https://developer.fastspring.com/reference/retrieve-an-order
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getOrder(
  deps: OrdersServiceDeps,
  orderId: string
): Promise<FastSpringOrder> {
  try {
    const id = trim(orderId);
    try {
      const response = await deps.http.get<FastSpringOrder | FastSpringOrdersResponse>(
        `${ORDERS_PATH}/${encodeURIComponent(id)}`
      );
      const data = unwrapOrderResponse(response.data);
      return data;
    } catch (pathErr) {
      if (!isOrderNotFoundError(pathErr)) throw pathErr;
      const queryResponse = await deps.http.get<FastSpringOrdersResponse>(ORDERS_PATH, {
        params: { order: id },
      });
      const orders = queryResponse.data?.orders ?? [];
      if (orders.length === 0) throw pathErr;
      const first = orders[0];
      if (first && typeof first === "object" && "error" in first) throw pathErr;
      return first as FastSpringOrder;
    }
  } catch (err) {
    throw err;
  }
}

/**
 * List orders for a customer email.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function findOrdersByEmail(
  deps: OrdersServiceDeps,
  email: string
): Promise<FastSpringOrder[]> {
  try {
    const response = await deps.http.get<FastSpringOrdersResponse>(ORDERS_PATH, {
      params: { email: trim(email) },
    });
    const orders = response.data?.orders ?? [];
    return orders;
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Classic API low-level request helpers
// ---------------------------------------------------------------------------

/**
 * Make a single GET /company/{companyId}/order/{reference} request with the
 * given HTTP client and return the parsed LegacyOrder.
 * Throws on any error (network, HTTP, XML parse, access denied).
 */
async function classicOrderRequest(
  http: AxiosInstance,
  companyId: string,
  reference: string
): Promise<LegacyOrder> {
  try {
    const path = `/company/${encodeURIComponent(companyId)}/order/${encodeURIComponent(reference)}`;
    const response = await http.get<string>(path, { responseType: "text" });
    assertXmlResponse(response.data);
    const order = parseLegacyOrderXml(response.data);
    return order;
  } catch (err) {
    throw err;
  }
}

/**
 * Make a single GET /company/{companyId}/orders/search?query={reference} request
 * and return parsed results.
 */
async function classicSearchRequest(
  http: AxiosInstance,
  companyId: string,
  reference: string
): Promise<LegacyOrderSearchResult[]> {
  try {
    const path = `/company/${encodeURIComponent(companyId)}/orders/search`;
    const response = await http.get<string>(path, {
      params: { query: reference },
      responseType: "text",
    });
    assertXmlResponse(response.data);
    const results = parseLegacyOrdersSearchXml(response.data);
    return results;
  } catch (err) {
    throw err;
  }
}

/**
 * Returns true when an error from the Classic API should trigger a retry with
 * legacy credentials:
 *
 * - HTTP 401/403 — explicit auth denial
 * - XML parse failure — Classic API returned a non-XML body such as
 *   "Access denied to site." (HTTP 200 with plain-text body)
 * - HTTP 404 — order not found on the primary (SBL) platform; it may exist
 *   on the legacy Classic platform under different credentials
 */
function shouldRetryWithLegacyCredentials(err: unknown): boolean {
  if (err instanceof FastSpringError) {
    return err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404;
  }
  if (err instanceof Error) {
    // Non-XML body (e.g. "Access denied to site.") — detected by assertXmlResponse
    if (err.message.includes("Classic API returned a non-XML response")) return true;
    // XML parsed successfully but root element was wrong (e.g. response wrapped differently)
    if (err.message.includes("Legacy API response missing")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classic API facade — with automatic legacy-credential fallback
// ---------------------------------------------------------------------------

/**
 * Fetch a single order by reference using the FastSpring Classic (legacy) API.
 *
 * Uses GET /company/{companyId}/order/{reference} which returns the full order
 * as XML, including customer, address, line items, payments, tax, shipping,
 * referrer, origin IP, and all other fields the Classic API exposes.
 *
 * When legacy credentials are configured (FS_LEGACY_API_USERNAME), the call
 * is automatically retried with those credentials if the primary credentials
 * are denied or the order is not found on the primary platform.
 *
 * Classic API docs: https://github.com/fastspring/fastspring-api/blob/master/sections/orders.mdown
 *
 * @throws Error if companyId is not configured
 * @throws FastSpringError on 4xx/5xx or network error
 */
async function getOrderByReferenceLegacyApi(
  deps: OrdersServiceDeps,
  reference: string
): Promise<LegacyOrder> {
  try {
    if (!deps.companyId) {
      throw new Error(
        "FS_COMPANY_ID is not configured. Set it in your .env file to enable order reference lookups via the FastSpring Classic API."
      );
    }

    try {
      const order = await classicOrderRequest(deps.http, deps.companyId, reference);
      return order;
    } catch (primaryErr) {
      if (!shouldRetryWithLegacyCredentials(primaryErr) || !deps.legacyHttp) {
        throw primaryErr;
      }
      // Retry with legacy credentials; use legacyCompanyId if configured,
      // otherwise fall back to the primary companyId.
      const legacyCompanyId = deps.legacyCompanyId ?? deps.companyId;
      const order = await classicOrderRequest(deps.legacyHttp, legacyCompanyId, reference);
      return order;
    }
  } catch (err) {
    throw err;
  }
}

/**
 * Search orders by reference using the FastSpring Classic (legacy) API.
 *
 * Uses GET /company/{companyId}/orders/search?query={reference} which performs
 * a server-side search and returns abbreviated order summaries as XML.
 * Each result contains: reference, status, statusChanged, test, returnStatus,
 * and customer (name, email, company). Full order details are not included.
 *
 * When legacy credentials are configured, the search is automatically retried
 * with those credentials if the primary credentials are denied.
 *
 * Classic API docs: https://github.com/fastspring/fastspring-api/blob/master/sections/orders.mdown
 *
 * @throws Error if companyId is not configured
 * @throws FastSpringError on 4xx/5xx or network error
 */
async function searchOrdersByReferenceLegacyApi(
  deps: OrdersServiceDeps,
  reference: string
): Promise<LegacyOrderSearchResult[]> {
  try {
    if (!deps.companyId) {
      throw new Error(
        "FS_COMPANY_ID is not configured. Set it in your .env file to enable order reference lookups via the FastSpring Classic API."
      );
    }

    try {
      const results = await classicSearchRequest(deps.http, deps.companyId, reference);
      return results;
    } catch (primaryErr) {
      if (!shouldRetryWithLegacyCredentials(primaryErr) || !deps.legacyHttp) {
        throw primaryErr;
      }
      const legacyCompanyId = deps.legacyCompanyId ?? deps.companyId;
      const results = await classicSearchRequest(deps.legacyHttp, legacyCompanyId, reference);
      return results;
    }
  } catch (err) {
    throw err;
  }
}

/**
 * Find orders by reference string (e.g. VI0000000-0000-00000).
 *
 * Uses the FastSpring Classic API's server-side search endpoint
 * (GET /company/{companyId}/orders/search?query={reference}).
 * Returns abbreviated order summaries (reference, status, customer).
 * For full order details, use getOrderByReference instead.
 *
 * @throws FastSpringError on 4xx/5xx or network error
 * @throws Error if FS_COMPANY_ID is not set
 */
export async function findOrdersByReference(
  deps: OrdersServiceDeps,
  reference: string
): Promise<LegacyOrderSearchResult[]> {
  try {
    const ref = trim(reference);
    const results = await searchOrdersByReferenceLegacyApi(deps, ref);
    return results;
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch a single order by reference. Returns the full order or null if not found.
 *
 * Uses the FastSpring Classic API's direct lookup endpoint
 * (GET /company/{companyId}/order/{reference}), which returns the complete order
 * including customer, address, line items, payments, tax, shipping, referrer,
 * and origin IP.
 *
 * Falls back to the search endpoint when the direct lookup returns a 404.
 * In that case the returned object will have abbreviated fields (no address,
 * payments, or items) since the search endpoint does not include them.
 *
 * @throws FastSpringError on 4xx/5xx (other than 404) or network error
 * @throws Error if FS_COMPANY_ID is not set
 */
export async function getOrderByReference(
  deps: OrdersServiceDeps,
  reference: string
): Promise<LegacyOrder | null> {
  try {
    const ref = trim(reference);

    try {
      const order = await getOrderByReferenceLegacyApi(deps, ref);
      return order;
    } catch (directErr) {
      if (
        directErr instanceof FastSpringError &&
        directErr.statusCode === 404
      ) {
        // Classic API search returns LegacyOrderSearchResult which is structurally
        // a valid (partial) LegacyOrder — same required fields, fewer optional ones.
        const matches = await searchOrdersByReferenceLegacyApi(deps, ref);
        return matches.length > 0 ? (matches[0] as LegacyOrder) : null;
      }
      throw directErr;
    }
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Unified lookup — transparently tries SBL then Classic
// ---------------------------------------------------------------------------

/**
 * Unified order lookup by any identifier (SBL internal order ID or Classic
 * order reference such as VI0000000-0000-00000).
 *
 * Resolution order:
 *   1. SBL  GET /orders/{identifier}               — by SBL internal order ID
 *   2. Classic GET /company/{co}/order/{identifier} — by Classic reference (with
 *      automatic legacy-credential fallback and search fallback when configured)
 *
 * Returns an OrderLookupResult annotated with the platform that found it,
 * or null when the identifier is not found on either platform.
 *
 * Auth errors (401/403) and network errors are always propagated to the caller.
 *
 * @throws FastSpringError on auth failures or unexpected API errors
 * @throws Error on network failures
 * @throws Error if neither companyId nor SBL auth is configured
 */
export async function lookupOrder(
  deps: OrdersServiceDeps,
  identifier: string
): Promise<OrderLookupResult | null> {
  try {
    const id = trim(identifier);

    // Step 1 — SBL by internal order ID
    try {
      const order = await getOrder(deps, id);
      // Guard against SBL returning HTTP 200 with an error body for an unknown ID.
      // A real SBL order always has an "id" field; an error body does not.
      const isValidOrder = order && typeof order === "object" && "id" in order &&
        typeof (order as { id: unknown }).id === "string";
      if (isValidOrder) {
        return { platform: Platform.SBL, data: order };
      }
      // Fall through to Classic when SBL returns an error body as HTTP 200.
    } catch (err) {
      if (!(err instanceof FastSpringError)) throw err;
      // Surface auth failures immediately; fall through for all other HTTP errors
      // (e.g. SBL 400 "Not found" for a Classic reference string).
      if (err.statusCode === 401 || err.statusCode === 403) throw err;
    }

    // Step 2 — Classic API (direct + search fallback + dual-credential fallback
    //           are all handled internally by getOrderByReference).
    if (deps.companyId) {
      const classicOrder = await getOrderByReference(deps, id);
      if (classicOrder !== null) {
        // Step 3 — SBL cross-check by customer email.
        //
        // Modern FastSpring accounts use VI-format references on BOTH platforms.
        // The SBL REST API does not support direct lookup by VI reference on the
        // path or via ?order=, so Step 1 always falls through to Classic for
        // VI references.  However the same order may exist on SBL with an
        // additional "id" field.  We detect this by searching SBL orders for the
        // customer's email and matching on the VI reference.  If a match is found
        // we return the richer SBL record; otherwise we return the Classic result.
        if (classicOrder.customer?.email) {
          try {
            const sblOrders = await findOrdersByEmail(deps, classicOrder.customer.email);
            const sblMatch = sblOrders.find(
              (o) => o.reference === classicOrder.reference
            );
            if (sblMatch && typeof sblMatch.id === "string") {
              return { platform: Platform.SBL, data: sblMatch };
            }
          } catch {
            // SBL cross-check is best-effort — fall through to Classic result.
          }
        }
        return { platform: Platform.CLASSIC, data: classicOrder };
      }
    }

    return null;
  } catch (err) {
    throw err;
  }
}

/**
 * Update tags and/or per-product attributes on a FastSpring order.
 *
 * Uses POST /orders with a single-element orders array.  Tags replace the
 * existing set on the order; attributes replace the existing set on the
 * specified product line item(s).  Active subscriptions that were created by
 * this order automatically inherit the updated attributes.
 *
 * API docs: https://developer.fastspring.com/reference/update-order-tags-and-attributes
 *
 * @param orderId  The FastSpring internal order ID (e.g. "VER1234567890-XXXX-XXXXX").
 * @param tags     Key-value pairs to set as order-level tags.
 * @param items    Optional per-product attribute updates.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function updateOrderTags(
  deps: OrdersServiceDeps,
  orderId: string,
  tags?: FastSpringTags,
  items?: UpdateOrderTagsItem[]
): Promise<UpdateOrderTagsResponse> {
  try {
    const id = trim(orderId);

    const orderEntry: UpdateOrderTagsRequest["orders"][0] = { order: id };
    if (tags !== undefined) {
      orderEntry.tags = tags;
    }
    if (items !== undefined && items.length > 0) {
      orderEntry.items = items;
    }

    const body: UpdateOrderTagsRequest = { orders: [orderEntry] };

    const response = await deps.http.post<UpdateOrderTagsResponse>(ORDERS_PATH, body);
    const result = response.data;
    return result;
  } catch (err) {
    throw err;
  }
}
