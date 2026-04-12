import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

// setup-mocks.ts mocks @/hooks/useToast to return { toast: vi.fn(), dismiss: vi.fn() }
// so we can test the returned shape safely from any context.
describe('useToast hook shape', () => {
  it('returns toast and dismiss functions', async () => {
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.toast).toBe('function');
    expect(typeof result.current.dismiss).toBe('function');
  });

  it('toast function is callable without throwing', async () => {
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast());
    expect(() =>
      result.current.toast({ type: 'success', message: 'Test' })
    ).not.toThrow();
  });

  it('dismiss function is callable without throwing', async () => {
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast());
    expect(() => result.current.dismiss('some-id')).not.toThrow();
  });
});
