#!/usr/bin/env node
/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Integration test: calls FastSpring API using the same services as the MCP server.
 * Uses real credentials from .env. Run from repo root after: npm run build
 *
 * Usage: node scripts/integration-test-api.mjs
 *
 * Tests (use TEST_ORDER_REFERENCE, TEST_SUBSCRIPTION_ID, TEST_CUSTOMER_EMAIL in .env):
 * - find_orders_by_reference, get_order
 * - get_subscription, get_subscription_entries
 * - find_orders_by_email, find_account_by_email, get_account_orders, list_subscriptions (using email from order/subscription)
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env");
  const env = { ...process.env };
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

async function main() {
  const env = loadEnv();
  if (!env.FS_API_USERNAME || !env.FS_API_PASSWORD) {
    console.error("Missing FS_API_USERNAME or FS_API_PASSWORD in .env");
    process.exit(1);
  }

  const ORDER_REFERENCE = env.TEST_ORDER_REFERENCE?.trim() || "";
  const SUBSCRIPTION_ID = env.TEST_SUBSCRIPTION_ID?.trim() || "";

  if (!ORDER_REFERENCE || !SUBSCRIPTION_ID) {
    console.error(
      "Missing TEST_ORDER_REFERENCE or TEST_SUBSCRIPTION_ID in .env\n" +
      "Add these to your .env file to run integration tests:\n" +
      "  TEST_ORDER_REFERENCE=<your-order-reference>\n" +
      "  TEST_SUBSCRIPTION_ID=<your-subscription-id>"
    );
    process.exit(1);
  }

  // So loadConfig() and services see .env (they read process.env)
  Object.assign(process.env, env);

  const distPath = join(ROOT, "dist", "index.js");
  if (!existsSync(distPath)) {
    console.error("Run npm run build first. Not found:", distPath);
    process.exit(1);
  }

  const { loadConfig } = await import("../dist/config.js");
  const { createLogger } = await import("../dist/utils/logger.js");
  const { createHttpClient } = await import("../dist/utils/http.js");
  const ordersService = await import("../dist/services/orders.service.js");
  const subscriptionsService = await import("../dist/services/subscriptions.service.js");
  const accountsService = await import("../dist/services/accounts.service.js");

  const config = loadConfig();
  const logger = createLogger(config.logDir, config.logLevel);
  const http = createHttpClient(config, logger);

  const legacyHttp =
    config.legacyUsername !== undefined && config.legacyPassword !== undefined
      ? createHttpClient(config, logger, {
          username: config.legacyUsername,
          password: config.legacyPassword,
        })
      : undefined;

  const ordersDeps = {
    http,
    ...(config.companyId !== undefined ? { companyId: config.companyId } : {}),
    ...(legacyHttp !== undefined ? { legacyHttp } : {}),
    ...(config.legacyCompanyId !== undefined
      ? { legacyCompanyId: config.legacyCompanyId }
      : {}),
  };
  const subscriptionsDeps = {
    http,
    ...(config.companyId !== undefined ? { companyId: config.companyId } : {}),
    ...(legacyHttp !== undefined ? { legacyHttp } : {}),
    ...(config.legacyCompanyId !== undefined
      ? { legacyCompanyId: config.legacyCompanyId }
      : {}),
  };
  const accountsDeps = { http };

  const results = { passed: 0, failed: 0, errors: [] };

  function pass(name, data) {
    results.passed++;
    console.log(`\n✅ ${name}`);
    if (data !== undefined) console.log(JSON.stringify(data, null, 2));
  }

  function fail(name, err) {
    results.failed++;
    const msg = err?.message ?? String(err);
    const body = err?.responseBody;
    results.errors.push({ name, message: msg, responseBody: body });
    console.error(`\n❌ ${name}: ${msg}`);
    if (body !== undefined) console.error("Response body:", JSON.stringify(body, null, 2));
  }

  let customerEmail = env.TEST_CUSTOMER_EMAIL?.trim() || null;
  let orderIdFromReference = null;
  let accountIdFromEmail = null;

  try {
    // 1) Find orders by reference (user's "order id" may be the reference)
    try {
      const ordersByRef = await ordersService.findOrdersByReference(ordersDeps, ORDER_REFERENCE);
      if (Array.isArray(ordersByRef) && ordersByRef.length > 0) {
        orderIdFromReference = ordersByRef[0].id;
        customerEmail = ordersByRef[0].customer?.email ?? customerEmail;
        pass("find_orders_by_reference", { count: ordersByRef.length, firstOrderId: orderIdFromReference, email: customerEmail });
      } else {
        pass("find_orders_by_reference", { message: "No orders found for reference (may be internal id)", orders: ordersByRef });
      }
    } catch (e) {
      fail("find_orders_by_reference", e);
    }

    // 2) Get single order: try by internal id from step 1, else try user value as id
    const orderIdToUse = orderIdFromReference ?? ORDER_REFERENCE;
    try {
      const order = await ordersService.getOrder(ordersDeps, orderIdToUse);
      if (order?.customer?.email) customerEmail = order.customer.email;
      pass("get_order", { id: order?.id, reference: order?.reference, email: order?.customer?.email });
    } catch (e) {
      const isNotFound = e?.responseBody?.orders?.[0]?.error?.order === "Not found" || e?.message?.includes("Not found");
      const usedReferenceAsId = orderIdToUse === ORDER_REFERENCE;
      if (usedReferenceAsId && isNotFound) {
        pass("get_order", { message: "Expected: reference is not internal id; use find_orders_by_reference for references." });
      } else {
        fail("get_order", e);
      }
    }

    // 3) Get subscription by id
    try {
      const sub = await subscriptionsService.getSubscription(subscriptionsDeps, SUBSCRIPTION_ID);
      const email = sub?.customer?.email ?? sub?.account?.email ?? (typeof sub?.customer === "string" ? sub.customer : null);
      if (email) customerEmail = customerEmail ?? email;
      if (!email && sub && process.env.FS_DEBUG === "true") {
        console.log("(DEBUG) get_subscription response keys:", Object.keys(sub));
      }
      pass("get_subscription", { id: sub?.id, status: sub?.status, email: email ?? "(none in response)" });
    } catch (e) {
      fail("get_subscription", e);
    }

    // 4) Get subscription entries
    try {
      const entries = await subscriptionsService.getSubscriptionEntries(subscriptionsDeps, SUBSCRIPTION_ID);
      pass("get_subscription_entries", Array.isArray(entries) ? { count: entries.length, entries } : entries);
    } catch (e) {
      fail("get_subscription_entries", e);
    }

    if (!customerEmail) {
      try {
        const allSubs = await subscriptionsService.listSubscriptions(subscriptionsDeps, {});
        const withEmail = allSubs?.find((s) => s?.customer?.email || s?.account?.email);
        customerEmail = withEmail?.customer?.email ?? withEmail?.account?.email ?? null;
        if (customerEmail) pass("list_subscriptions (no filter, to get email)", { usedForEmail: true });
      } catch (_) {
        // ignore
      }
    }
    if (!customerEmail) {
      console.warn("\n⚠ No customer email from order/subscription/list; skipping email-based tests. Set TEST_CUSTOMER_EMAIL in .env to run them.");
      results.errors.push({ name: "email_tests", message: "Skipped: no customer email from order/subscription" });
    }
    if (customerEmail) {
      // 5) Find orders by email
      try {
        const ordersByEmail = await ordersService.findOrdersByEmail(ordersDeps, customerEmail);
        pass("find_orders_by_email", { email: customerEmail, count: ordersByEmail?.length ?? 0 });
      } catch (e) {
        fail("find_orders_by_email", e);
      }

      // 6) Find account by email
      try {
        const account = await accountsService.findAccountByEmail(accountsDeps, customerEmail);
        if (account) accountIdFromEmail = account.id;
        pass("find_account_by_email", account ? { id: account.id, email: account.email } : { message: "No account found" });
      } catch (e) {
        fail("find_account_by_email", e);
      }

      // 7) Get account orders (by account id from step 6)
      if (accountIdFromEmail) {
        try {
          const accountOrders = await accountsService.getAccountOrders(accountsDeps, ordersDeps, accountIdFromEmail);
          pass("get_account_orders", { accountId: accountIdFromEmail, count: accountOrders?.length ?? 0 });
        } catch (e) {
          fail("get_account_orders", e);
        }
      } else {
        try {
          const account = await accountsService.findAccountByEmail(accountsDeps, customerEmail);
          if (account) {
            const accountOrders = await accountsService.getAccountOrders(accountsDeps, ordersDeps, account.id);
            pass("get_account_orders", { accountId: account.id, count: accountOrders?.length ?? 0 });
          } else {
            results.errors.push({ name: "get_account_orders", message: "Skipped: no account id" });
          }
        } catch (e) {
          fail("get_account_orders", e);
        }
      }

      // 8) List subscriptions filtered by email
      try {
        const subs = await subscriptionsService.listSubscriptions(subscriptionsDeps, { email: customerEmail });
        pass("list_subscriptions (by email)", { email: customerEmail, count: subs?.length ?? 0 });
      } catch (e) {
        fail("list_subscriptions (by email)", e);
      }
    }

    // 9) get_account by id (if we have one)
    if (accountIdFromEmail) {
      try {
        const account = await accountsService.getAccount(accountsDeps, accountIdFromEmail);
        pass("get_account", { id: account?.id, email: account?.email });
      } catch (e) {
        fail("get_account", e);
      }
    }
  } catch (err) {
    console.error("Unexpected error:", err);
    results.failed++;
    results.errors.push({ name: "main", message: err?.message ?? String(err) });
  }

  console.log("\n--- Summary ---");
  console.log("Passed:", results.passed);
  console.log("Failed:", results.failed);
  if (results.errors.length > 0) {
    console.log("Errors:", JSON.stringify(results.errors, null, 2));
  }
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
