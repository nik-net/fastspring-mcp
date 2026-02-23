/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { z } from "zod";
import type { OrdersServiceDeps } from "../services/orders.service.js";
import * as ordersService from "../services/orders.service.js";
import { FastSpringError } from "../utils/errors.js";

const trimString = (s: string) => s.trim();

// ---------------------------------------------------------------------------
// Shared Zod helpers for tag/attribute inputs
// ---------------------------------------------------------------------------

/**
 * Zod schema for a flat string key-value map (used for tags and attributes).
 * Transforms each value to a trimmed string.
 */
const tagsRecord = () =>
  z.record(z.string().transform(trimString)).describe(
    "A flat key-value map where both keys and values are strings."
  );

// ---------------------------------------------------------------------------
// Schemas — read operations
// ---------------------------------------------------------------------------

export const GetOrderSchema = z.object({
  reference: z
    .string()
    .min(1, "reference is required")
    .transform(trimString)
    .describe(
      "A FastSpring order ID or reference number, e.g. VI0000000-0000-00000. " +
        "Accepts any format — the system will find the order automatically."
    ),
});

export const ListOrdersByEmailSchema = z.object({
  email: z
    .string()
    .email()
    .transform(trimString)
    .describe("Customer email address to list orders for"),
});

// ---------------------------------------------------------------------------
// Schemas — write operations
// ---------------------------------------------------------------------------

/**
 * Input schema for the update_order_tags tool.
 *
 * Maps to POST /orders:
 *   { orders: [{ order, tags?, items?: [{ product, attributes }] }] }
 */
export const UpdateOrderTagsSchema = z.object({
  orderId: z
    .string()
    .min(1, "orderId is required")
    .transform(trimString)
    .describe(
      "The FastSpring internal order ID to update. " +
        "This is the 'id' field returned by get_order, e.g. \"VER1234567890-XXXX-XXXXX\"."
    ),
  tags: tagsRecord()
    .optional()
    .describe(
      "Order-level tags to set as key-value string pairs. " +
        "These REPLACE the full existing tag set on the order. " +
        "Omit to leave existing tags unchanged."
    ),
  items: z
    .array(
      z.object({
        product: z
          .string()
          .min(1)
          .transform(trimString)
          .describe("Product path of the line item whose attributes should be updated."),
        attributes: tagsRecord().describe(
          "Key-value attribute pairs to set on this product line item. " +
            "These REPLACE the existing attribute set for the product."
        ),
      })
    )
    .optional()
    .describe(
      "Per-product attribute updates. Each entry specifies a product path and a map of " +
        "string attributes. Omit to leave existing product attributes unchanged."
    ),
});

export type GetOrderInput = z.infer<typeof GetOrderSchema>;
export type ListOrdersByEmailInput = z.infer<typeof ListOrdersByEmailSchema>;
export type UpdateOrderTagsInput = z.infer<typeof UpdateOrderTagsSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function errorToContent(err: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  if (err instanceof FastSpringError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.message, statusCode: err.statusCode, responseBody: err.responseBody },
            null,
            2
          ),
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleGetOrder(
  deps: OrdersServiceDeps,
  input: GetOrderInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const reference = String(input.reference).trim();
    const result = await ordersService.lookupOrder(deps, reference);
    if (result === null) {
      return {
        content: [
          {
            type: "text",
            text: formatResult({ message: "No order found for the given reference", reference }),
          },
        ],
      };
    }
    return { content: [{ type: "text", text: formatResult(result) }] };
  } catch (err) {
    const errResult = errorToContent(err);
    return { content: errResult.content, isError: true };
  }
}

export async function handleUpdateOrderTags(
  deps: OrdersServiceDeps,
  input: UpdateOrderTagsInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const orderId = String(input.orderId).trim();
    const result = await ordersService.updateOrderTags(
      deps,
      orderId,
      input.tags,
      input.items
    );
    return { content: [{ type: "text", text: formatResult(result) }] };
  } catch (err) {
    const errResult = errorToContent(err);
    return { content: errResult.content, isError: true };
  }
}

export async function handleListOrdersByEmail(
  deps: OrdersServiceDeps,
  input: ListOrdersByEmailInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const email = String(input.email).trim();
    const orders = await ordersService.findOrdersByEmail(deps, email);
    return { content: [{ type: "text", text: formatResult(orders) }] };
  } catch (err) {
    const errResult = errorToContent(err);
    return { content: errResult.content, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const ordersToolDefinitions = [
  {
    name: "get_order",
    description:
      "Fetch a FastSpring order by its ID or reference number (e.g. VI0000000-0000-00000). " +
      "Accepts any identifier — the system checks both the current and legacy FastSpring platforms automatically. " +
      "The response includes a 'platform' field ('modern' or 'legacy') telling you which platform holds the record, " +
      "and a 'data' field with the full order details. " +
      "Modern platform orders include: id, reference, status, customer, line items, total, and currency. " +
      "Legacy platform orders include: reference, status, customer, billing address, line items (each with a " +
      "subscriptionReference if the line item created a subscription), payments, total, tax, shipping, and referrer.",
    inputSchema: GetOrderSchema,
    handler: handleGetOrder,
  },
  {
    name: "list_orders_by_email",
    description:
      "List all orders for a customer by their email address. " +
      "Returns an array of order objects from the current FastSpring platform. " +
      "Use get_order to fetch the full detail of any individual order.",
    inputSchema: ListOrdersByEmailSchema,
    handler: handleListOrdersByEmail,
  },
  {
    name: "update_order_tags",
    description:
      "Add or replace tags and/or per-product attributes on a FastSpring order. " +
      "Requires the order's internal FastSpring ID (the 'id' field returned by get_order). " +
      "Provide 'tags' to set order-level key-value metadata — these REPLACE the full " +
      "existing tag set. Provide 'items' to set attributes on specific product line items " +
      "within the order — each entry must include the product path and an attributes map, " +
      "which also REPLACE the existing attributes for that product. " +
      "Both 'tags' and 'items' are optional; include whichever you need to update. " +
      "Active subscriptions created from this order automatically inherit the updated attributes. " +
      "API: POST /orders",
    inputSchema: UpdateOrderTagsSchema,
    handler: handleUpdateOrderTags,
  },
] as const;
