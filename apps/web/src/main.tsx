import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError, needsMfa } from '@/lib/api';
import { meQuery, reloadToSignIn } from '@/lib/auth';
import './i18n';
import './index.css';
import { routeTree } from './routeTree.gen';

function onApiError(error: unknown) {
  // A 401 while signed in: the session ended elsewhere (expired, signed out, password reset). Not
  // one asking for the second step, which the page that asked explains.
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    !needsMfa(error) &&
    queryClient.getQueryData(meQuery.queryKey)
  ) {
    reloadToSignIn();
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 3,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
