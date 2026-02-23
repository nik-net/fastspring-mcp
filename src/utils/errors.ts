/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * Typed error for FastSpring API failures.
 * Includes HTTP status and response body for debugging.
 */
export class FastSpringError extends Error {
  readonly statusCode: number;
  readonly responseBody: unknown;

  constructor(
    message: string,
    statusCode: number,
    responseBody: unknown = undefined
  ) {
    super(message);
    this.name = "FastSpringError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, FastSpringError.prototype);
  }

  override toString(): string {
    const bodyStr =
      this.responseBody !== undefined
        ? ` Response: ${JSON.stringify(this.responseBody)}`
        : "";
    return `FastSpringError ${this.statusCode}: ${this.message}${bodyStr}`;
  }
}
