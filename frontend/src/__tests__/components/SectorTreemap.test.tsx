import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectorTreemap } from '@/components/dashboard/SectorTreemap';

// jsdom does not implement ResizeObserver — provide a no-op stub
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const sectors = [
  { sector: 'Technology', change_pct: 1.2, ytd_pct: 8.5, leader: 'AAPL', leader_change_pct: 2.1 },
  { sector: 'Healthcare', change_pct: 0.8, ytd_pct: 3.2, leader: 'UNH', leader_change_pct: 1.4 },
  { sector: 'Financials', change_pct: 0.3, ytd_pct: 5.1, leader: 'JPM', leader_change_pct: 0.7 },
  { sector: 'Energy', change_pct: -0.5, ytd_pct: -2.3, leader: 'XOM', leader_change_pct: -0.8 },
  { sector: 'Utilities', change_pct: -0.3, ytd_pct: 1.1, leader: 'NEE', leader_change_pct: -0.1 },
];

const sectorsBasic = [
  { sector: 'Technology', change_pct: 1.2 },
  { sector: 'Healthcare', change_pct: 0.8 },
  { sector: 'Financials', change_pct: 0.3 },
  { sector: 'Energy', change_pct: -0.5 },
  { sector: 'Utilities', change_pct: -0.3 },
];

describe('SectorTreemap component', () => {
  // ─── Empty state ─────────────────────────────────────────────

  it('shows "No sector data" when sectors array is empty', () => {
    render(<SectorTreemap sectors={[]} height={160} />);
    expect(screen.getByText('No sector data')).toBeDefined();
  });

  it('renders no rectangles when sectors array is empty', () => {
    const { container } = render(<SectorTreemap sectors={[]} height={160} />);
    expect(container.querySelectorAll('.absolute').length).toBe(0);
  });

  // ─── Layout: one rect per sector ─────────────────────────────

  it('renders one tile per sector', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={200} />,
    );
    // Each sector gets an .absolute tile div
    const rects = container.querySelectorAll('.absolute');
    expect(rects.length).toBe(sectors.length);
  });

  it('renders a single rect for a single-sector list', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Tech', change_pct: 1.0 }]}
        width={400}
        height={200}
      />,
    );
    expect(container.querySelectorAll('.absolute').length).toBe(1);
  });

  it('renders a container div with the requested height', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={400} height={150} />,
    );
    // The outer relative div has style={{ height }}
    const outer = container.querySelector('.relative');
    expect(outer).not.toBeNull();
    expect((outer as HTMLElement).style.height).toBe('150px');
  });

  // ─── Title row ─────────────────────────────────────────────────

  it('renders "Sector Performance" heading', () => {
    render(<SectorTreemap sectors={sectors} width={600} height={200} />);
    expect(screen.getByText('Sector Performance')).toBeDefined();
  });

  it('shows Daily/YTD toggle when YTD data is available', () => {
    render(<SectorTreemap sectors={sectors} width={600} height={200} />);
    expect(screen.getByText('Daily')).toBeDefined();
    expect(screen.getByText('YTD')).toBeDefined();
  });

  it('hides Daily/YTD toggle when no YTD data', () => {
    render(<SectorTreemap sectors={sectorsBasic} width={600} height={200} />);
    expect(screen.queryByText('Daily')).toBeNull();
    expect(screen.queryByText('YTD')).toBeNull();
  });

  // ─── Text rendering ──────────────────────────────────────────

  it('shows sector names in wide-enough container', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    expect(container.textContent).toContain('Technology');
  });

  it('shows change percentages with sign for positive values', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    expect(container.textContent).toContain('+1.2%');
  });

  it('shows negative change percentages without + sign', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    expect(container.textContent).toContain('-0.5%');
  });

  // ─── Color coding (Tailwind classes) ─────────────────────────

  it('applies emerald-600 class for > +2% change', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Tech', change_pct: 2.5 }]}
        width={400}
        height={200}
      />,
    );
    const rect = container.querySelector('.absolute') as HTMLElement;
    expect(rect.className).toContain('bg-emerald-600');
  });

  it('applies red-600 class for < -2% change', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Energy', change_pct: -2.5 }]}
        width={400}
        height={200}
      />,
    );
    const rect = container.querySelector('.absolute') as HTMLElement;
    expect(rect.className).toContain('bg-red-600');
  });

  it('applies zinc-700 class for neutral changes', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Flat', change_pct: 0.1 }]}
        width={400}
        height={200}
      />,
    );
    const rect = container.querySelector('.absolute') as HTMLElement;
    expect(rect.className).toContain('bg-[var(--neutral)]');
  });

  // ─── Abbreviation map ─────────────────────────────────────────

  it('abbreviates "Consumer Discretionary" to "Cons Disc"', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Consumer Discretionary', change_pct: 0.5 }]}
        width={600}
        height={400}
      />,
    );
    expect(container.textContent).toContain('Cons Disc');
    expect(container.textContent).not.toContain('Consumer Discretionary');
  });

  it('abbreviates "Communication Services" to "Comm Svcs"', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Communication Services', change_pct: 0.5 }]}
        width={600}
        height={400}
      />,
    );
    expect(container.textContent).toContain('Comm Svcs');
  });

  it('leaves unrecognised sector names unchanged', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Materials', change_pct: 0.5 }]}
        width={600}
        height={400}
      />,
    );
    expect(container.textContent).toContain('Materials');
  });

  // ─── propWidth vs measured width ─────────────────────────────

  it('accepts an explicit width prop and renders without crash', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={300} height={160} />,
    );
    expect(container.querySelectorAll('.absolute').length).toBe(sectors.length);
  });

  // ─── Large set of sectors ─────────────────────────────────────

  it('handles 11 sectors without crashing', () => {
    const manySectors = Array.from({ length: 11 }, (_, i) => ({
      sector: `Sector${i}`,
      change_pct: i * 0.2 - 1,
    }));
    const { container } = render(
      <SectorTreemap sectors={manySectors} width={600} height={300} />,
    );
    expect(container.querySelectorAll('.absolute').length).toBe(11);
  });

  // ─── YTD + leader data rendering ─────────────────────────────

  it('shows YTD data in large tiles', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Technology', change_pct: 1.2, ytd_pct: 8.5, leader: 'AAPL' }]}
        width={600}
        height={400}
      />,
    );
    expect(container.textContent).toContain('YTD');
    expect(container.textContent).toContain('+8.5%');
  });

  it('shows leader stock name in large tiles', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Technology', change_pct: 1.2, ytd_pct: 8.5, leader: 'AAPL' }]}
        width={600}
        height={400}
      />,
    );
    expect(container.textContent).toContain('AAPL');
  });
});
