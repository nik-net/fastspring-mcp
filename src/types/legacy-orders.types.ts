/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Types for the FastSpring Classic (legacy) API order responses.
 * The legacy API returns XML; these types represent the parsed structure.
 *
 * Legacy API reference: https://github.com/fastspring/fastspring-api/blob/master/sections/orders.mdown
 * Endpoints:
 *   GET /company/{company}/order/{reference}       → single LegacyOrder
 *   GET /company/{company}/orders/search?query=... → LegacyOrderSearchResult[]
 */

export interface LegacyOrderCustomer {
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phoneNumber?: string;
}

export interface LegacyOrderAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  regionCustom?: string;
  postalCode?: string;
  country?: string;
}

export interface LegacyOrderItem {
  productDisplay?: string;
  productName?: string;
  quantity?: number;
  subscriptionReference?: string;
}

export interface LegacyOrderPayment {
  status?: string;
  statusChanged?: string;
  methodType?: string;
  declinedReason?: string;
  currency?: string;
  total?: number;
}

/**
 * Full order detail returned by GET /company/{company}/order/{reference}.
 */
export interface LegacyOrder {
  reference: string;
  status: string;
  statusChanged?: string;
  test?: boolean;
  due?: string;
  returnStatus?: string;
  currency?: string;
  referrer?: string;
  originIp?: string;
  total?: number;
  tax?: number;
  shipping?: number;
  sourceName?: string;
  sourceKey?: string;
  sourceCampaign?: string;
  customer?: LegacyOrderCustomer;
  purchaser?: LegacyOrderCustomer;
  address?: LegacyOrderAddress;
  orderItems?: LegacyOrderItem[];
  payments?: LegacyOrderPayment[];
}

/**
 * Abbreviated order summary returned by GET /company/{company}/orders/search.
 * Contains fewer fields than LegacyOrder.
 */
export interface LegacyOrderSearchResult {
  reference: string;
  status: string;
  statusChanged?: string;
  test?: boolean;
  returnStatus?: string;
  customer?: LegacyOrderCustomer;
}
