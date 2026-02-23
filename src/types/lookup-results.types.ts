/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Shared result types for the unified lookup tools.
 *
 * Both FastSpring platforms (modern SBL and legacy Classic) can hold a
 * subscription or order record.  When the lookup tools find a record they
 * annotate the response with the platform it came from so the caller can
 * interpret the payload correctly and make informed follow-up decisions.
 */

import type { FastSpringSubscription } from "./subscriptions.types.js";
import type { LegacySubscription } from "./legacy-subscriptions.types.js";
import type { FastSpringOrder } from "./orders.types.js";
import type { LegacyOrder } from "./legacy-orders.types.js";

/**
 * Identifies which FastSpring platform a record was retrieved from.
 *
 * - `modern` — current FastSpring platform (JSON API).
 *              Data shape: FastSpringSubscription / FastSpringOrder.
 * - `legacy` — older FastSpring platform (XML-based API).
 *              Data shape: LegacySubscription / LegacyOrder.
 */
export enum Platform {
  SBL = "modern",
  CLASSIC = "legacy",
}

/** Returned by lookup_subscription when a subscription is found. */
export interface SubscriptionLookupResult {
  /** Which FastSpring platform the record was retrieved from. */
  platform: Platform;
  /** Subscription payload.  Shape depends on `platform` (SBL vs Classic). */
  data: FastSpringSubscription | LegacySubscription;
}

/** Returned by lookup_order when an order is found. */
export interface OrderLookupResult {
  /** Which FastSpring platform the record was retrieved from. */
  platform: Platform;
  /** Order payload.  Shape depends on `platform` (SBL vs Classic). */
  data: FastSpringOrder | LegacyOrder;
}
