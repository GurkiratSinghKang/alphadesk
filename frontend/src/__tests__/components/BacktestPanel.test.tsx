import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('BacktestPanel', () => {
  it('renders without crashing', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('Run Backtest')).toBeDefined();
  });

  it('renders strategy selector with SMA Crossover option', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    const { container } = render(<BacktestPanel />);
    const select = container.querySelector('select');
    expect(select).toBeDefined();
    expect(screen.getByText('SMA Crossover')).toBeDefined();
  });

  it('renders strategy selector with RSI Mean Reversion option', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('RSI Mean Reversion')).toBeDefined();
  });

  it('renders strategy selector with MACD Signal option', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('MACD Signal')).toBeDefined();
  });

  it('renders symbol input with default value SPY', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    const { container } = render(<BacktestPanel />);
    const inputs = container.querySelectorAll('input');
    const symbolInput = Array.from(inputs).find((i) => (i as HTMLInputElement).value === 'SPY');
    expect(symbolInput).toBeDefined();
  });

  it('renders capital input with default value 100000', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    const { container } = render(<BacktestPanel />);
    const inputs = container.querySelectorAll('input[type="number"]');
    const capitalInput = Array.from(inputs).find((i) => (i as HTMLInputElement).value === '100000');
    expect(capitalInput).toBeDefined();
  });

  it('has Symbol label', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('Symbol')).toBeDefined();
  });

  it('has Strategy label', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('Strategy')).toBeDefined();
  });

  it('has Capital ($) label', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('Capital ($)')).toBeDefined();
  });

  it('Run Backtest button is not disabled initially', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    const button = screen.getByText('Run Backtest').closest('button');
    expect(button?.disabled).toBe(false);
  });

  it('renders Fast SMA and Slow SMA inputs for SMA Crossover strategy', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    expect(screen.getByText('Fast SMA')).toBeDefined();
    expect(screen.getByText('Slow SMA')).toBeDefined();
  });

  it('does not show results area initially', async () => {
    const { BacktestPanel } = await import('@/components/panels/BacktestPanel');
    render(<BacktestPanel />);
    const bodyText = document.body.textContent ?? '';
    expect(bodyText.includes('Total Return')).toBe(false);
    expect(bodyText.includes('Equity Curve')).toBe(false);
  });
});
