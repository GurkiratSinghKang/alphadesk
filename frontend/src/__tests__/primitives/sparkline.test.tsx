import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Sparkline from '@/components/primitives/Sparkline';

describe('Sparkline primitive', () => {
  it('returns null for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('returns null for single-point data', () => {
    const { container } = render(<Sparkline data={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('returns null for flat data (no range)', () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders an svg for 2+ points with range', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a polyline, no polygon, no fill', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('defaults to 200x28 viewport', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('28');
  });

  it('honours custom width/height', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} width={80} height={24} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('80');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('stroke matches profit var for profit tone', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="profit" />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke')).toBe('var(--profit)');
  });

  it('stroke matches loss var for loss tone', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="loss" />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke')).toBe('var(--loss)');
  });

  it('defaults to brand stroke', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke')).toBe('var(--brand)');
  });

  it('sets stroke-width default to 1.5', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke-width')).toBe('1.5');
  });

  it('point count matches data length', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} width={100} height={30} />,
    );
    const points = container
      .querySelector('polyline')
      ?.getAttribute('points')
      ?.trim()
      .split(' ') ?? [];
    expect(points.length).toBe(5);
  });
});
