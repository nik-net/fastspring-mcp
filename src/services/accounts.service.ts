/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import type { AxiosInstance } from "axios";
import type {
  FastSpringAccount,
  FastSpringAccountsResponse,
} from "../types/accounts.types.js";
import type { FastSpringOrder } from "../types/orders.types.js";
import { findOrdersByEmail, type OrdersServiceDeps } from "./orders.service.js";

const ACCOUNTS_PATH = "/accounts";

function trim(s: string): string {
  return s.trim();
}

export interface AccountsServiceDeps {
  http: AxiosInstance;
}

/**
 * Fetch a single account by ID.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getAccount(
  deps: AccountsServiceDeps,
  accountId: string
): Promise<FastSpringAccount> {
  try {
    const id = trim(accountId);
    const response = await deps.http.get<FastSpringAccount>(
      `${ACCOUNTS_PATH}/${encodeURIComponent(id)}`
    );
    const data = response.data;
    return data;
  } catch (err) {
    throw err;
  }
}

/**
 * Find account by customer email.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function findAccountByEmail(
  deps: AccountsServiceDeps,
  email: string
): Promise<FastSpringAccount | null> {
  try {
    const response = await deps.http.get<FastSpringAccountsResponse>(
      ACCOUNTS_PATH,
      { params: { email: trim(email) } }
    );
    const accounts = response.data?.accounts ?? [];
    return accounts[0] ?? null;
  } catch (err) {
    throw err;
  }
}

/**
 * Get all orders for an account (by account ID).
 * Uses the account's email to look up orders.
 * @throws FastSpringError on 4xx/5xx or network error
 */
export async function getAccountOrders(
  accountDeps: AccountsServiceDeps,
  ordersDeps: OrdersServiceDeps,
  accountId: string
): Promise<FastSpringOrder[]> {
  try {
    const account = await getAccount(accountDeps, trim(accountId));
    const email = account.email?.trim();
    if (email === undefined || email === "") {
      return [];
    }
    const orderList = await findOrdersByEmail(ordersDeps, email);
    return orderList;
  } catch (err) {
    throw err;
  }
}
