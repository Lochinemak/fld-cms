import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, useWorkbenchLayout } from './workbench';

const KEY = 'workbench:7:3';

describe('useWorkbenchLayout', () => {
  it('starts from the default layout', () => {
    const { result } = renderHook(() => useWorkbenchLayout('7', '3'));
    expect(result.current[0]).toEqual(DEFAULT_LAYOUT);
  });

  it('saves a layout for this account in this tenant, and shows it at once', () => {
    const { result } = renderHook(() => useWorkbenchLayout('7', '3'));
    act(() => result.current[1]([{ id: 'recent-files', size: 'sm' }]));

    expect(result.current[0]).toEqual([{ id: 'recent-files', size: 'sm' }]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([{ id: 'recent-files', size: 'sm' }]);
    // Another tenant of the same account keeps its own.
    expect(renderHook(() => useWorkbenchLayout('7', '4')).result.current[0]).toEqual(
      DEFAULT_LAYOUT,
    );
  });

  it('goes back to the default when the saved layout is cleared', () => {
    const { result } = renderHook(() => useWorkbenchLayout('7', '3'));
    act(() => result.current[1]([]));
    expect(result.current[0]).toEqual([]);
    act(() => result.current[1](null));
    expect(result.current[0]).toEqual(DEFAULT_LAYOUT);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('drops cards it does not know and repeats, and ignores what it cannot read', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'service-status', size: 'lg' },
        { id: 'retired-card', size: 'sm' },
        { id: 'service-status', size: 'sm' },
      ]),
    );
    expect(renderHook(() => useWorkbenchLayout('7', '3')).result.current[0]).toEqual([
      { id: 'service-status', size: 'lg' },
    ]);

    for (const broken of [
      'not json',
      '{"id":"permissions"}',
      '[{"id":"permissions","size":"xl"}]',
    ]) {
      localStorage.setItem(KEY, broken);
      expect(renderHook(() => useWorkbenchLayout('7', '3')).result.current[0]).toEqual(
        DEFAULT_LAYOUT,
      );
    }
  });
});
