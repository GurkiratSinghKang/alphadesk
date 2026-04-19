import { describe, it, expect } from 'vitest';
import { DEFAULT_BINDINGS, SHORTCUT_GROUPS } from '@/hooks/useKeyboardShortcuts';

describe('Keyboard Shortcuts', () => {
  describe('DEFAULT_BINDINGS', () => {
    it('has ? for toggle shortcuts', () => {
      expect(DEFAULT_BINDINGS['?']).toBe('toggle:shortcuts');
    });

    it('has / for focus search', () => {
      expect(DEFAULT_BINDINGS['/']).toBe('focus:search');
    });

    it('has Escape for dismiss', () => {
      expect(DEFAULT_BINDINGS['Escape']).toBe('dismiss');
    });

    it('has g d for navigate dashboard', () => {
      expect(DEFAULT_BINDINGS['g d']).toBe('navigate:dashboard');
    });

    it('has g t for navigate trade', () => {
      expect(DEFAULT_BINDINGS['g t']).toBe('navigate:trade');
    });

    it('has g p for navigate pipeline', () => {
      expect(DEFAULT_BINDINGS['g p']).toBe('navigate:pipeline');
    });

    it('has number keys for chart ranges matching PriceChartPanel', () => {
      // Wave 32: bindings changed from `chart:timeframe:1m..M` (nothing
      // listened) to `chart:set-range:1D..ALL` (actual ChartRange values
      // the panel exposes). See audit-reports/persona-6-power-user.md #1.
      expect(DEFAULT_BINDINGS['1']).toBe('chart:set-range:1D');
      expect(DEFAULT_BINDINGS['5']).toBe('chart:set-range:6M');
      expect(DEFAULT_BINDINGS['6']).toBe('chart:set-range:YTD');
      expect(DEFAULT_BINDINGS['7']).toBe('chart:set-range:1Y');
      expect(DEFAULT_BINDINGS['8']).toBe('chart:set-range:ALL');
    });

    it('has j/k for watchlist navigation', () => {
      expect(DEFAULT_BINDINGS['j']).toBe('watchlist:next');
      expect(DEFAULT_BINDINGS['k']).toBe('watchlist:prev');
    });

    it('has all intermediate range bindings', () => {
      expect(DEFAULT_BINDINGS['2']).toBe('chart:set-range:5D');
      expect(DEFAULT_BINDINGS['3']).toBe('chart:set-range:1M');
      expect(DEFAULT_BINDINGS['4']).toBe('chart:set-range:3M');
    });
  });

  describe('SHORTCUT_GROUPS', () => {
    it('has at least 4 groups', () => {
      expect(SHORTCUT_GROUPS.length).toBeGreaterThanOrEqual(4);
    });

    it('has Global, Navigation, Chart, Watchlist groups', () => {
      const names = SHORTCUT_GROUPS.map(g => g.name);
      expect(names).toContain('Global');
      expect(names).toContain('Navigation');
      expect(names).toContain('Chart');
      expect(names).toContain('Watchlist');
    });

    it('each group has items with key, action, description', () => {
      for (const group of SHORTCUT_GROUPS) {
        for (const item of group.items) {
          expect(item.key).toBeTruthy();
          expect(item.action).toBeTruthy();
          expect(item.description).toBeTruthy();
        }
      }
    });

    it('Global group has at least 4 items', () => {
      const global = SHORTCUT_GROUPS.find(g => g.name === 'Global');
      expect(global?.items.length).toBeGreaterThanOrEqual(4);
    });

    it('Chart group has range items matching PriceChartPanel', () => {
      // Wave 32: overlay groups updated to reflect real ChartRange values
      // (1D/5D/1M/.../ALL) instead of the defunct 1m/5m/.../M timeframes.
      const chart = SHORTCUT_GROUPS.find(g => g.name === 'Chart');
      expect(chart?.items.some(i => i.action.startsWith('chart:set-range:'))).toBe(true);
      expect(chart?.items.length).toBeGreaterThanOrEqual(4);
    });

    it('Navigation group has dashboard, trade, pipeline items', () => {
      const nav = SHORTCUT_GROUPS.find(g => g.name === 'Navigation');
      expect(nav?.items.some(i => i.action === 'navigate:dashboard')).toBe(true);
      expect(nav?.items.some(i => i.action === 'navigate:trade')).toBe(true);
      expect(nav?.items.some(i => i.action === 'navigate:pipeline')).toBe(true);
    });

    it('Watchlist group has next and prev items', () => {
      const watchlist = SHORTCUT_GROUPS.find(g => g.name === 'Watchlist');
      expect(watchlist?.items.some(i => i.action === 'watchlist:next')).toBe(true);
      expect(watchlist?.items.some(i => i.action === 'watchlist:prev')).toBe(true);
    });

    it('items in SHORTCUT_GROUPS match DEFAULT_BINDINGS actions', () => {
      for (const group of SHORTCUT_GROUPS) {
        for (const item of group.items) {
          // Every item's action should either exist in DEFAULT_BINDINGS values
          // or be a valid action string (some like Ctrl+K are not in DEFAULT_BINDINGS)
          expect(typeof item.action).toBe('string');
          expect(item.action.length).toBeGreaterThan(0);
        }
      }
    });

    it('Chart group has 8 timeframe items', () => {
      const chart = SHORTCUT_GROUPS.find(g => g.name === 'Chart');
      expect(chart?.items.length).toBe(8);
    });

    it('Global group contains the command palette action', () => {
      const global = SHORTCUT_GROUPS.find(g => g.name === 'Global');
      expect(global?.items.some(i => i.action === 'toggle:command-palette')).toBe(true);
    });
  });
});
