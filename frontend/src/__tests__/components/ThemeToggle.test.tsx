import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { usePreferencesStore } from '@/stores/preferences';

describe('ThemeToggle', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      display: {
        tickerTapeOn: false,
        compactStrategyView: false,
        theme: 'dark',
      },
    });
  });

  it('toggles from dark to light', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /switch to light/i }));
    expect(usePreferencesStore.getState().display.theme).toBe('light');
  });

  it('toggles from light to dark', () => {
    usePreferencesStore.getState().setDisplayPref('theme', 'light');
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /switch to dark/i }));
    expect(usePreferencesStore.getState().display.theme).toBe('dark');
  });
});
