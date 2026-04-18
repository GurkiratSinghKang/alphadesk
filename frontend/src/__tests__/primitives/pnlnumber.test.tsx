import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PnLNumber from '@/components/primitives/PnLNumber';

describe('PnLNumber', () => {
  it('renders positive currency with leading +', () => {
    const { container } = render(<PnLNumber value={1602} format="currency" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toMatch(/^\+/);
    expect(el.textContent).toContain('1,602');
  });

  it('renders negative currency with leading -', () => {
    const { container } = render(<PnLNumber value={-258} format="currency" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toMatch(/^-/);
    expect(el.textContent).toContain('258');
  });

  it('colors positive values with text-profit', () => {
    const { container } = render(<PnLNumber value={100} format="currency" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.className).toContain('text-profit');
  });

  it('colors negative values with text-loss', () => {
    const { container } = render(<PnLNumber value={-42} format="percent" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.className).toContain('text-loss');
  });

  it('colors zero with text-fg-muted', () => {
    const { container } = render(<PnLNumber value={0} format="currency" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.className).toContain('text-fg-muted');
  });

  it('renders percent values with % suffix', () => {
    const { container } = render(<PnLNumber value={-1.1} format="percent" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toContain('%');
    expect(el.textContent).toContain('1.1');
  });

  it('renders bps values with bps suffix', () => {
    const { container } = render(<PnLNumber value={24.38} format="bps" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toContain('bps');
    expect(el.textContent).toContain('24.38');
  });

  it('abbreviates currency to M for millions', () => {
    const { container } = render(
      <PnLNumber value={1500000} format="currency" abbreviate />,
    );
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toContain('1.5M');
  });

  it('abbreviates currency to K for thousands', () => {
    const { container } = render(
      <PnLNumber value={24381} format="currency" abbreviate />,
    );
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toContain('24.4K');
  });

  it('abbreviates currency to B for billions', () => {
    const { container } = render(
      <PnLNumber value={2800000000} format="currency" abbreviate />,
    );
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).toContain('2.8B');
  });

  it('omits sign when showSign is false', () => {
    const { container } = render(
      <PnLNumber value={100} format="currency" showSign={false} />,
    );
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.textContent).not.toMatch(/^\+/);
  });

  it('uses mono + tabular-nums class', () => {
    const { container } = render(<PnLNumber value={1} format="currency" />);
    const el = container.querySelector('[data-slot="pnl-number"]') as HTMLElement;
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('tabular-nums');
  });
});
