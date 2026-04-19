import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';
import { useAlertsStore } from '@/stores/alerts';
import type { ReactNode } from 'react';

// Do NOT import setup-mocks here -- we want to test the real useToast, not the mock
// But we do need ResizeObserver
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

function ToastWrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useToast (real implementation)', () => {
  it('returns toast and dismiss functions when inside ToastProvider', async () => {
    // Import the real (unmocked) useToast
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast(), { wrapper: ToastWrapper });
    expect(typeof result.current.toast).toBe('function');
    expect(typeof result.current.dismiss).toBe('function');
  });

  it('toast function is callable and returns an id', async () => {
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast(), { wrapper: ToastWrapper });
    const id = result.current.toast({ type: 'success', message: 'Test toast' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('toast adds an alert to the alerts store', async () => {
    useAlertsStore.setState({ alerts: [] });
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast(), { wrapper: ToastWrapper });
    result.current.toast({ type: 'info', message: 'Alert test' });
    const alerts = useAlertsStore.getState().alerts;
    expect(alerts.some((a) => a.message === 'Alert test')).toBe(true);
  });

  it('dismiss function is callable without throwing', async () => {
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast(), { wrapper: ToastWrapper });
    expect(() => result.current.dismiss('nonexistent-id')).not.toThrow();
  });

  it('returns a no-op toast when used outside ToastProvider', async () => {
    // Previously useToast threw between hook calls, which broke the
    // rules-of-hooks invariant and caused React error #310 when the
    // provider was briefly absent during hydration. It now returns
    // a warn-and-no-op shim instead.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { useToast } = await import('@/hooks/useToast');
    const { result } = renderHook(() => useToast());
    expect(result.current.toast({ type: 'info', message: 'x' })).toBe('');
    expect(warnSpy).toHaveBeenCalled();
    expect(() => result.current.dismiss('whatever')).not.toThrow();
    warnSpy.mockRestore();
  });
});
