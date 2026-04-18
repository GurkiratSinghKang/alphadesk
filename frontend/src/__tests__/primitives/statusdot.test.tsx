import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StatusDot from '@/components/primitives/StatusDot';

describe('StatusDot', () => {
  it('renders a single span with data-slot="status-dot"', () => {
    const { container } = render(<StatusDot tone="profit" />);
    const el = container.querySelector('[data-slot="status-dot"]');
    expect(el).not.toBeNull();
  });

  it('sets the tone data attribute', () => {
    const { container } = render(<StatusDot tone="loss" />);
    const el = container.querySelector('[data-slot="status-dot"]');
    expect(el?.getAttribute('data-tone')).toBe('loss');
  });

  it('applies the bg class matching the tone', () => {
    const { container } = render(<StatusDot tone="brand" />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).toContain('bg-brand');
  });

  it('does not add animate-pulse by default', () => {
    const { container } = render(<StatusDot tone="profit" />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).not.toContain('animate-pulse');
  });

  it('adds animate-pulse when pulse is true', () => {
    const { container } = render(<StatusDot tone="loss" pulse />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).toContain('animate-pulse');
    expect(el.getAttribute('data-pulse')).toBe('on');
  });

  it('defaults to size 8 (h-2 w-2)', () => {
    const { container } = render(<StatusDot tone="ice" />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).toContain('h-2');
    expect(el.className).toContain('w-2');
  });

  it('applies the 5px size', () => {
    const { container } = render(<StatusDot tone="muted" size={5} />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).toContain('h-[5px]');
    expect(el.className).toContain('w-[5px]');
  });

  it('does not add a glow shadow class for muted tone', () => {
    const { container } = render(<StatusDot tone="muted" />);
    const el = container.querySelector('[data-slot="status-dot"]') as HTMLElement;
    expect(el.className).not.toContain('shadow-');
  });

  it('is aria-hidden', () => {
    const { container } = render(<StatusDot tone="profit" />);
    const el = container.querySelector('[data-slot="status-dot"]');
    expect(el?.getAttribute('aria-hidden')).not.toBeNull();
  });
});
