import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory must not reference external variables;
// we store the spy inside the mock factory and then retrieve it.
vi.mock('@tanstack/react-query', () => {
  const spy = vi.fn().mockReturnValue({ data: null, isLoading: true, error: null });
  return {
    useQuery: spy,
    __mockUseQuery: spy,
  };
});

// Now import the spy via the module
import { __mockUseQuery as mockUseQuery } from '@tanstack/react-query';
import { useRegime, useIndices, useStrategies, usePortfolioSummary, usePipelineStatus } from '@/hooks/useQueries';

describe('useQueries hooks', () => {
  beforeEach(() => {
    (mockUseQuery as ReturnType<typeof vi.fn>).mockClear();
  });

  it('useRegime has correct queryKey and staleTime', () => {
    useRegime();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['regime'],
      staleTime: 5 * 60 * 1000,
    }));
  });

  it('useRegime has retry: 2', () => {
    useRegime();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      retry: 2,
    }));
  });

  it('useRegime has refetchInterval of 5 minutes', () => {
    useRegime();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      refetchInterval: 5 * 60 * 1000,
    }));
  });

  it('useIndices has correct queryKey', () => {
    useIndices();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['indices'],
    }));
  });

  it('useIndices has staleTime of 1 minute', () => {
    useIndices();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      staleTime: 60 * 1000,
    }));
  });

  it('useIndices has retry: 2', () => {
    useIndices();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      retry: 2,
    }));
  });

  it('useStrategies has correct queryKey', () => {
    useStrategies();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['strategies'],
    }));
  });

  it('useStrategies has staleTime of 1 minute', () => {
    useStrategies();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      staleTime: 60 * 1000,
    }));
  });

  it('useStrategies has retry: 2', () => {
    useStrategies();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      retry: 2,
    }));
  });

  it('useStrategies has refetchInterval of 5 minutes', () => {
    useStrategies();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      refetchInterval: 5 * 60 * 1000,
    }));
  });

  it('usePortfolioSummary has correct queryKey', () => {
    usePortfolioSummary();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['portfolioSummary'],
    }));
  });

  it('usePortfolioSummary has staleTime of 30 seconds', () => {
    usePortfolioSummary();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      staleTime: 30 * 1000,
    }));
  });

  it('usePortfolioSummary has retry: 2', () => {
    usePortfolioSummary();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      retry: 2,
    }));
  });

  it('usePipelineStatus has correct queryKey', () => {
    usePipelineStatus();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['pipelineStatus'],
    }));
  });

  it('usePipelineStatus has staleTime of 30 seconds', () => {
    usePipelineStatus();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      staleTime: 30 * 1000,
    }));
  });

  it('usePipelineStatus has retry: 2', () => {
    usePipelineStatus();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      retry: 2,
    }));
  });

  it('each hook has a unique queryKey', () => {
    const hooks = [useRegime, useIndices, useStrategies, usePortfolioSummary, usePipelineStatus];
    const keys: string[][] = [];
    hooks.forEach((hook) => {
      (mockUseQuery as ReturnType<typeof vi.fn>).mockClear();
      hook();
      keys.push((mockUseQuery as ReturnType<typeof vi.fn>).mock.calls[0][0].queryKey);
    });
    const uniqueKeys = new Set(keys.map((k) => JSON.stringify(k)));
    expect(uniqueKeys.size).toBe(5);
  });

  it('each hook provides a queryFn', () => {
    const hooks = [useRegime, useIndices, useStrategies, usePortfolioSummary, usePipelineStatus];
    hooks.forEach((hook) => {
      (mockUseQuery as ReturnType<typeof vi.fn>).mockClear();
      hook();
      expect(typeof (mockUseQuery as ReturnType<typeof vi.fn>).mock.calls[0][0].queryFn).toBe('function');
    });
  });
});
