import { SetMetadata } from '@nestjs/common';

export const ACCOUNT_ROUTE = 'fld:account-route';

/**
 * Marks routes about the account rather than the current tenant (sign-in, /me, switching
 * tenants), which work whichever tenant the browser tab last saw.
 */
export const AccountRoute = () => SetMetadata(ACCOUNT_ROUTE, true);
