/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * FastSpring Orders API response types.
 * Aligned with https://developer.fastspring.com/reference/orders
 */

/** Key-value map used for order tags and product-level attributes. */
export type FastSpringTags = Record<string, string>;

/**
 * A single product entry in an UpdateOrderTagsRequest.
 * Used to set or update attributes on a specific product line item.
 */
export interface UpdateOrderTagsItem {
  /** Product path whose attributes will be updated. */
  product: string;
  /** Key-value attribute pairs to add or replace on this product. */
  attributes: FastSpringTags;
}

/**
 * Request body for POST /orders — update tags and/or product attributes on one
 * or more orders.
 * https://developer.fastspring.com/reference/update-order-tags-and-attributes
 */
export interface UpdateOrderTagsRequest {
  orders: Array<{
    /** The FastSpring order ID to update. */
    order: string;
    /** Order-level tags to set (replaces existing tags). */
    tags?: FastSpringTags;
    /** Per-product attribute updates. */
    items?: UpdateOrderTagsItem[];
  }>;
}

/** Response returned by POST /orders when updating tags/attributes. */
export interface UpdateOrderTagsResponse {
  orders: Array<Record<string, unknown>>;
}

export interface FastSpringOrderItem {
  product: string;
  quantity: number;
  display?: string;
  sku?: string;
  subtotal?: number;
  subtotalDisplay?: string;
}

export interface FastSpringOrder {
  id: string;
  reference?: string;
  orderNumber?: number;
  orderType?: string;
  status: string;
  completed?: boolean;
  customer: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  total: number;
  totalDisplay?: string;
  currency?: string;
  items?: FastSpringOrderItem[];
  invoiceUrl?: string;
  created?: number;
  changed?: number;
}

export interface FastSpringOrdersResponse {
  orders: FastSpringOrder[];
}
