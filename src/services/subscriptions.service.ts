/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import type { AxiosInstance } from "axios";
import type {
  FastSpringSubscription,
  FastSpringSubscriptionsResponse,
  UpdateSubscriptionTagsRequest,
  UpdateSubscriptionTagsResponse,
} from "../types/subscriptions.types.js";
import type { LegacySubscription } from "../types/legacy-subscriptions.types.js";
import { Platform, type SubscriptionLookupResult } from "../types/lookup-results.types.js";
import { FastSpringError } from "../utils/errors.js";
import { assertXmlResponse, parseLegacySubscriptionXml } from "../utils/xml-parser.js";

const SUBSCRIPTIONS_PATH = "/subscriptions";

function trim(s: string): string {
  return s.trim();
}

export interface SubscriptionsServiceDeps {
  http: AxiosInstance;
  /**
   * FastSpring Classic API company ID for the primary (SBL) account (e.g. "example-company").
   * Required for reference-based subscription lookups via the Classic API.
   * Set via FS_COMPANY_ID environment variable.
   */
  companyId?: string;
  /**
   * HTTP client authenticated with legacy Classic platform credentials.
   * When set, Classic API calls that fail due to access denial or a 404 are
   * automatically retried using this client.
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

export interface ListSubscriptionsFilters {
  status?: string;
  product?: string;
  email?: string;
}

/**
 * Unwrap SBL subscription from GET /subscriptions or GET /subscriptions/{id} response.
 *
 * Documented behavior (Developer API, https://developer.fastspring.com/reference/subscriptions):
 * - Retrieve one: GET /subscriptions/{id} returns JSON — the subscription resource (object with id, status, customer, etc.).
 * - List: GET /subscriptions returns JSON — { subscriptions: FastSpringSubscription[] }.
 *
 * We accept: (1) subscription object at top level, (2) { subscription: <object> }, (3) { subscriptions: [ ... ] }.
 * If the body is a string (e.g. XML from Classic endpoint), we throw so the caller can try the next lookup step.
 */
function unwrapSubscription(
  data:
    | FastSpringSubscription
    | string
    | { subscription?: FastSpringSubscription; subscriptions?: FastSpringSubscription[] }
): FastSpringSubscription {
  if (typeof data === "string") {
    throw new Error(
      "Subscription API returned a string (e.g. XML from Classic endpoint). Check URL and try Classic lookup."
    );
  }
  if (data && typeof data === "object") {
    if ("subscription" in data && data.subscription && typeof data.subscription === "object") {
      return data.subscription;
    }
    if ("subscriptions" in data && Array.isArray(data.subscriptions) && data.subscriptions.length > 0) {
      return data.subscriptions[0];
    }
    if ("id" in data && typeof (data as FastSpringSubscription).id === "string") {
      return data as FastSpringSubscription;
    }
  }
  return data as FastSpringSubscription;
}

/**
 * Fetch a single subscription by ID from the standard SBL path.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getSubscription(
  deps: SubscriptionsServiceDeps,
  subscriptionId: string
): Promise<FastSpringSubscription> {
  try {
    const id = trim(subscriptionId);
    const response = await deps.http.get<
      FastSpringSubscription | { subscription?: FastSpringSubscription }
    >(`${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`);
    const data = unwrapSubscription(response.data);
    return data;
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch a single subscription by ID using company-scoped path.
 * Use when the account requires /company/{companyId}/subscriptions/{id} (see README FS_BASE_URL).
 * @throws FastSpringError on 4xx/5xx or network error
 */
async function getSubscriptionCompanyScoped(
  deps: SubscriptionsServiceDeps,
  subscriptionId: string
): Promise<FastSpringSubscription> {
  try {
    if (!deps.companyId) {
      throw new Error("companyId required for company-scoped subscription fetch");
    }
    const id = trim(subscriptionId);
    const path = `/company/${encodeURIComponent(deps.companyId)}/subscriptions/${encodeURIComponent(id)}`;
    const response = await deps.http.get<
      FastSpringSubscription | { subscription?: FastSpringSubscription }
    >(path);
    const data = unwrapSubscription(response.data);
    return data;
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch a subscription by reference string.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getSubscriptionByReference(
  deps: SubscriptionsServiceDeps,
  reference: string
): Promise<FastSpringSubscription | null> {
  try {
    const response = await deps.http.get<FastSpringSubscriptionsResponse>(
      SUBSCRIPTIONS_PATH,
      { params: { reference: trim(reference) } }
    );
    const subs = response.data?.subscriptions ?? [];
    return subs[0] ?? null;
  } catch (err) {
    throw err;
  }
}

/**
 * List subscriptions with optional filters (status, product, email).
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function listSubscriptions(
  deps: SubscriptionsServiceDeps,
  filters: ListSubscriptionsFilters = {}
): Promise<FastSpringSubscription[]> {
  try {
    const params: Record<string, string> = {};
    if (filters.status !== undefined) params.status = trim(filters.status);
    if (filters.product !== undefined) params.product = trim(filters.product);
    if (filters.email !== undefined) params.email = trim(filters.email);
    const response = await deps.http.get<FastSpringSubscriptionsResponse>(
      SUBSCRIPTIONS_PATH,
      { params: Object.keys(params).length > 0 ? params : undefined }
    );
    const subscriptions = response.data?.subscriptions ?? [];
    return subscriptions;
  } catch (err) {
    throw err;
  }
}

/**
 * Get line items/entries for a subscription (from the subscription object).
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getSubscriptionEntries(
  deps: SubscriptionsServiceDeps,
  subscriptionId: string
): Promise<FastSpringSubscription["entries"]> {
  try {
    const sub = await getSubscription(deps, trim(subscriptionId));
    const entries = sub.entries ?? [];
    return entries;
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Classic API — subscription lookup with dual-credential fallback
// ---------------------------------------------------------------------------

/**
 * Returns true when an error from the Classic API should trigger a retry with
 * legacy credentials:
 *
 * - HTTP 401/403 — explicit auth denial
 * - Non-XML body (HTTP 200 with plain-text body) — detected by assertXmlResponse
 * - HTTP 404 — subscription not found on the primary platform; it may exist on
 *   the legacy Classic platform under different credentials
 * - XML parse failure caused by unexpected root element
 */
function shouldRetryWithLegacyCredentials(err: unknown): boolean {
  if (err instanceof FastSpringError) {
    return err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404;
  }
  if (err instanceof Error) {
    if (err.message.includes("Classic API returned a non-XML response")) return true;
    if (err.message.includes("Legacy API response missing")) return true;
  }
  return false;
}

/**
 * Make a single GET /company/{companyId}/subscription/{reference} request and
 * return the parsed LegacySubscription.
 * Throws on any error (network, HTTP, XML parse, access denied).
 */
async function classicSubscriptionRequest(
  http: AxiosInstance,
  companyId: string,
  reference: string
): Promise<LegacySubscription> {
  try {
    const path = `/company/${encodeURIComponent(companyId)}/subscription/${encodeURIComponent(reference)}`;
    const response = await http.get<string>(path, { responseType: "text" });
    assertXmlResponse(response.data);
    const subscription = parseLegacySubscriptionXml(response.data);
    return subscription;
  } catch (err) {
    throw err;
  }
}

/**
 * Fetch a single subscription by reference using the FastSpring Classic (legacy) API.
 *
 * Uses GET /company/{companyId}/subscription/{reference} which returns the full
 * subscription as XML, including customer, status, product name, next period date,
 * and all other fields the Classic API exposes.
 *
 * When legacy credentials are configured (FS_LEGACY_API_USERNAME), the call is
 * automatically retried with those credentials if the primary credentials are denied
 * or the subscription is not found on the primary platform.
 *
 * Returns null when the subscription is not found on either platform (404).
 *
 * Classic API docs: https://github.com/fastspring/fastspring-api/blob/master/sections/subscriptions.mdown
 *
 * @throws Error if companyId is not configured
 * @throws FastSpringError on non-404 4xx/5xx or network error
 */
export async function getClassicSubscriptionByReference(
  deps: SubscriptionsServiceDeps,
  reference: string
): Promise<LegacySubscription | null> {
  try {
    if (!deps.companyId) {
      throw new Error(
        "FS_COMPANY_ID is not configured. Set it in your .env file to enable subscription reference lookups via the FastSpring Classic API."
      );
    }

    const ref = trim(reference);

    try {
      const subscription = await classicSubscriptionRequest(deps.http, deps.companyId, ref);
      return subscription;
    } catch (primaryErr) {
      const is404 = primaryErr instanceof FastSpringError && primaryErr.statusCode === 404;

      // When legacy credentials are available and the error is retryable, try the
      // legacy platform before deciding the subscription is not found.
      if (shouldRetryWithLegacyCredentials(primaryErr) && deps.legacyHttp) {
        const legacyCompanyId = deps.legacyCompanyId ?? deps.companyId;
        try {
          const subscription = await classicSubscriptionRequest(deps.legacyHttp, legacyCompanyId, ref);
          return subscription;
        } catch (legacyErr) {
          if (legacyErr instanceof FastSpringError && legacyErr.statusCode === 404) {
            return null;
          }
          throw legacyErr;
        }
      }

      // 404 on the primary platform with no legacy credentials → subscription not found.
      if (is404) {
        return null;
      }

      throw primaryErr;
    }
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Unified lookup — transparently tries SBL then Classic
// ---------------------------------------------------------------------------

/**
 * Unified subscription lookup by any identifier (SBL internal ID, SBL reference,
 * or Classic reference).
 *
 * Resolution order:
 *   1. SBL  GET /subscriptions/{identifier}           — by internal SBL ID (same as integration script)
 *   2. SBL  GET /subscriptions?reference={identifier} — by SBL reference
 *   3. SBL  GET /company/{co}/subscriptions/{id}      — company-scoped when FS_COMPANY_ID set
 *   4. Classic GET /company/{co}/subscription/{id}    — by Classic reference (with
 *      automatic legacy-credential fallback when configured)
 *
 * Returns a SubscriptionLookupResult annotated with the platform that found it,
 * or null when the identifier is not found on either platform.
 *
 * Auth errors (401/403) and network errors are always propagated to the caller
 * so they are never silently swallowed.
 *
 * @throws FastSpringError on auth failures or unexpected API errors
 * @throws Error on network failures
 */
export async function lookupSubscription(
  deps: SubscriptionsServiceDeps,
  identifier: string
): Promise<SubscriptionLookupResult | null> {
  try {
    const id = trim(identifier);

    // Step 1 — SBL by internal ID (path). Same as integration script getSubscription(deps, id).
    try {
      const sub = await getSubscription(deps, id);
      const looksLikeSubscription =
        sub && typeof sub === "object" && "id" in sub && typeof (sub as { id: unknown }).id === "string";
      const isErrorBody =
        sub && typeof sub === "object" &&
        !looksLikeSubscription &&
        (("error" in sub && (sub as { error: unknown }).error != null) ||
          ("code" in sub && typeof (sub as { code: unknown }).code === "number" && (sub as { code: number }).code >= 400));
      if (!isErrorBody && sub && typeof sub === "object") {
        return { platform: Platform.SBL, data: sub };
      }
    } catch (err) {
      if (!(err instanceof FastSpringError)) throw err;
      if (err.statusCode === 401 || err.statusCode === 403) throw err;
    }

    // Step 2 — SBL by reference (query param)
    try {
      const sblSub = await getSubscriptionByReference(deps, id);
      if (sblSub !== null) {
        return { platform: Platform.SBL, data: sblSub };
      }
    } catch (err) {
      if (!(err instanceof FastSpringError)) throw err;
      if (err.statusCode === 401 || err.statusCode === 403) throw err;
    }

    // Step 3 — SBL company-scoped path (for accounts that require /company/{companyId}/subscriptions/{id})
    if (deps.companyId) {
      try {
        const sub = await getSubscriptionCompanyScoped(deps, id);
        const looksLikeSubscription =
          sub && typeof sub === "object" && "id" in sub && typeof (sub as { id: unknown }).id === "string";
        if (looksLikeSubscription) {
          return { platform: Platform.SBL, data: sub };
        }
      } catch (err) {
        if (!(err instanceof FastSpringError)) throw err;
        if (err.statusCode === 401 || err.statusCode === 403) throw err;
      }
    }

    // Step 4 — Classic API (with dual-credential fallback inside)
    if (deps.companyId) {
      const classicSub = await getClassicSubscriptionByReference(deps, id);
      if (classicSub !== null) {
        return { platform: Platform.CLASSIC, data: classicSub };
      }
    }

    return null;
  } catch (err) {
    throw err;
  }
}

/**
 * Update tags on a FastSpring subscription.
 *
 * Uses POST /subscriptions/{id}.  The provided tags replace the existing tag
 * set on the subscription.
 *
 * API docs: https://developer.fastspring.com/reference/update-a-subscription
 *
 * @param subscriptionId  The subscription's internal FastSpring SBL ID (the
 *                        "id" field returned by getSubscription / lookupSubscription).
 * @param tags            Key-value pairs to set as subscription-level tags.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function updateSubscriptionTags(
  deps: SubscriptionsServiceDeps,
  subscriptionId: string,
  tags: Record<string, string>
): Promise<UpdateSubscriptionTagsResponse> {
  try {
    const id = trim(subscriptionId);
    const body: UpdateSubscriptionTagsRequest = { tags };
    const response = await deps.http.post<UpdateSubscriptionTagsResponse>(
      `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`,
      body
    );
    const result = response.data;
    return result;
  } catch (err) {
    throw err;
  }
}
