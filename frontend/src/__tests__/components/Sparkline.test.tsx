import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '@/components/dashboard/Sparkline';

describe('Sparkline component', () => {
  // ─── Null / short-data guard ─────────────────────────────────

  it('returns null (empty container) for an empty data array', () => {
    const { container } = render(<Sparkline data={[]} color="#22c55e" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('returns null for a single data point', () => {
    const { container } = render(<Sparkline data={[42]} color="#22c55e" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  // ─── Minimum viable data (2 points) ─────────────────────────

  it('renders an SVG for exactly 2 data points', () => {
    const { container } = render(<Sparkline data={[1, 2]} color="#22c55e" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a polyline for the price series', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders a polygon for the gradient fill area', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  it('renders a linearGradient inside defs', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    expect(container.querySelector('defs')).not.toBeNull();
    expect(container.querySelector('linearGradient')).not.toBeNull();
  });

  // ─── Dimension props ──────────────────────────────────────────

  it('defaults to width=80 when no width prop given', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('80');
  });

  it('defaults to height=24 when no height prop given', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('applies custom width prop', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" width={200} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('200');
  });

  it('applies custom height prop', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" height={50} />);
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('50');
  });

  it('applies both custom width and height', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#22c55e" width={200} height={50} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('50');
  });

  // ─── className prop ───────────────────────────────────────────

  it('applies custom className to the SVG element', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#22c55e" className="w-full" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('w-full');
  });

  it('falls back to "shrink-0" class when className is omitted', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('shrink-0');
  });

  // ─── Polyline geometry ────────────────────────────────────────

  it('polyline points attribute is non-empty for 3 data points', () => {
    const { container } = render(<Sparkline data={[10, 20, 15]} color="#22c55e" />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('points')).toBeTruthy();
  });

  it('polyline points count matches data length', () => {
    const data = [10, 20, 15, 25, 18];
    const { container } = render(<Sparkline data={data} color="#22c55e" width={100} height={30} />);
    const polyline = container.querySelector('polyline');
    const pointPairs = polyline?.getAttribute('points')?.trim().split(' ') ?? [];
    expect(pointPairs.length).toBe(data.length);
  });

  it('first polyline point starts at x=0', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} color="#22c55e" width={80} height={24} />,
    );
    const polyline = container.querySelector('polyline');
    const firstPoint = polyline?.getAttribute('points')?.trim().split(' ')[0] ?? '';
    const x = parseFloat(firstPoint.split(',')[0]);
    expect(x).toBeCloseTo(0, 5);
  });

  it('last polyline point ends at x=width', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} color="#22c55e" width={80} height={24} />,
    );
    const polyline = container.querySelector('polyline');
    const points = polyline?.getAttribute('points')?.trim().split(' ') ?? [];
    const lastPoint = points[points.length - 1];
    const x = parseFloat(lastPoint.split(',')[0]);
    expect(x).toBeCloseTo(80, 5);
  });

  // ─── Flat data (all-same values) ─────────────────────────────

  it('returns null for flat data (all identical values)', () => {
    const { container } = render(<Sparkline data={[5, 5, 5, 5, 5]} color="#22c55e" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  // ─── Color prop propagated to polyline stroke ─────────────────

  it('uses the color prop as the polyline stroke', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#ef4444" />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('#ef4444');
  });

  // ─── Large dataset ────────────────────────────────────────────

  it('renders without crashing for 100-point dataset', () => {
    const data = Array.from({ length: 100 }, (_, i) => Math.sin(i) * 100 + 100);
    const { container } = render(<Sparkline data={data} color="#22c55e" />);
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  // ─── Unique gradient ID per instance ─────────────────────────

  it('generates a gradient id on the linearGradient element', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    const grad = container.querySelector('linearGradient');
    expect(grad?.getAttribute('id')).toBeTruthy();
  });

  it('polygon fill attribute references the gradient id', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#22c55e" />);
    const grad = container.querySelector('linearGradient');
    const gradId = grad?.getAttribute('id') ?? '';
    const polygon = container.querySelector('polygon');
    expect(polygon?.getAttribute('fill')).toBe(`url(#${gradId})`);
  });
});
