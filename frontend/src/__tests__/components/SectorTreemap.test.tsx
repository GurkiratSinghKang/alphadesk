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
  { sector: 'Technology', change_pct: 1.2 },
  { sector: 'Healthcare', change_pct: 0.8 },
  { sector: 'Financials', change_pct: 0.3 },
  { sector: 'Energy', change_pct: -0.5 },
  { sector: 'Utilities', change_pct: -0.3 },
];

describe('SectorTreemap component', () => {
  // ─── Empty state ─────────────────────────────────────────────

  it('shows "No sector data" when sectors array is empty', () => {
    render(<SectorTreemap sectors={[]} height={120} />);
    expect(screen.getByText('No sector data')).toBeDefined();
  });

  it('renders no rectangles when sectors array is empty', () => {
    const { container } = render(<SectorTreemap sectors={[]} height={120} />);
    expect(container.querySelectorAll('.absolute').length).toBe(0);
  });

  // ─── Layout: one rect per sector ─────────────────────────────

  it('renders one .absolute div per sector', () => {
    // propWidth supplied so squarify gets a fixed known width (no ResizeObserver needed)
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={200} />,
    );
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

  // ─── Text rendering (showText gate: w > 45 && h > 30) ────────

  it('shows sector names in wide-enough container', () => {
    // 600×400 gives each of the 5 equal-weight sectors ample space
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    // Technology should be visible with a wide rect
    expect(container.textContent).toContain('Technology');
  });

  it('shows change percentages with sign for positive values', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    // Technology +1.2%
    expect(container.textContent).toContain('+1.2%');
  });

  it('shows negative change percentages without + sign', () => {
    const { container } = render(
      <SectorTreemap sectors={sectors} width={600} height={400} />,
    );
    // Energy -0.5%
    expect(container.textContent).toContain('-0.5%');
  });

  // ─── Color coding (backgroundColor) ──────────────────────────

  it('applies green background style for positive sectors', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Tech', change_pct: 1.5 }]}
        width={400}
        height={200}
      />,
    );
    const rect = container.querySelector('.absolute') as HTMLElement;
    // change_pct > 1 → rgba(34,197,94,0.7)
    expect(rect.style.backgroundColor).toBe('rgba(34, 197, 94, 0.7)');
  });

  it('applies red background style for negative sectors', () => {
    const { container } = render(
      <SectorTreemap
        sectors={[{ sector: 'Energy', change_pct: -1.5 }]}
        width={400}
        height={200}
      />,
    );
    const rect = container.querySelector('.absolute') as HTMLElement;
    // change_pct < -1 → rgba(239,68,68,0.7)
    expect(rect.style.backgroundColor).toBe('rgba(239, 68, 68, 0.7)');
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
      <SectorTreemap sectors={sectors} width={300} height={120} />,
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
});
