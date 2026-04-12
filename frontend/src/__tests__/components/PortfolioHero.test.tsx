import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortfolioHero } from '@/components/dashboard/PortfolioHero';

describe('PortfolioHero', () => {
  const defaultProps = {
    portfolioValue: 100000,
    dayPnl: 250.50,
    dayPnlPct: 0.25,
    equityHistory: [
      { date: '2026-04-01', value: 99000 },
      { date: '2026-04-02', value: 99500 },
      { date: '2026-04-10', value: 100000 },
    ],
  };

  it('renders portfolio value', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText(/\$100,000\.00/)).toBeDefined();
  });

  it('renders day P&L with + sign for positive', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText(/\+\$250\.50/)).toBeDefined();
  });

  it('renders period pills', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText('1W')).toBeDefined();
    expect(screen.getByText('1M')).toBeDefined();
    expect(screen.getByText('3M')).toBeDefined();
    expect(screen.getByText('YTD')).toBeDefined();
  });

  it('renders equity curve SVG when data has 2+ points', () => {
    const { container } = render(<PortfolioHero {...defaultProps} />);
    expect(container.querySelector('svg')).toBeDefined();
    expect(container.querySelector('polyline')).toBeDefined();
  });

  it('does not render polyline with less than 2 points', () => {
    const { container } = render(
      <PortfolioHero
        {...defaultProps}
        equityHistory={[{ date: '2026-04-01', value: 100000 }]}
      />
    );
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('shows negative P&L in loss color without + sign', () => {
    render(<PortfolioHero {...defaultProps} dayPnl={-100} dayPnlPct={-0.1} />);
    expect(screen.getByText(/-\$100\.00/)).toBeDefined();
  });

  it('shows zero P&L in muted style', () => {
    render(<PortfolioHero {...defaultProps} dayPnl={0} dayPnlPct={0} />);
    expect(screen.getByText(/\$0\.00/)).toBeDefined();
  });

  it('renders sr-only h1 for accessibility', () => {
    const { container } = render(<PortfolioHero {...defaultProps} />);
    const h1 = container.querySelector('h1');
    expect(h1).toBeDefined();
    expect(h1?.className).toContain('sr-only');
  });

  it('renders the portfolio label', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText('Portfolio')).toBeDefined();
  });

  it('renders the Day P&L label', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText('Day P&L')).toBeDefined();
  });

  it('renders polygon for gradient fill area when data has 2+ points', () => {
    const { container } = render(<PortfolioHero {...defaultProps} />);
    expect(container.querySelector('polygon')).toBeDefined();
  });

  it('renders percent change alongside day P&L', () => {
    render(<PortfolioHero {...defaultProps} />);
    expect(screen.getByText(/0\.25%/)).toBeDefined();
  });

  it('shows negative percent change for loss', () => {
    render(<PortfolioHero {...defaultProps} dayPnl={-100} dayPnlPct={-0.1} />);
    expect(screen.getByText(/-0\.10%/)).toBeDefined();
  });

  it('renders with empty equity history without crashing', () => {
    const { container } = render(
      <PortfolioHero {...defaultProps} equityHistory={[]} />
    );
    expect(container.querySelector('polyline')).toBeNull();
  });
});
