import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/layout/TopBar';

describe('TopBar', () => {
  it('renders logo text', () => {
    render(<TopBar />);
    expect(screen.getByText('AlphaDesk')).toBeDefined();
  });

  it('renders navigation tabs', () => {
    render(<TopBar />);
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Trade')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
  });

  it('renders search bar', () => {
    render(<TopBar />);
    expect(screen.getByText(/Search symbols/)).toBeDefined();
  });

  it('renders Ctrl+K hint', () => {
    render(<TopBar />);
    expect(screen.getByText('Ctrl+K')).toBeDefined();
  });

  it('renders profile avatar', () => {
    render(<TopBar />);
    expect(screen.getByText('A')).toBeDefined(); // Avatar shows "A" for admin
  });

  it('keeps the mobile menu trigger at a touch-safe size', () => {
    render(<TopBar />);
    const trigger = screen.getByLabelText('Open menu');
    expect(trigger.className).toContain('min-h-[44px]');
    expect(trigger.className).toContain('min-w-[44px]');
  });
});
