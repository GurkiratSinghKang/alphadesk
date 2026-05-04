import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TouchTarget from '@/components/primitives/TouchTarget';

describe('TouchTarget', () => {
  it('renders a div wrapper with data-slot="touch-target"', () => {
    const { container } = render(
      <TouchTarget>
        <span>x</span>
      </TouchTarget>,
    );
    const el = container.querySelector('[data-slot="touch-target"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('DIV');
  });

  it('applies the min-h-touch / min-w-touch tap-floor utilities', () => {
    const { container } = render(<TouchTarget>x</TouchTarget>);
    const el = container.querySelector(
      '[data-slot="touch-target"]',
    ) as HTMLElement;
    expect(el.className).toContain('min-h-touch');
    expect(el.className).toContain('min-w-touch');
  });

  it('inline-flex centers its child', () => {
    const { container } = render(<TouchTarget>x</TouchTarget>);
    const el = container.querySelector(
      '[data-slot="touch-target"]',
    ) as HTMLElement;
    expect(el.className).toContain('inline-flex');
    expect(el.className).toContain('items-center');
    expect(el.className).toContain('justify-center');
  });

  it('forwards arbitrary className onto the wrapper', () => {
    const { container } = render(
      <TouchTarget className="extra-class-x">x</TouchTarget>,
    );
    const el = container.querySelector(
      '[data-slot="touch-target"]',
    ) as HTMLElement;
    expect(el.className).toContain('extra-class-x');
  });

  it('with asChild merges floor classes onto the only child element', () => {
    const { container } = render(
      <TouchTarget asChild>
        <button type="button" className="rounded">
          ok
        </button>
      </TouchTarget>,
    );
    // The wrapper div should NOT exist; the button itself should carry
    // both its own class and the touch-floor classes.
    expect(container.querySelector('div[data-slot="touch-target"]')).toBeNull();
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.className).toContain('min-h-touch');
    expect(btn.className).toContain('min-w-touch');
    expect(btn.className).toContain('rounded');
    expect(btn.getAttribute('data-slot')).toBe('touch-target');
  });
});
