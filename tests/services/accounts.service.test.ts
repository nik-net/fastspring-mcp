/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAccount,
  findAccountByEmail,
  getAccountOrders,
} from "../../src/services/accounts.service.js";
import { FastSpringError } from "../../src/utils/errors.js";

describe("accounts.service", () => {
  const mockHttp = { get: vi.fn() };
  const accountsDeps = { http: mockHttp };
  const ordersDeps = { http: mockHttp };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAccount", () => {
    it("returns account on success", async () => {
      const account = { id: "acc-1", email: "a@b.com" };
      mockHttp.get.mockResolvedValueOnce({ data: account });
      const result = await getAccount(accountsDeps, "acc-1");
      expect(result).toEqual(account);
      expect(mockHttp.get).toHaveBeenCalledWith("/accounts/acc-1");
    });

    it("throws FastSpringError on 404", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Not found", 404)
      );
      await expect(getAccount(accountsDeps, "missing")).rejects.toThrow(
        FastSpringError
      );
    });

    it("throws on 401", async () => {
      mockHttp.get.mockRejectedValueOnce(
        new FastSpringError("Unauthorized", 401)
      );
      await expect(getAccount(accountsDeps, "acc-1")).rejects.toThrow(
        FastSpringError
      );
    });
  });

  describe("findAccountByEmail", () => {
    it("returns first account when found", async () => {
      const account = { id: "acc-1", email: "a@b.com" };
      mockHttp.get.mockResolvedValueOnce({ data: { accounts: [account] } });
      const result = await findAccountByEmail(accountsDeps, "a@b.com");
      expect(result).toEqual(account);
      expect(mockHttp.get).toHaveBeenCalledWith("/accounts", {
        params: { email: "a@b.com" },
      });
    });

    it("returns null when no accounts", async () => {
      mockHttp.get.mockResolvedValueOnce({ data: { accounts: [] } });
      const result = await findAccountByEmail(accountsDeps, "a@b.com");
      expect(result).toBeNull();
    });

    it("throws on network error", async () => {
      mockHttp.get.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      await expect(
        findAccountByEmail(accountsDeps, "a@b.com")
      ).rejects.toThrow("ETIMEDOUT");
    });
  });

  describe("getAccountOrders", () => {
    it("fetches account then orders by email", async () => {
      const account = { id: "acc-1", email: "a@b.com" };
      const orders = [{ id: "ord-1" }];
      mockHttp.get
        .mockResolvedValueOnce({ data: account })
        .mockResolvedValueOnce({ data: { orders } });
      const result = await getAccountOrders(
        accountsDeps,
        ordersDeps,
        "acc-1"
      );
      expect(result).toEqual(orders);
      expect(mockHttp.get).toHaveBeenNthCalledWith(1, "/accounts/acc-1");
      expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/orders", {
        params: { email: "a@b.com" },
      });
    });

    it("returns empty array when account has no email", async () => {
      mockHttp.get.mockResolvedValueOnce({
        data: { id: "acc-1", email: undefined },
      });
      const result = await getAccountOrders(
        accountsDeps,
        ordersDeps,
        "acc-1"
      );
      expect(result).toEqual([]);
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });

    it("throws when account fetch fails", async () => {
      mockHttp.get.mockRejectedValueOnce(new FastSpringError("Not found", 404));
      await expect(
        getAccountOrders(accountsDeps, ordersDeps, "missing")
      ).rejects.toThrow(FastSpringError);
    });
  });
});
