/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { z } from "zod";
import type { SubscriptionsServiceDeps } from "../services/subscriptions.service.js";
import * as subscriptionsService from "../services/subscriptions.service.js";
import { FastSpringError } from "../utils/errors.js";
import { optionalTrimmedString } from "../utils/schema.js";

const trimString = (s: string) => s.trim();

// ---------------------------------------------------------------------------
// Shared Zod helpers for tag inputs
// ---------------------------------------------------------------------------

/**
 * Zod schema for a flat string key-value map (used for subscription tags).
 * Transforms each value to a trimmed string.
 */
const tagsRecord = () =>
  z.record(z.string().transform(trimString)).describe(
    "A flat key-value map where both keys and values are strings."
  );

// ---------------------------------------------------------------------------
// Schemas — read operations
// ---------------------------------------------------------------------------

export const GetSubscriptionSchema = z.object({
  reference: z
    .string()
    .min(1, "reference is required")
    .transform(trimString)
    .describe(
      "A FastSpring subscription ID or reference number, e.g. VI8201014-6538-11102S. " +
        "Accepts any format — the system will find the subscription automatically."
    ),
});

export const ListSubscriptionsSchema = z.object({
  status: optionalTrimmedString().describe(
    "Filter by subscription status, e.g. active or deactivated"
  ),
  product: optionalTrimmedString().describe("Filter by product name or path"),
  email: optionalTrimmedString()
    .pipe(z.union([z.string().email(), z.undefined()]))
    .describe("Filter by customer email address"),
});

export const GetSubscriptionLineItemsSchema = z.object({
  subscriptionId: z
    .string()
    .min(1, "subscriptionId is required")
    .transform(trimString)
    .describe(
      "The subscription's internal FastSpring ID. " +
        "This is the 'id' field returned by get_subscription, not the reference number."
    ),
});

// ---------------------------------------------------------------------------
// Schemas — write operations
// ---------------------------------------------------------------------------

/**
 * Input schema for the update_subscription_tags tool.
 *
 * Maps to POST /subscriptions/{subscriptionId}: { tags: { key: value } }
 */
export const UpdateSubscriptionTagsSchema = z.object({
  subscriptionId: z
    .string()
    .min(1, "subscriptionId is required")
    .transform(trimString)
    .describe(
      "The subscription's internal FastSpring SBL ID. " +
        "This is the 'id' field returned by get_subscription, not the reference number."
    ),
  tags: tagsRecord().describe(
    "Key-value string pairs to set as subscription-level tags. " +
      "These REPLACE the full existing tag set on the subscription."
  ),
});

export type GetSubscriptionInput = z.infer<typeof GetSubscriptionSchema>;
export type ListSubscriptionsInput = z.infer<typeof ListSubscriptionsSchema>;
export type GetSubscriptionLineItemsInput = z.infer<typeof GetSubscriptionLineItemsSchema>;
export type UpdateSubscriptionTagsInput = z.infer<typeof UpdateSubscriptionTagsSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function errorToContent(err: unknown): { content: { type: "text"; text: string }[] } {
  if (err instanceof FastSpringError) {
    return {
      content: [
        {
          type: "text" as const,
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
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleGetSubscription(
  deps: SubscriptionsServiceDeps,
  input: GetSubscriptionInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const reference = String(input.reference).trim();
    const result = await subscriptionsService.lookupSubscription(deps, reference);
    if (result === null) {
      return {
        content: [
          {
            type: "text",
            text: formatResult({ message: "No subscription found for the given reference", reference }),
          },
        ],
      };
    }
    return { content: [{ type: "text", text: formatResult(result) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export async function handleListSubscriptions(
  deps: SubscriptionsServiceDeps,
  input: ListSubscriptionsInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const filters: subscriptionsService.ListSubscriptionsFilters = {};
    if (input.status !== undefined) filters.status = input.status;
    if (input.product !== undefined) filters.product = input.product;
    if (input.email !== undefined) filters.email = input.email;
    const subscriptions = await subscriptionsService.listSubscriptions(deps, filters);
    return { content: [{ type: "text", text: formatResult(subscriptions) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export async function handleUpdateSubscriptionTags(
  deps: SubscriptionsServiceDeps,
  input: UpdateSubscriptionTagsInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const subscriptionId = String(input.subscriptionId).trim();
    const result = await subscriptionsService.updateSubscriptionTags(
      deps,
      subscriptionId,
      input.tags
    );
    return { content: [{ type: "text", text: formatResult(result) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export async function handleGetSubscriptionLineItems(
  deps: SubscriptionsServiceDeps,
  input: GetSubscriptionLineItemsInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const subscriptionId = String(input.subscriptionId).trim();
    const entries = await subscriptionsService.getSubscriptionEntries(deps, subscriptionId);
    return { content: [{ type: "text", text: formatResult(entries) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const subscriptionsToolDefinitions = [
  {
    name: "get_subscription",
    description:
      "Fetch a FastSpring subscription by its ID or reference number (e.g. VI8201014-6538-11102S). " +
      "Accepts any identifier — the system checks both the current and legacy FastSpring platforms automatically. " +
      "The response includes a 'platform' field ('modern' or 'legacy') that tells you which platform holds the record, " +
      "and a 'data' field with the subscription details. " +
      "Modern platform subscriptions include: id, status, product, customer, start/end dates, next charge date, and line items. " +
      "Legacy platform subscriptions include: reference, status, customer, product name, quantity, next renewal date, and end date.",
    inputSchema: GetSubscriptionSchema,
    handler: handleGetSubscription,
  },
  {
    name: "list_subscriptions",
    description:
      "Search for FastSpring subscriptions on the current platform. " +
      "Optionally filter by status (e.g. active, deactivated), product name, or customer email. " +
      "Returns a list of matching subscriptions. " +
      "Use get_subscription to fetch the full details of a specific subscription.",
    inputSchema: ListSubscriptionsSchema,
    handler: handleListSubscriptions,
  },
  {
    name: "get_subscription_line_items",
    description:
      "Get the products and quantities on a subscription. " +
      "Requires the subscription's internal FastSpring ID — the 'id' field from get_subscription results. " +
      "Returns the list of products, quantities, and SKUs currently on the subscription.",
    inputSchema: GetSubscriptionLineItemsSchema,
    handler: handleGetSubscriptionLineItems,
  },
  {
    name: "update_subscription_tags",
    description:
      "Add or replace tags on a FastSpring subscription. " +
      "Requires the subscription's internal FastSpring SBL ID (the 'id' field returned by get_subscription). " +
      "Provide a 'tags' map of string key-value pairs — these REPLACE the full existing tag set " +
      "on the subscription. To remove all tags pass an empty object. " +
      "API: POST /subscriptions/{subscriptionId}",
    inputSchema: UpdateSubscriptionTagsSchema,
    handler: handleUpdateSubscriptionTags,
  },
] as const;
