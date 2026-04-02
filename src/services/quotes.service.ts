/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import type { AxiosInstance } from "axios";
import type {
  CreateQuoteRequest,
  CreateQuoteResponse,
} from "../types/quotes.types.js";

export interface QuotesServiceDeps {
  http: AxiosInstance;
}

/**
 * Creates a new quote via POST /quotes.
 *
 * The returned `quoteUrl` is a permanent link to the FastSpring storefront
 * where the buyer can review line items, see VAT/tax breakdown, and complete
 * payment. The quote is visible in the FastSpring dashboard immediately after
 * creation.
 */
export async function createQuote(
  deps: QuotesServiceDeps,
  request: CreateQuoteRequest
): Promise<CreateQuoteResponse> {
  try {
    const response = await deps.http.post<CreateQuoteResponse>(
      "/quotes",
      request
    );
    const result = response.data;
    return result;
  } catch (error) {
    throw error;
  }
}
