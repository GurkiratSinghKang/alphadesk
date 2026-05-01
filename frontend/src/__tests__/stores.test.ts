import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketStore } from '@/stores/market';
import { usePortfolioStore } from '@/stores/portfolio';
import { useAlertsStore } from '@/stores/alerts';
import { useUIStore } from '@/stores/ui';
import { useOptionsStore, type SelectedStrike } from '@/stores/options';
import { useNotificationsStore } from '@/stores/notifications';
import type { Quote } from '@/types';

// ─── Market Store ─────────────────────────────────────────────

describe('Market Store', () => {
  beforeEach(() => {
    useMarketStore.setState({
      watchlist: ['AAPL', 'MSFT', 'SPY'],
      quotes: {},
      selectedSymbol: 'SPY',
    });
  });

  it('has default watchlist', () => {
    const { watchlist } = useMarketStore.getState();
    expect(watchlist.length).toBeGreaterThan(0);
  });

  it('addToWatchlist adds a symbol', () => {
    useMarketStore.getState().addToWatchlist('TSLA');
    expect(useMarketStore.getState().watchlist).toContain('TSLA');
  });

  it('addToWatchlist deduplicates', () => {
    useMarketStore.getState().addToWatchlist('AAPL');
    const count = useMarketStore.getState().watchlist.filter(s => s === 'AAPL').length;
    expect(count).toBe(1);
  });

  it('addToWatchlist uppercases symbol', () => {
    useMarketStore.getState().addToWatchlist('goog');
    expect(useMarketStore.getState().watchlist).toContain('GOOG');
  });

  it('removeFromWatchlist removes a symbol', () => {
    useMarketStore.getState().removeFromWatchlist('AAPL');
    expect(useMarketStore.getState().watchlist).not.toContain('AAPL');
  });

  it('removeFromWatchlist leaves other symbols intact', () => {
    useMarketStore.getState().removeFromWatchlist('AAPL');
    expect(useMarketStore.getState().watchlist).toContain('MSFT');
    expect(useMarketStore.getState().watchlist).toContain('SPY');
  });

  it('removeFromWatchlist is a no-op for unknown symbol', () => {
    const before = useMarketStore.getState().watchlist.length;
    useMarketStore.getState().removeFromWatchlist('UNKNOWN');
    expect(useMarketStore.getState().watchlist.length).toBe(before);
  });

  it('setSelectedSymbol updates selection', () => {
    useMarketStore.getState().setSelectedSymbol('AAPL');
    expect(useMarketStore.getState().selectedSymbol).toBe('AAPL');
  });

  it('setSelectedSymbol can be called multiple times', () => {
    useMarketStore.getState().setSelectedSymbol('AAPL');
    useMarketStore.getState().setSelectedSymbol('NVDA');
    expect(useMarketStore.getState().selectedSymbol).toBe('NVDA');
  });

  it('updateQuote stores quote in map', () => {
    const quote = {
      symbol: 'AAPL',
      last: 150,
      bid: 149.9,
      ask: 150.1,
      bidSize: 400,
      askSize: 550,
      change: 1,
      changePct: 0.67,
      volume: 1000000,
      high: 151,
      low: 149,
      open: 149.5,
      close: 150,
      timestamp: Date.now(),
    };
    useMarketStore.getState().updateQuote(quote);
    expect(useMarketStore.getState().quotes['AAPL']?.last).toBe(150);
  });

  it('updateQuote merges with existing quote', () => {
    const base = {
      symbol: 'AAPL',
      last: 150,
      bid: 149.9,
      ask: 150.1,
      bidSize: 400,
      askSize: 550,
      change: 1,
      changePct: 0.67,
      volume: 1000000,
      high: 151,
      low: 149,
      open: 149.5,
      close: 150,
      timestamp: 1000,
    };
    useMarketStore.getState().updateQuote(base);
    useMarketStore.getState().updateQuote({ ...base, last: 155, timestamp: 2000 });
    const stored = useMarketStore.getState().quotes['AAPL'];
    expect(stored?.last).toBe(155);
    expect(stored?.bid).toBe(149.9);
    expect(stored?.bidSize).toBe(400);
    expect(stored?.askSize).toBe(550);
  });

  it('updateQuote normalizes ISO timestamps from streaming quotes', () => {
    useMarketStore.getState().updateQuote({
      symbol: 'AAPL',
      last: 150,
      bid: 149.9,
      ask: 150.1,
      change: 0,
      changePct: 0,
      volume: 1000000,
      high: 151,
      low: 149,
      open: 149.5,
      close: 150,
      timestamp: '2026-04-30T14:30:00Z',
    } as unknown as Quote);
    expect(useMarketStore.getState().quotes['AAPL']?.timestamp).toBe(
      Date.parse('2026-04-30T14:30:00Z'),
    );
  });

  it('updateQuotes stores multiple quotes', () => {
    const quotes = [
      {
        symbol: 'AAPL',
        last: 150,
        bid: 149.9,
        ask: 150.1,
        change: 1,
        changePct: 0.67,
        volume: 1000000,
        high: 151,
        low: 149,
        open: 149.5,
        close: 150,
        timestamp: Date.now(),
      },
      {
        symbol: 'MSFT',
        last: 400,
        bid: 399,
        ask: 401,
        change: 2,
        changePct: 0.5,
        volume: 500000,
        high: 402,
        low: 398,
        open: 399,
        close: 400,
        timestamp: Date.now(),
      },
    ];
    useMarketStore.getState().updateQuotes(quotes);
    expect(useMarketStore.getState().quotes['AAPL']?.last).toBe(150);
    expect(useMarketStore.getState().quotes['MSFT']?.last).toBe(400);
  });

  it('updateQuotes with empty array leaves map unchanged', () => {
    useMarketStore.getState().updateQuotes([]);
    expect(Object.keys(useMarketStore.getState().quotes).length).toBe(0);
  });

  it('quotes map is initially empty', () => {
    expect(Object.keys(useMarketStore.getState().quotes).length).toBe(0);
  });
});

