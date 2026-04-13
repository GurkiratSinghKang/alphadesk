import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EconomicCalendar } from '@/components/dashboard/EconomicCalendar';

describe('EconomicCalendar', () => {
  it('renders the header', () => {
    render(<EconomicCalendar />);
    expect(screen.getByText('Economic Calendar')).toBeDefined();
  });

  it('shows Economic Calendar header', () => {
    render(<EconomicCalendar />);
    expect(screen.getByText('Economic Calendar')).toBeDefined();
  });

  it('renders events with impact badges', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    const hasImpact =
      text.toLowerCase().includes('high') ||
      text.toLowerCase().includes('medium') ||
      text.toLowerCase().includes('low');
    expect(hasImpact).toBe(true);
  });

  it('renders at least one calendar event row', () => {
    const { container } = render(<EconomicCalendar />);
    // Each event is in a div with px-4 py-2 flex items-center gap-3
    const eventDivs = container.querySelectorAll('.divide-y > div');
    expect(eventDivs.length).toBeGreaterThan(0);
  });

  it('renders event names from the template list', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    // At least one known event name should appear
    const knownEvents = [
      'FOMC Meeting Minutes',
      'Non-Farm Payrolls',
      'CPI',
      'Jobless Claims',
      'Retail Sales',
      'Consumer Confidence',
      'PMI',
      'GDP',
      'PCE',
      'Housing Starts',
    ];
    const found = knownEvents.some((name) => text.includes(name));
    expect(found).toBe(true);
  });

  it('renders forecast and previous data for applicable events', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    // Some events have forecast/previous data
    const hasForecastOrPrev = text.includes('Fcst:') || text.includes('Prev:');
    expect(hasForecastOrPrev).toBe(true);
  });

  it('renders impact dot indicators', () => {
    const { container } = render(<EconomicCalendar />);
    // Impact dots are spans with rounded-full class
    const dots = container.querySelectorAll('span.rounded-full');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('renders date and time information for events', () => {
    const { container } = render(<EconomicCalendar />);
    const text = container.textContent ?? '';
    // Times follow AM/PM pattern
    expect(text).toMatch(/\d+:\d{2} [AP]M/);
  });
});
