import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory must not reference external variables;
// we store the spy inside the mock factory and then retrieve it.
vi.mock('@tanstack/react-query', () => {
  const spy = vi.fn().mockReturnValue({ data: null, isLoading: true, error: null });
  return {
    useQuery: spy,
  };
});

vi.mock('@/lib/api', () => ({
  getContractSnapshot: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import { useContractSnapshot } from '@/hooks/useContractSnapshot';

const mockUseQuery = vi.mocked(useQuery);

describe('useContractSnapshot', () => {
  beforeEach(() => {
    mockUseQuery.mockClear();
  });

  it('disables the query when occSymbol is null', () => {
    useContractSnapshot(null);
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });

  it('enables the query when occSymbol is provided', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
    );
  });

  it('uses 2-second refetchInterval', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: 2000,
      }),
    );
  });

  it('uses 1.5-second staleTime so back-to-back remounts coalesce', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        staleTime: 1500,
      }),
    );
  });

  it('uses 10-second gcTime so the last quote stays warm for a quick reopen', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        gcTime: 10000,
      }),
    );
  });

  it('retries once on error', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        retry: 1,
      }),
    );
  });

  it('threads occSymbol into the queryKey for cache isolation', () => {
    useContractSnapshot('NVDA260425C00205000');
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['contract-snapshot', 'NVDA260425C00205000'],
      }),
    );
  });

  it('null occSymbol still threads through queryKey so React Query gc partitions cleanly', () => {
    useContractSnapshot(null);
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['contract-snapshot', null],
      }),
    );
  });
});
