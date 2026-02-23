/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

/**
 * FastSpring Accounts API response types.
 * Aligned with https://developer.fastspring.com/reference/accounts
 */

export interface FastSpringAccount {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  created?: number;
  changed?: number;
}

export interface FastSpringAccountsResponse {
  accounts: FastSpringAccount[];
}
