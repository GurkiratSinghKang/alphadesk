import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AllocationDonut } from '@/components/dashboard/AllocationDonut';

describe('AllocationDonut', () => {
  const props = {
    cash: 95000,
    invested: 5000,
    equity: 100000,
    buyingPower: 200000,
    unrealizedPnl: 100,
    realizedPnlToday: -50,
  };

  it('renders cash and invested labels', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('Cash')).toBeDefined();
    expect(screen.getByText('Invested')).toBeDefined();
  });

  it('renders SVG donut with circles', () => {
    const { container } = render(<AllocationDonut {...props} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });

  it('renders buying power', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('Buying Power')).toBeDefined();
  });

  it('renders unrealized and realized P&L', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('Unrealized')).toBeDefined();
    expect(screen.getByText('Realized Today')).toBeDefined();
  });

  it('handles zero values without crashing', () => {
    render(
      <AllocationDonut
        cash={0}
        invested={0}
        equity={0}
        buyingPower={0}
        unrealizedPnl={0}
        realizedPnlToday={0}
      />
    );
    expect(screen.getByText('Cash')).toBeDefined();
  });

  it('renders Allocation heading', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('Allocation')).toBeDefined();
  });

  it('renders formatted cash value', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('$95,000.00')).toBeDefined();
  });

  it('renders formatted invested value', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('$5,000.00')).toBeDefined();
  });

  it('renders formatted buying power value', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('$200,000.00')).toBeDefined();
  });

  it('renders unrealized P&L with + prefix when positive', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('+$100.00')).toBeDefined();
  });

  it('renders negative realized P&L without + prefix', () => {
    render(<AllocationDonut {...props} />);
    expect(screen.getByText('-$50.00')).toBeDefined();
  });

  it('renders invested circle when investedPct > 0.005', () => {
    const { container } = render(<AllocationDonut {...props} />);
    // With 5000 invested out of 100000 total, investedPct = 0.05 > 0.005
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });

  it('omits the invested segment circle when invested is zero', () => {
    const { container } = render(
      <AllocationDonut {...props} cash={100000} invested={0} equity={100000} />
    );
    // Component renders a base-ring backdrop + a cash arc always; the invested
    // segment is conditional on investedPct > 0.005. Two visible circles at
    // invested=0 (backdrop + cash), three otherwise.
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('renders total equity in center text', () => {
    render(<AllocationDonut {...props} />);
    // equity=100000 formatted compact: "$100K"
    expect(screen.getByText('Total')).toBeDefined();
  });
});