// ─── Alerts Store ─────────────────────────────────────────────

describe('Alerts Store', () => {
  beforeEach(() => {
    useAlertsStore.setState({ alerts: [] });
  });

  it('starts empty', () => {
    expect(useAlertsStore.getState().alerts).toEqual([]);
  });

  it('addAlert adds an alert', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'Test', time: Date.now(), acknowledged: false });
    expect(useAlertsStore.getState().alerts.length).toBe(1);
  });

  it('addAlert prepends (newest first)', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'First', time: 1, acknowledged: false });
    useAlertsStore.getState().addAlert({ id: '2', type: 'system', message: 'Second', time: 2, acknowledged: false });
    expect(useAlertsStore.getState().alerts[0].id).toBe('2');
  });

  it('addAlert caps at 100', () => {
    for (let i = 0; i < 110; i++) {
      useAlertsStore.getState().addAlert({ id: String(i), type: 'system', message: `Alert ${i}`, time: i, acknowledged: false });
    }
    expect(useAlertsStore.getState().alerts.length).toBe(100);
  });

  it('addAlert retains newest 100 when cap exceeded', () => {
    for (let i = 0; i < 110; i++) {
      useAlertsStore.getState().addAlert({ id: String(i), type: 'system', message: `Alert ${i}`, time: i, acknowledged: false });
    }
    // The newest alert (id=109) should be at index 0 (prepended last)
    expect(useAlertsStore.getState().alerts[0].id).toBe('109');
  });

  it('acknowledgeAlert marks alert as acknowledged', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'Test', time: Date.now(), acknowledged: false });
    useAlertsStore.getState().acknowledgeAlert('1');
    expect(useAlertsStore.getState().alerts[0].acknowledged).toBe(true);
  });

  it('acknowledgeAlert leaves other alerts untouched', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'A', time: 1, acknowledged: false });
    useAlertsStore.getState().addAlert({ id: '2', type: 'system', message: 'B', time: 2, acknowledged: false });
    useAlertsStore.getState().acknowledgeAlert('1');
    const alert2 = useAlertsStore.getState().alerts.find(a => a.id === '2');
    expect(alert2?.acknowledged).toBe(false);
  });

  it('acknowledgeAlert on unknown id is a no-op', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'Test', time: Date.now(), acknowledged: false });
    useAlertsStore.getState().acknowledgeAlert('nonexistent');
    expect(useAlertsStore.getState().alerts[0].acknowledged).toBe(false);
  });

  it('clearAlerts empties the list', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'Test', time: Date.now(), acknowledged: false });
    useAlertsStore.getState().clearAlerts();
    expect(useAlertsStore.getState().alerts).toEqual([]);
  });

  it('unacknowledged count can be derived from alerts array', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'A', time: 1, acknowledged: false });
    useAlertsStore.getState().addAlert({ id: '2', type: 'system', message: 'B', time: 2, acknowledged: true });
    const count = useAlertsStore.getState().alerts.filter((a) => !a.acknowledged).length;
    expect(count).toBe(1);
  });

  it('unacknowledged count is 0 when all acknowledged', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'A', time: 1, acknowledged: true });
    useAlertsStore.getState().addAlert({ id: '2', type: 'system', message: 'B', time: 2, acknowledged: true });
    const count = useAlertsStore.getState().alerts.filter((a) => !a.acknowledged).length;
    expect(count).toBe(0);
  });

  it('unacknowledged count is 0 when list is empty', () => {
    const count = useAlertsStore.getState().alerts.filter((a) => !a.acknowledged).length;
    expect(count).toBe(0);
  });

  it('unacknowledged count updates after acknowledgeAlert', () => {
    useAlertsStore.getState().addAlert({ id: '1', type: 'system', message: 'A', time: 1, acknowledged: false });
    useAlertsStore.getState().addAlert({ id: '2', type: 'system', message: 'B', time: 2, acknowledged: false });
    let count = useAlertsStore.getState().alerts.filter((a) => !a.acknowledged).length;
    expect(count).toBe(2);
    useAlertsStore.getState().acknowledgeAlert('1');
    count = useAlertsStore.getState().alerts.filter((a) => !a.acknowledged).length;
    expect(count).toBe(1);
  });

  it('supports all alert types', () => {
    const types = ['price', 'signal', 'order', 'system', 'agent'] as const;
    types.forEach((type, i) => {
      useAlertsStore.getState().addAlert({ id: String(i), type, message: `${type} alert`, time: i, acknowledged: false });
    });
    expect(useAlertsStore.getState().alerts.length).toBe(5);
  });
});

