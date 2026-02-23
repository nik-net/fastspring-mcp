/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { z } from "zod";
import type { AccountsServiceDeps } from "../services/accounts.service.js";
import type { OrdersServiceDeps } from "../services/orders.service.js";
import * as accountsService from "../services/accounts.service.js";
import { FastSpringError } from "../utils/errors.js";

const trimString = (s: string) => s.trim();

export const GetAccountSchema = z.object({
  accountId: z
    .string()
    .min(1, "accountId is required")
    .transform(trimString)
    .describe("The unique FastSpring account ID"),
});

export const GetAccountByEmailSchema = z.object({
  email: z
    .string()
    .email()
    .transform(trimString)
    .describe("Customer email address to look up the account for"),
});

export const GetAccountOrdersSchema = z.object({
  accountId: z
    .string()
    .min(1, "accountId is required")
    .transform(trimString)
    .describe("The account ID to fetch all orders for"),
});

export type GetAccountInput = z.infer<typeof GetAccountSchema>;
export type GetAccountByEmailInput = z.infer<typeof GetAccountByEmailSchema>;
export type GetAccountOrdersInput = z.infer<typeof GetAccountOrdersSchema>;

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
            {
              error: err.message,
              statusCode: err.statusCode,
              responseBody: err.responseBody,
            },
            null,
            2
          ),
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
  };
}

export interface AccountsToolsDeps {
  accounts: AccountsServiceDeps;
  orders: OrdersServiceDeps;
}

export async function handleGetAccount(
  deps: AccountsServiceDeps,
  input: GetAccountInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const accountId = String(input.accountId).trim();
    const account = await accountsService.getAccount(deps, accountId);
    return { content: [{ type: "text", text: formatResult(account) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export async function handleGetAccountByEmail(
  deps: AccountsServiceDeps,
  input: GetAccountByEmailInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const email = String(input.email).trim();
    const account = await accountsService.findAccountByEmail(deps, email);
    if (account === null) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { message: "No account found for the given email" },
              null,
              2
            ),
          },
        ],
      };
    }
    return { content: [{ type: "text", text: formatResult(account) }] };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export async function handleGetAccountOrders(
  deps: AccountsToolsDeps,
  input: GetAccountOrdersInput
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const accountId = String(input.accountId).trim();
    const orders = await accountsService.getAccountOrders(
      deps.accounts,
      deps.orders,
      accountId
    );
    return {
      content: [{ type: "text", text: formatResult(orders) }],
    };
  } catch (err) {
    const result = errorToContent(err);
    return { content: result.content, isError: true };
  }
}

export const accountsToolDefinitions = [
  {
    name: "get_account",
    description:
      "Fetch a FastSpring customer account by its account ID. Returns the account details including email, name, company, and billing address.",
    inputSchema: GetAccountSchema,
    handler: handleGetAccount,
    depsKey: "accounts" as const,
  },
  {
    name: "get_account_by_email",
    description:
      "Look up a FastSpring customer account by email address. Returns the account details if found.",
    inputSchema: GetAccountByEmailSchema,
    handler: handleGetAccountByEmail,
    depsKey: "accounts" as const,
  },
  {
    name: "get_account_orders",
    description:
      "Get all orders placed by a FastSpring customer account. Pass the account ID to retrieve the full order history for that account.",
    inputSchema: GetAccountOrdersSchema,
    handler: handleGetAccountOrders,
    depsKey: "both" as const,
  },
] as const;
