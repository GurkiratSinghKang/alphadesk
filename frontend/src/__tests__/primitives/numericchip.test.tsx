import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NumericChip from '@/components/primitives/NumericChip';

describe('NumericChip', () => {
  it('renders a span with data-slot="numeric-chip"', () => {
    const { container } = render(<NumericChip label="Sharpe" value="1.08" />);
    const el = container.querySelector('[data-slot="numeric-chip"]');
    expect(el).not.toBeNull();
  });

  it('renders label and value text', () => {
    const { container } = render(<NumericChip label="Sharpe" value="1.08" />);
    expect(container.textContent).toContain('Sharpe');
    expect(container.textContent).toContain('1.08');
  });

  it('defaults to muted tone', () => {
    const { container } = render(<NumericChip label="Beta" value="0.62" />);
    const el = container.querySelector('[data-slot="numeric-chip"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('muted');
  });

  it('profit tone colors the value with text-profit', () => {
    const { container } = render(
      <NumericChip label="P&L" value="+$24,381" tone="profit" />,
    );
    const el = container.querySelector('[data-slot="numeric-chip"]') as HTMLElement;
    expect(el.className).toContain('text-profit');
    expect(el.getAttribute('data-tone')).toBe('profit');
  });

  it('loss tone colors the value with text-loss', () => {
    const { container } = render(
      <NumericChip label="DD" value="-3.8%" tone="loss" />,
    );
    const el = container.querySelector('[data-slot="numeric-chip"]') as HTMLElement;
    expect(el.className).toContain('text-loss');
  });

  it('uses mono body font', () => {
    const { container } = render(<NumericChip label="Positions" value={12} />);
    const el = container.querySelector('[data-slot="numeric-chip"]') as HTMLElement;
    expect(el.className).toContain('font-mono');
  });

  it('accepts numeric value directly', () => {
    const { container } = render(<NumericChip label="Positions" value={12} />);
    expect(container.textContent).toContain('12');
  });

  it('is rendered as a pill (rounded-pill)', () => {
    const { container } = render(<NumericChip label="Beta" value="0.62" />);
    const el = container.querySelector('[data-slot="numeric-chip"]') as HTMLElement;
    expect(el.className).toContain('rounded-pill');
  });
});
