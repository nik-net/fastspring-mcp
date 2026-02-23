/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Types for the FastSpring Classic (legacy) API subscription responses.
 * The legacy API returns XML; these types represent the parsed structure.
 *
 * Legacy API reference: https://github.com/fastspring/fastspring-api/blob/master/sections/subscriptions.mdown
 * Endpoint:
 *   GET /company/{company}/subscription/{reference}  → single LegacySubscription
 */

export interface LegacySubscriptionCustomer {
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phoneNumber?: string;
}

/**
 * Full subscription detail returned by GET /company/{company}/subscription/{reference}.
 *
 * Fields map directly to the XML elements returned by the FastSpring Classic API.
 * Numeric fields (quantity) are automatically coerced from strings by the XML parser.
 * Boolean fields (cancelable, test) are similarly coerced.
 */
export interface LegacySubscription {
  reference: string;
  status: string;
  statusChanged?: string;
  statusReason?: string;
  cancelable?: boolean;
  test?: boolean;
  referrer?: string;
  sourceName?: string;
  sourceKey?: string;
  sourceCampaign?: string;
  customer?: LegacySubscriptionCustomer;
  customerUrl?: string;
  productName?: string;
  tags?: string;
  quantity?: number;
  coupon?: string;
  nextPeriodDate?: string;
  end?: string;
}