// ─── UI Store ─────────────────────────────────────────────────

describe('UI Store', () => {
  beforeEach(() => {
    useUIStore.setState({
      tradingMode: 'paper',
      commandPaletteOpen: false,
      sidebarCollapsed: false,
      theme: 'dark',
      activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'trade' },
    });
  });

  it('defaults to paper trading mode', () => {
    expect(useUIStore.getState().tradingMode).toBe('paper');
  });

  it('setTradingMode changes mode to live', () => {
    useUIStore.getState().setTradingMode('live');
    expect(useUIStore.getState().tradingMode).toBe('live');
  });

  it('setTradingMode changes mode back to paper', () => {
    useUIStore.getState().setTradingMode('live');
    useUIStore.getState().setTradingMode('paper');
    expect(useUIStore.getState().tradingMode).toBe('paper');
  });

  it('toggleCommandPalette toggles false to true', () => {
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('toggleCommandPalette toggles back to false', () => {
    useUIStore.getState().toggleCommandPalette();
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('setCommandPaletteOpen sets to true', () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('setCommandPaletteOpen sets to false', () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().setCommandPaletteOpen(false);
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('setActiveTab updates right panel tab', () => {
    useUIStore.getState().setActiveTab('right', 'order');
    expect(useUIStore.getState().activePanels.right).toBe('order');
  });

  it('setActiveTab updates left panel tab', () => {
    useUIStore.getState().setActiveTab('left', 'screener');
    expect(useUIStore.getState().activePanels.left).toBe('screener');
  });

  it('setActiveTab updates center panel tab', () => {
    useUIStore.getState().setActiveTab('center', 'options');
    expect(useUIStore.getState().activePanels.center).toBe('options');
  });

  it('setActiveTab updates bottom panel tab', () => {
    useUIStore.getState().setActiveTab('bottom', 'positions');
    expect(useUIStore.getState().activePanels.bottom).toBe('positions');
  });

  it('setActiveTab for one panel does not affect others', () => {
    useUIStore.getState().setActiveTab('right', 'order');
    expect(useUIStore.getState().activePanels.left).toBe('watchlist');
    expect(useUIStore.getState().activePanels.center).toBe('chart');
    expect(useUIStore.getState().activePanels.bottom).toBe('trade');
  });

  it('toggleSidebar toggles collapsed state', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setSidebarCollapsed sets collapsed explicitly', () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('setTheme changes to light', () => {
    useUIStore.getState().setTheme('light');
    expect(useUIStore.getState().theme).toBe('light');
  });

  it('setTheme changes back to dark', () => {
    useUIStore.getState().setTheme('light');
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
  });
});

// ─── Notifications Store ───────────────────────────────────────────────────

describe('Notifications Store', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] });
  });

  it('collapses identical notifications across a burst window', () => {
    const store = useNotificationsStore.getState();
    store.addNotification({
      category: 'trades',
      title: 'Order rejected',
      detail: 'AAPL: quote unavailable',
    });
    store.addNotification({
      category: 'system',
      title: 'Connected',
      detail: 'Feed resumed',
    });
    store.addNotification({
      category: 'trades',
      title: 'Order rejected',
      detail: 'AAPL: quote unavailable',
    });

    const notifications = useNotificationsStore.getState().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].title).toBe('Order rejected');
    expect(notifications.filter((n) => n.title === 'Order rejected')).toHaveLength(1);
  });
});

