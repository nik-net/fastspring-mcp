/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { describe, it, expect } from "vitest";
import { FastSpringError } from "../../src/utils/errors.js";

describe("FastSpringError", () => {
  it("sets name, message, statusCode, and responseBody", () => {
    const err = new FastSpringError("Not found", 404, { detail: "Order missing" });
    expect(err.name).toBe("FastSpringError");
    expect(err.message).toBe("Not found");
    expect(err.statusCode).toBe(404);
    expect(err.responseBody).toEqual({ detail: "Order missing" });
  });

  it("toString includes status and message", () => {
    const err = new FastSpringError("Unauthorized", 401);
    const str = err.toString();
    expect(str).toContain("401");
    expect(str).toContain("Unauthorized");
  });
});
