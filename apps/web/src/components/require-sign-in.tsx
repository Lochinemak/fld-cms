import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { meQuery, reloadToSignIn } from '@/lib/auth';

/**
 * Renders its children only while signed in, so `useMe()` below it always has a user. Once a
 * refetch finds the session gone, it sends the user to sign in again.
 */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { data: me } = useSuspenseQuery(meQuery);

  useEffect(() => {
    if (!me) {
      reloadToSignIn();
    }
  }, [me]);

  return me ? children : null;
}
