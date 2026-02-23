/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * FastSpring Subscriptions API response types.
 * Aligned with https://developer.fastspring.com/reference/subscriptions
 */

/**
 * Request body for POST /subscriptions/{id} — update tags on an existing subscription.
 * https://developer.fastspring.com/reference/update-a-subscription
 */
export interface UpdateSubscriptionTagsRequest {
  /** Key-value tag pairs to set on the subscription (replaces existing tags). */
  tags: Record<string, string>;
}

/** Response returned by POST /subscriptions/{id} when updating tags. */
export interface UpdateSubscriptionTagsResponse {
  subscription?: string;
  result?: string;
  [key: string]: unknown;
}

export interface FastSpringSubscriptionEntry {
  product: string;
  quantity: number;
  display?: string;
  sku?: string;
}

export interface FastSpringSubscription {
  id: string;
  reference?: string;
  status: string;
  product?: string;
  productDisplay?: string;
  customer: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  /** Some API responses use "account" instead of or in addition to "customer". */
  account?: { email?: string; [key: string]: unknown };
  begin?: number;
  end?: number;
  nextChargeDate?: number;
  cancelable?: boolean;
  entries?: FastSpringSubscriptionEntry[];
}

export interface FastSpringSubscriptionsResponse {
  subscriptions: FastSpringSubscription[];
}
