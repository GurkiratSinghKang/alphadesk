import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RegimePill from '@/components/primitives/RegimePill';

describe('RegimePill', () => {
  it('renders with data-slot="regime-pill"', () => {
    const { container } = render(<RegimePill regime="bull" vol="low" />);
    const el = container.querySelector('[data-slot="regime-pill"]');
    expect(el).not.toBeNull();
  });

  it('bull regime resolves to ice tone', () => {
    const { container } = render(<RegimePill regime="bull" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('ice');
  });

  it('bear regime resolves to wine tone', () => {
    const { container } = render(<RegimePill regime="bear" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('wine');
  });

  it('crisis regime resolves to wine tone', () => {
    const { container } = render(<RegimePill regime="crisis" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('wine');
  });

  it('neutral + elevated vol resolves to amber tone', () => {
    const { container } = render(<RegimePill regime="neutral" vol="elevated" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('amber');
  });

  it('neutral + low vol resolves to ice tone', () => {
    const { container } = render(<RegimePill regime="neutral" vol="low" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('ice');
  });

  it('renders a StatusDot matching the tone', () => {
    const { container } = render(<RegimePill regime="bull" vol="low" />);
    const dot = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('data-tone')).toBe('ice');
  });

  it('renders default label for bull + low', () => {
    const { container } = render(<RegimePill regime="bull" vol="low" />);
    expect(container.textContent).toContain('bull');
    expect(container.textContent).toContain('low volatility');
  });

  it('uses italic serif typography', () => {
    const { container } = render(<RegimePill regime="bull" />);
    const el = container.querySelector('[data-slot="regime-pill"]') as HTMLElement;
    expect(el.className).toContain('font-display');
    expect(el.className).toContain('italic');
  });

  it('override label renders as-is', () => {
    const { container } = render(
      <RegimePill regime="bull" label="custom regime copy" />,
    );
    expect(container.textContent).toContain('custom regime copy');
  });
});
