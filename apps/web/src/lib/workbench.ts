import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { z } from 'zod';

export const WORKBENCH_CARDS = ['permissions', 'service-status', 'recent-files'] as const;
export type WorkbenchCardId = (typeof WORKBENCH_CARDS)[number];

/** Small takes a third of a wide screen, medium two thirds and large all of it. */
export const CARD_SIZES = ['sm', 'md', 'lg'] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export type WorkbenchCard = { id: WorkbenchCardId; size: CardSize };
/** The cards shown, in order. Cards left out are hidden. */
export type WorkbenchLayout = WorkbenchCard[];

export const DEFAULT_LAYOUT: WorkbenchLayout = [
  { id: 'permissions', size: 'md' },
  { id: 'service-status', size: 'sm' },
  { id: 'recent-files', size: 'lg' },
];

const storedLayoutSchema = z.array(z.object({ id: z.string(), size: z.enum(CARD_SIZES) }));

function isCardId(id: string): id is WorkbenchCardId {
  return (WORKBENCH_CARDS as readonly string[]).includes(id);
}

/** The stored layout without cards this version doesn't have, or null when it can't be read. */
function parseLayout(raw: string | null): WorkbenchLayout | null {
  if (raw === null) {
    return null;
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedLayoutSchema.safeParse(stored);
  if (!parsed.success) {
    return null;
  }
  const layout: WorkbenchLayout = [];
  for (const { id, size } of parsed.data) {
    if (isCardId(id) && !layout.some((card) => card.id === id)) {
      layout.push({ id, size });
    }
  }
  return layout;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * The account's workbench in the current tenant, kept in this browser like the theme. Saving null
 * goes back to the default layout, following it when it changes.
 */
export function useWorkbenchLayout(userId: string, tenantId: string) {
  const key = `workbench:${userId}:${tenantId}`;
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(key));
  const layout = useMemo(() => parseLayout(raw) ?? DEFAULT_LAYOUT, [raw]);
  const save = useCallback(
    (next: WorkbenchLayout | null) => {
      if (next) {
        localStorage.setItem(key, JSON.stringify(next));
      } else {
        localStorage.removeItem(key);
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  return [layout, save] as const;
}
