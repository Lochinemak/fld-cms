import { DEFAULT_APP_NAME, siteSchema } from '@fld/shared';
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { meQuery } from './auth';

/**
 * Keeps the product's name as this browser saw it last, which the pages show until the site has
 * answered. index.html reads it too, for the tab's title.
 */
const APP_NAME_KEY = 'app-name';

/** What every page shows of the site, asked for the tenant the browser works in. */
export const siteQuery = (tenantId: string | null) =>
  queryOptions({
    queryKey: ['site', tenantId],
    queryFn: async () => {
      const site = await api(tenantId ? `/site?tenant=${encodeURIComponent(tenantId)}` : '/site', {
        schema: siteSchema,
      });
      localStorage.setItem(APP_NAME_KEY, site.name);
      return site;
    },
  });

/** After the platform settings changed: the pages show the new name at once. */
export const refreshSite = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: ['site'] });

/**
 * The product's name, which the platform settings may change: a page open elsewhere picks the
 * change up when it is loaded or comes back into view.
 */
export function useAppName(): string {
  // Whoever is signed in, without asking: the pages that need a user ask.
  const { data: me } = useQuery({ ...meQuery, enabled: false });
  const { data: site } = useQuery(siteQuery(me?.tenant?.id ?? null));
  return site?.name ?? localStorage.getItem(APP_NAME_KEY) ?? DEFAULT_APP_NAME;
}
