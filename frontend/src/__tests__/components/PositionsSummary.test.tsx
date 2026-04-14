import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PositionsSummary } from '@/components/dashboard/PositionsSummary';
import { usePortfolioStore } from '@/stores/portfolio';

describe('PositionsSummary', () => {
  beforeEach(() => {
    usePortfolioStore.setState({ positions: [] });
  });

  it('shows empty state when no positions', () => {
    render(<PositionsSummary />);
    expect(screen.getByText(/No open positions/i)).toBeDefined();
  });

  it('shows Open Positions heading in empty state', () => {
    render(<PositionsSummary />);
    expect(screen.getByText('Open Positions')).toBeDefined();
  });

  it('shows position symbol when positions exist', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('AAPL')).toBeDefined();
  });

  it('shows shares quantity when positions exist', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText(/10 shares/)).toBeDefined();
  });

  it('shows current price for position', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('$160.00')).toBeDefined();
  });

  it('shows avg cost for position', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText(/avg \$150\.00/)).toBeDefined();
  });

  it('shows positive unrealized P&L with + prefix', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('+$100.00')).toBeDefined();
  });

  it('shows negative unrealized P&L without + prefix', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'MSFT',
          quantity: 5,
          avgCost: 400,
          currentPrice: 380,
          unrealizedPnl: -100,
          marketValue: 1900,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('-$100.00')).toBeDefined();
  });

  it('shows position count in header', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
        {
          symbol: 'MSFT',
          quantity: 5,
          avgCost: 400,
          currentPrice: 410,
          unrealizedPnl: 50,
          marketValue: 2050,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('2 positions')).toBeDefined();
  });

  it('shows singular "position" for single position', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('1 position')).toBeDefined();
  });

  it('renders multiple positions', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
        {
          symbol: 'TSLA',
          quantity: 3,
          avgCost: 200,
          currentPrice: 220,
          unrealizedPnl: 60,
          marketValue: 660,
        },
      ],
    });
    render(<PositionsSummary />);
    expect(screen.getByText('AAPL')).toBeDefined();
    expect(screen.getByText('TSLA')).toBeDefined();
  });

  it('shows P&L percentage for a position', () => {
    usePortfolioStore.setState({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 10,
          avgCost: 150,
          currentPrice: 160,
          unrealizedPnl: 100,
          marketValue: 1600,
        },
      ],
    });
    render(<PositionsSummary />);
    // pnlPct = ((160-150)/150)*100 = 6.67%
    expect(screen.getByText('+6.67%')).toBeDefined();
  });
});
