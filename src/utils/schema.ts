/**
 * @license
 * This software is licensed under AGPL v3. For commercial licensing, see COMMERCIAL_LICENSE.md.
 */

import { z } from "zod";

/** Optional string that trims when present; empty string becomes undefined. */
export const optionalTrimmedString = () =>
  z
    .string()
    .optional()
    .transform((s) => (s === undefined || s === "" ? undefined : (s as string).trim()));
