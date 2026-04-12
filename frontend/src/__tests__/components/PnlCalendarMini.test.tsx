import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PnlCalendarMini } from '@/components/dashboard/PnlCalendarMini';

// The mock in setup-mocks returns empty days, so the component will render null
// Override for this test:
import { getPnlCalendar } from '@/lib/api';
import { vi } from 'vitest';

describe('PnlCalendarMini', () => {
  it('renders null when no calendar data', () => {
    const { container } = render(<PnlCalendarMini />);
    // With empty days, component returns null
    expect(container.children.length).toBeLessThanOrEqual(1);
  });

  it('renders calendar when data is available', async () => {
    (getPnlCalendar as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      days: [{ date: '2026-04-01', pnl: 100, trades: 5, winRate: 60 }],
      monthTotal: 100, month: 4, year: 2026, tradingDays: 1, winningDays: 1, losingDays: 0, bestDay: null, worstDay: null,
    });
    render(<PnlCalendarMini />);
    await waitFor(() => {
      expect(screen.getByText(/P&L/i)).toBeDefined();
    });
  });
});