// ─── Portfolio Store ───────────────────────────────────────────

describe('Portfolio Store', () => {
  beforeEach(() => {
    usePortfolioStore.setState({
      positions: [],
      orders: [],
      summary: { equity: 0, cash: 0, buyingPower: 0, totalMarketValue: 0, unrealizedPnl: 0, unrealizedPnlPct: 0, realizedPnlToday: 0, positionsCount: 0, dayPnl: 0, dayPnlPct: 0 },
      greeks: { netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, betaWeightedDelta: 0 },
    });
  });

  it('has default summary with zeros', () => {
    const { summary } = usePortfolioStore.getState();
    expect(summary).toBeDefined();
    expect(typeof summary.equity).toBe('number');
  });

  it('default summary equity is 0', () => {
    expect(usePortfolioStore.getState().summary.equity).toBe(0);
  });

  it('setSummary updates all summary fields', () => {
    const newSummary = {
      equity: 100000,
      cash: 95000,
      buyingPower: 200000,
      totalMarketValue: 5000,
      unrealizedPnl: 100,
      unrealizedPnlPct: 2,
      realizedPnlToday: -50,
      positionsCount: 1,
      dayPnl: 50,
      dayPnlPct: 0.05,
    };
    usePortfolioStore.getState().setSummary(newSummary);
    expect(usePortfolioStore.getState().summary.equity).toBe(100000);
    expect(usePortfolioStore.getState().summary.cash).toBe(95000);
    expect(usePortfolioStore.getState().summary.buyingPower).toBe(200000);
  });

  it('setPositions updates positions array', () => {
    usePortfolioStore.getState().setPositions([
      { symbol: 'AAPL', quantity: 10, avgCost: 150, currentPrice: 160, unrealizedPnl: 100, marketValue: 1600 },
    ]);
    expect(usePortfolioStore.getState().positions.length).toBe(1);
    expect(usePortfolioStore.getState().positions[0].symbol).toBe('AAPL');
  });

  it('setPositions replaces existing positions', () => {
    usePortfolioStore.getState().setPositions([
      { symbol: 'AAPL', quantity: 10, avgCost: 150, currentPrice: 160, unrealizedPnl: 100, marketValue: 1600 },
    ]);
    usePortfolioStore.getState().setPositions([
      { symbol: 'MSFT', quantity: 5, avgCost: 400, currentPrice: 410, unrealizedPnl: 50, marketValue: 2050 },
    ]);
    expect(usePortfolioStore.getState().positions.length).toBe(1);
    expect(usePortfolioStore.getState().positions[0].symbol).toBe('MSFT');
  });

  it('setPositions with empty array clears positions', () => {
    usePortfolioStore.getState().setPositions([
      { symbol: 'AAPL', quantity: 10, avgCost: 150, currentPrice: 160, unrealizedPnl: 100, marketValue: 1600 },
    ]);
    usePortfolioStore.getState().setPositions([]);
    expect(usePortfolioStore.getState().positions.length).toBe(0);
  });

  it('addOrder prepends order to list', () => {
    const order = { id: 'o1', symbol: 'AAPL', side: 'buy' as const, type: 'market' as const, quantity: 10, status: 'pending' as const, createdAt: new Date().toISOString() };
    usePortfolioStore.getState().addOrder(order);
    expect(usePortfolioStore.getState().orders[0].id).toBe('o1');
  });

  it('addOrder caps at 200', () => {
    for (let i = 0; i < 210; i++) {
      usePortfolioStore.getState().addOrder({
        id: String(i),
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        quantity: 1,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
    expect(usePortfolioStore.getState().orders.length).toBe(200);
  });

  it('setOrders replaces orders array', () => {
    const orders = [
      { id: 'o1', symbol: 'AAPL', side: 'buy' as const, type: 'market' as const, quantity: 10, status: 'pending' as const, createdAt: new Date().toISOString() },
      { id: 'o2', symbol: 'MSFT', side: 'sell' as const, type: 'limit' as const, quantity: 5, price: 400, status: 'pending' as const, createdAt: new Date().toISOString() },
    ];
    usePortfolioStore.getState().setOrders(orders);
    expect(usePortfolioStore.getState().orders.length).toBe(2);
  });

  it('updateOrderStatus changes the status of a specific order', () => {
    const order = { id: 'o1', symbol: 'AAPL', side: 'buy' as const, type: 'market' as const, quantity: 10, status: 'pending' as const, createdAt: new Date().toISOString() };
    usePortfolioStore.getState().addOrder(order);
    usePortfolioStore.getState().updateOrderStatus('o1', 'filled');
    expect(usePortfolioStore.getState().orders[0].status).toBe('filled');
  });

  it('updateOrderStatus leaves other orders unchanged', () => {
    const o1 = { id: 'o1', symbol: 'AAPL', side: 'buy' as const, type: 'market' as const, quantity: 10, status: 'pending' as const, createdAt: new Date().toISOString() };
    const o2 = { id: 'o2', symbol: 'MSFT', side: 'sell' as const, type: 'market' as const, quantity: 5, status: 'pending' as const, createdAt: new Date().toISOString() };
    usePortfolioStore.getState().setOrders([o1, o2]);
    usePortfolioStore.getState().updateOrderStatus('o1', 'cancelled');
    expect(usePortfolioStore.getState().orders.find(o => o.id === 'o2')?.status).toBe('pending');
  });

  it('setGreeks updates portfolio greeks', () => {
    usePortfolioStore.getState().setGreeks({ netDelta: 0.5, netGamma: 0.02, netTheta: -10, netVega: 50, betaWeightedDelta: 0.45 });
    expect(usePortfolioStore.getState().greeks.netDelta).toBe(0.5);
    expect(usePortfolioStore.getState().greeks.netTheta).toBe(-10);
  });
});

// ─── Options Store ───────────────────────────────────────────

describe('Options Store', () => {
  const sampleCall: SelectedStrike = {
    strike: 680,
    type: 'call',
    expiry: '2026-05-16',
    price: 5.20,
    delta: 0.45,
  };

  const samplePut: SelectedStrike = {
    strike: 670,
    type: 'put',
    expiry: '2026-05-16',
    price: 3.10,
    delta: -0.35,
  };

  beforeEach(() => {
    useOptionsStore.setState({ selectedStrikes: [] });
  });

  it('starts with empty selectedStrikes', () => {
    expect(useOptionsStore.getState().selectedStrikes).toEqual([]);
  });

  it('addStrike adds a strike', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
    expect(useOptionsStore.getState().selectedStrikes[0].strike).toBe(680);
  });

  it('addStrike adds multiple strikes', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().addStrike(samplePut);
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(2);
  });

  it('addStrike preserves all strike fields', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    const stored = useOptionsStore.getState().selectedStrikes[0];
    expect(stored.strike).toBe(680);
    expect(stored.type).toBe('call');
    expect(stored.expiry).toBe('2026-05-16');
    expect(stored.price).toBe(5.20);
    expect(stored.delta).toBe(0.45);
  });

  it('removeStrike removes a strike by value and type', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().addStrike(samplePut);
    useOptionsStore.getState().removeStrike(680, 'call');
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
    expect(useOptionsStore.getState().selectedStrikes[0].type).toBe('put');
  });

  it('removeStrike leaves other strikes intact', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().addStrike(samplePut);
    useOptionsStore.getState().removeStrike(680, 'call');
    expect(useOptionsStore.getState().selectedStrikes[0].strike).toBe(670);
  });

  it('removeStrike is a no-op for unknown strike', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().removeStrike(999, 'call');
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
  });

  it('removeStrike distinguishes between call and put at same strike', () => {
    const callAt680: SelectedStrike = { strike: 680, type: 'call', expiry: '2026-05-16', price: 5, delta: 0.45 };
    const putAt680: SelectedStrike = { strike: 680, type: 'put', expiry: '2026-05-16', price: 4, delta: -0.55 };
    useOptionsStore.getState().addStrike(callAt680);
    useOptionsStore.getState().addStrike(putAt680);
    useOptionsStore.getState().removeStrike(680, 'call');
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
    expect(useOptionsStore.getState().selectedStrikes[0].type).toBe('put');
  });

  it('toggleStrike adds when absent', () => {
    useOptionsStore.getState().toggleStrike(sampleCall);
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
    expect(useOptionsStore.getState().selectedStrikes[0].strike).toBe(680);
  });

  it('toggleStrike removes when present', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().toggleStrike(sampleCall);
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(0);
  });

  it('toggleStrike is idempotent: toggle twice restores original', () => {
    useOptionsStore.getState().toggleStrike(sampleCall);
    useOptionsStore.getState().toggleStrike(sampleCall);
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(0);
  });

  it('toggleStrike only affects matching strike/type pair', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().addStrike(samplePut);
    useOptionsStore.getState().toggleStrike(sampleCall); // removes sampleCall
    expect(useOptionsStore.getState().selectedStrikes.length).toBe(1);
    expect(useOptionsStore.getState().selectedStrikes[0].type).toBe('put');
  });

  it('clearStrikes empties the array', () => {
    useOptionsStore.getState().addStrike(sampleCall);
    useOptionsStore.getState().addStrike(samplePut);
    useOptionsStore.getState().clearStrikes();
    expect(useOptionsStore.getState().selectedStrikes).toEqual([]);
  });

  it('clearStrikes is a no-op on empty array', () => {
    useOptionsStore.getState().clearStrikes();
    expect(useOptionsStore.getState().selectedStrikes).toEqual([]);
  });
});
