/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetAccount,
  handleGetAccountByEmail,
  handleGetAccountOrders,
  GetAccountSchema,
  GetAccountByEmailSchema,
} from "../../src/tools/accounts.tools.js";
import { FastSpringError } from "../../src/utils/errors.js";

describe("accounts.tools", () => {
  const mockGet = vi.fn();
  const accountsDeps = { http: { get: mockGet } };
  const ordersDeps = { http: { get: mockGet } };
  const accountsToolsDeps = { accounts: accountsDeps, orders: ordersDeps };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input schemas", () => {
    it("GetAccountSchema accepts accountId", () => {
      const parsed = GetAccountSchema.safeParse({ accountId: "acc-1" });
      expect(parsed.success).toBe(true);
    });

    it("GetAccountByEmailSchema accepts valid email", () => {
      const parsed = GetAccountByEmailSchema.safeParse({
        email: "user@example.com",
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("handleGetAccount", () => {
    it("returns MCP response with account JSON", async () => {
      const account = { id: "acc-1", email: "a@b.com" };
      mockGet.mockResolvedValueOnce({ data: account });
      const result = await handleGetAccount(accountsDeps, {
        accountId: "acc-1",
      });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(account);
    });

    it("returns error content on FastSpringError", async () => {
      mockGet.mockRejectedValueOnce(
        new FastSpringError("Unauthorized", 401)
      );
      const result = await handleGetAccount(accountsDeps, {
        accountId: "acc-1",
      });
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0].text);
      expect(body.statusCode).toBe(401);
    });
  });

  describe("handleGetAccountByEmail", () => {
    it("returns account when found", async () => {
      const account = { id: "acc-1", email: "a@b.com" };
      mockGet.mockResolvedValueOnce({ data: { accounts: [account] } });
      const result = await handleGetAccountByEmail(accountsDeps, {
        email: "a@b.com",
      });
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(account);
    });

    it("returns message when no account found", async () => {
      mockGet.mockResolvedValueOnce({ data: { accounts: [] } });
      const result = await handleGetAccountByEmail(accountsDeps, {
        email: "a@b.com",
      });
      const body = JSON.parse(result.content[0].text);
      expect(body.message).toContain("No account found");
    });
  });

  describe("handleGetAccountOrders", () => {
    it("returns orders for account", async () => {
      mockGet
        .mockResolvedValueOnce({ data: { id: "acc-1", email: "a@b.com" } })
        .mockResolvedValueOnce({ data: { orders: [{ id: "ord-1" }] } });
      const result = await handleGetAccountOrders(accountsToolsDeps, {
        accountId: "acc-1",
      });
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual([{ id: "ord-1" }]);
    });

    it("returns error when account fetch fails", async () => {
      mockGet.mockRejectedValueOnce(
        new FastSpringError("Not found", 404)
      );
      const result = await handleGetAccountOrders(accountsToolsDeps, {
        accountId: "missing",
      });
      expect(result.isError).toBe(true);
    });

    it("returns error content for non-FastSpring error", async () => {
      mockGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await handleGetAccountOrders(accountsToolsDeps, {
        accountId: "acc-1",
      });
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0].text);
      expect(body.error).toBe("ECONNREFUSED");
    });
  });
});
