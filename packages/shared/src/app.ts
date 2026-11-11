import { z } from 'zod';

/**
 * What the product is called until the platform settings name it. A project built on this one
 * renames itself here.
 */
export const DEFAULT_APP_NAME = 'Admin Dashboard';

export const APP_NAME_MAX_LENGTH = 30;

/**
 * What every page shows of the site, signed in or not: anyone may read it. A request may name the
 * tenant the browser works in (`?tenant=`), for what tenants come to set for themselves. So far
 * the platform settings say it all, whichever the tenant.
 */
export const siteSchema = z.object({
  /** The product's name. */
  name: z.string(),
});
export type Site = z.infer<typeof siteSchema>;
