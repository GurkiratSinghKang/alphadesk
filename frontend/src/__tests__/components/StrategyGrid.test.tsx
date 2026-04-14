import '../setup-mocks';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyGrid } from '@/components/dashboard/StrategyGrid';

const strategies = [
  { id: 'pead', name: 'PEAD', shortName: 'PEAD', status: 'active' as const, returnPct: 6.6, positions: 1, winRate: 0, invested: 5000, icon: () => null },
  { id: 'momentum-quality', name: 'Momentum + Quality', shortName: 'Momentum', status: 'active' as const, returnPct: 0, positions: 0, winRate: 0, invested: 0, icon: () => null },
];

describe('StrategyGrid', () => {
  it('renders strategy names', () => {
    render(<StrategyGrid strategies={strategies} regimeLabel="bull" onStrategyClick={vi.fn()} />);
    expect(screen.getByText('PEAD')).toBeDefined();
  });

  it('shows return percentage', () => {
    render(<StrategyGrid strategies={strategies} regimeLabel="bull" onStrategyClick={vi.fn()} />);
    expect(screen.getByText(/6\.60%/)).toBeDefined();
  });

  it('shows Active badge', () => {
    render(<StrategyGrid strategies={strategies} regimeLabel="bull" onStrategyClick={vi.fn()} />);
    const badges = screen.getAllByText('Active');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('calls onStrategyClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<StrategyGrid strategies={strategies} regimeLabel="bull" onStrategyClick={onClick} />);
    const cards = screen.getAllByRole('button');
    fireEvent.click(cards[0]);
    expect(onClick).toHaveBeenCalledWith('pead');
  });

  it('shows position count', () => {
    render(<StrategyGrid strategies={strategies} regimeLabel="bull" onStrategyClick={vi.fn()} />);
    expect(screen.getByText(/1 active/)).toBeDefined();
  });
});
