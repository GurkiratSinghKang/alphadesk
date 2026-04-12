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

  it('throws when used outside ToastProvider', async () => {
    const { useToast } = await import('@/hooks/useToast');
    expect(() => {
      renderHook(() => useToast());
    }).toThrow('useToast must be used within ToastProvider');
  });
});
