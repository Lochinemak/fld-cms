import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

/** Renders with a query client of its own, which never retries: a failure shows at once. */
export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

type Handler = (request: { json: unknown }) => unknown;

/**
 * Stands in for the API: `routes` answers by method and path, as in
 * `{ 'GET /api/preferences/tables/crm.customer': () => ({ columns: {}, sort: null }) }`. A
 * handler may throw a Response to refuse. Returns the requests made, in order.
 */
export function stubApi(routes: Record<string, Handler>) {
  const requests: { method: string; path: string; json: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(input);
      const json: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, json });
      const handler = routes[`${method} ${path}`];
      if (!handler) {
        return Response.json({ message: `No stub for ${method} ${path}` }, { status: 404 });
      }
      try {
        return Response.json(handler({ json }) ?? null);
      } catch (refusal) {
        if (refusal instanceof Response) {
          return refusal;
        }
        throw refusal;
      }
    }),
  );
  return requests;
}
