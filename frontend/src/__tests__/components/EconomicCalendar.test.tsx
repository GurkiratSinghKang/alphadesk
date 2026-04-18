import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EconomicCalendar } from '@/components/dashboard/EconomicCalendar';

/**
 * After audit P0-6 landed, EconomicCalendar no longer fabricates forecast or
 * previous values. It renders an honest editorial empty state listing the
 * cadence of recurring events. These tests cover the shape of that state.
 */

describe('EconomicCalendar', () => {
  it('renders the header', () => {
    render(<EconomicCalendar />);
    expect(screen.getByText('Economic Calendar')).toBeDefined();
  });

  it('explains that the calendar is not configured', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('not configured');
  });

  it('lists the recurring event names it tracks', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    const knownEvents = [
      'FOMC Rate Decision',
      'Non-Farm Payrolls',
      'CPI',
      'GDP',
      'PCE',
      'Initial Jobless Claims',
    ];
    const foundCount = knownEvents.filter((name) => text.includes(name)).length;
    // Expect at least three of the recurring events surfaced.
    expect(foundCount).toBeGreaterThanOrEqual(3);
  });

  it('does not invent forecast or previous numbers', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Fcst:/);
    expect(text).not.toMatch(/Prev:/);
  });

  it('surfaces a notice prompting an API connection', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('connect an economic calendar api');
  });
});
