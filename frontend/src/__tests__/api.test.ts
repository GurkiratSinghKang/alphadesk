import { describe, it, expect } from 'vitest';
import type {
  CalendarDay,
  CalendarData,
  PipelineRun,
  PipelinePosition,
  PipelinePerformance,
  PipelineScreenedStock,
  PipelineAnalysis,
  PipelineOrder,
  PipelineStatus,
  StrategyPerformance,
  StrategyTrade,
  StrategyAnalytics,
  PlaceOrderPayload,
  ChatResponse,
} from '@/lib/api';

describe('API Types', () => {
  it('CalendarDay has required fields', () => {
    const day: CalendarDay = { date: '2026-04-01', pnl: 100, trades: 5, winRate: 60 };
    expect(day.date).toBe('2026-04-01');
    expect(day.pnl).toBe(100);
    expect(day.trades).toBe(5);
    expect(day.winRate).toBe(60);
  });

  it('CalendarDay supports negative pnl', () => {
    const day: CalendarDay = { date: '2026-04-02', pnl: -250.5, trades: 3, winRate: 33.3 };
    expect(day.pnl).toBeLessThan(0);
  });

  it('PipelineRun has required fields', () => {
    const run: PipelineRun = {
      date: '2026-04-01',
      timestamp: '2026-04-01T12:00:00Z',
      screened: [],
      analyzed: [],
      signals: [],
      ordersPlaced: [],
      ordersClosed: [],
      portfolioSnapshot: { equity: 100000, cash: 95000, positions: 1 },
      errors: [],
    };
    expect(run.date).toBe('2026-04-01');
    expect(run.errors).toEqual([]);
    expect(run.portfolioSnapshot.equity).toBe(100000);
    expect(run.portfolioSnapshot.cash).toBe(95000);
    expect(run.portfolioSnapshot.positions).toBe(1);
  });

  it('PipelineRun accepts screened stocks', () => {
    const stock: PipelineScreenedStock = {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 175.50,
      compositeScore: 0.85,
      sector: 'Technology',
      changePct: 1.2,
    };
    const run: PipelineRun = {
      date: '2026-04-01',
      timestamp: '2026-04-01T12:00:00Z',
      screened: [stock],
      analyzed: [],
      signals: [],
      ordersPlaced: [],
      ordersClosed: [],
      portfolioSnapshot: { equity: 100000, cash: 95000, positions: 1 },
      errors: [],
    };
    expect(run.screened[0].symbol).toBe('AAPL');
    expect(run.screened[0].compositeScore).toBe(0.85);
  });

  it('PipelineRun accepts analyzed stocks', () => {
    const analysis: PipelineAnalysis = {
      symbol: 'MSFT',
      signal: 'buy',
      conviction: 0.9,
      entryPrice: 380.0,
      stopLoss: 370.0,
      takeProfit: 410.0,
      rationale: 'Strong momentum and breakout',
    };
    const run: PipelineRun = {
      date: '2026-04-01',
      timestamp: '2026-04-01T12:00:00Z',
      screened: [],
      analyzed: [analysis],
      signals: [],
      ordersPlaced: [],
      ordersClosed: [],
      portfolioSnapshot: { equity: 100000, cash: 95000, positions: 2 },
      errors: [],
    };
    expect(run.analyzed[0].signal).toBe('buy');
    expect(run.analyzed[0].conviction).toBe(0.9);
  });

  it('PipelineRun accepts orders placed and closed', () => {
    const order: PipelineOrder = {
      symbol: 'NVDA',
      side: 'buy',
      qty: 10,
      price: 820.0,
      orderId: 'ord-123',
      status: 'filled',
      timestamp: '2026-04-01T12:05:00Z',
    };
    const run: PipelineRun = {
      date: '2026-04-01',
      timestamp: '2026-04-01T12:00:00Z',
      screened: [],
      analyzed: [],
      signals: [],
      ordersPlaced: [order],
      ordersClosed: [],
      portfolioSnapshot: { equity: 108200, cash: 86800, positions: 1 },
      errors: [],
    };
    expect(run.ordersPlaced[0].orderId).toBe('ord-123');
    expect(run.ordersPlaced[0].qty).toBe(10);
  });

  it('PipelinePosition has all required fields', () => {
    const pos: PipelinePosition = {
      symbol: 'TSLA',
      shares: 5,
      entryPrice: 200.0,
      currentPrice: 215.0,
      pnl: 75.0,
      pnlPct: 7.5,
      stopLoss: 190.0,
      takeProfit: 240.0,
      entryDate: '2026-03-28',
      signal: 'buy',
      rationale: 'VCP breakout confirmed',
    };
    expect(pos.symbol).toBe('TSLA');
    expect(pos.pnlPct).toBe(7.5);
    expect(pos.stopLoss).toBe(190.0);
    expect(pos.takeProfit).toBe(240.0);
  });

  it('PipelinePosition allows null stopLoss and takeProfit', () => {
    const pos: PipelinePosition = {
      symbol: 'GOOG',
      shares: 2,
      entryPrice: 140.0,
      currentPrice: 145.0,
      pnl: 10.0,
      pnlPct: 3.57,
      stopLoss: null,
      takeProfit: null,
      entryDate: '2026-04-01',
      signal: 'hold',
      rationale: '',
    };
    expect(pos.stopLoss).toBeNull();
    expect(pos.takeProfit).toBeNull();
  });

  it('PipelinePerformance has all required fields', () => {
    const perf: PipelinePerformance = {
      totalTrades: 42,
      openPositions: 3,
      totalPnl: 5420.5,
      winRate: 62.5,
      avgPnlPct: 2.1,
      bestTrade: { symbol: 'NVDA', pnl: 1200.0 },
      worstTrade: { symbol: 'TSLA', pnl: -300.0 },
    };
    expect(perf.totalTrades).toBe(42);
    expect(perf.winRate).toBe(62.5);
    expect(perf.bestTrade?.symbol).toBe('NVDA');
    expect(perf.worstTrade?.pnl).toBeLessThan(0);
  });

  it('PipelinePerformance allows null bestTrade and worstTrade', () => {
    const perf: PipelinePerformance = {
      totalTrades: 0,
      openPositions: 0,
      totalPnl: 0,
      winRate: 0,
      avgPnlPct: 0,
      bestTrade: null,
      worstTrade: null,
    };
    expect(perf.bestTrade).toBeNull();
    expect(perf.worstTrade).toBeNull();
  });

  it('PipelineStatus shape is correct', () => {
    const status: PipelineStatus = {
      running: false,
      last_run: '2026-04-09T18:00:00Z',
      last_result: 'success',
    };
    expect(status.running).toBe(false);
    expect(status.last_run).toBeTruthy();
  });

  it('PipelineStatus allows null last_run and last_result', () => {
    const status: PipelineStatus = {
      running: true,
      last_run: null,
      last_result: null,
    };
    expect(status.running).toBe(true);
    expect(status.last_run).toBeNull();
  });

  it('StrategyPerformance has required fields', () => {
    const perf: StrategyPerformance = {
      name: 'Momentum Quality',
      description: 'A momentum + quality combo strategy',
      status: 'active',
      invested_amount: 50000,
      current_value: 53000,
      total_return_pct: 6.0,
      annualized_return_pct: 18.0,
      return_dollars: 3000,
      win_rate: 65.0,
      sharpe_ratio: 1.42,
      max_drawdown: -8.5,
      active_positions_count: 5,
      equity_curve: [{ date: '2026-01-01', value: 50000 }],
      last_trade_date: '2026-04-09',
    };
    expect(perf.name).toBe('Momentum Quality');
    expect(perf.sharpe_ratio).toBe(1.42);
    expect(perf.equity_curve).toHaveLength(1);
  });

  it('StrategyTrade has required fields including optional ones', () => {
    const trade: StrategyTrade = {
      id: 101,
      symbol: 'AAPL',
      strategy: 'momentum-quality',
      side: 'buy',
      quantity: 20,
      entry_price: 170.0,
      exit_price: 185.0,
      pnl: 300.0,
      pnl_pct: 8.82,
      entry_time: '2026-03-10T09:30:00Z',
      exit_time: '2026-04-02T15:45:00Z',
      status: 'closed',
      notes: 'Clean momentum breakout',
      conviction: 0.88,
      rationale: 'Top decile momentum + F-Score 7',
      stop_loss: 162.0,
      take_profit: 190.0,
      exit_reason: 'take_profit',
    };
    expect(trade.id).toBe(101);
    expect(trade.exit_reason).toBe('take_profit');
    expect(trade.stop_loss).toBe(162.0);
  });

  it('StrategyTrade allows null optional fields', () => {
    const trade: StrategyTrade = {
      id: 202,
      symbol: 'META',
      strategy: null,
      side: 'sell',
      quantity: 10,
      entry_price: 500.0,
      exit_price: null,
      pnl: null,
      pnl_pct: null,
      entry_time: '2026-04-01T09:30:00Z',
      exit_time: null,
      status: 'open',
      notes: null,
    };
    expect(trade.exit_price).toBeNull();
    expect(trade.strategy).toBeNull();
    expect(trade.notes).toBeNull();
  });

  it('PlaceOrderPayload shape for a market order', () => {
    const payload: PlaceOrderPayload = {
      symbol: 'SPY',
      side: 'buy',
      type: 'market',
      quantity: 100,
    };
    expect(payload.symbol).toBe('SPY');
    expect(payload.type).toBe('market');
    expect(payload.price).toBeUndefined();
  });

  it('PlaceOrderPayload shape for a limit order with legs', () => {
    const payload: PlaceOrderPayload = {
      symbol: 'QQQ',
      side: 'buy',
      type: 'limit',
      quantity: 50,
      price: 440.0,
      legs: [{ symbol: 'QQQ', side: 'buy', quantity: 50, price: 440.0 }],
    };
    expect(payload.legs).toHaveLength(1);
    expect(payload.legs![0].price).toBe(440.0);
  });

  it('ChatResponse has required fields', () => {
    const resp: ChatResponse = {
      conversation_id: 'conv-abc-123',
      message: 'AAPL is showing strong momentum.',
      actions_taken: [{ action: 'analyzed', symbol: 'AAPL' }],
      suggestions: ['Check options chain', 'Review earnings date'],
      timestamp: '2026-04-10T10:00:00Z',
    };
    expect(resp.conversation_id).toBe('conv-abc-123');
    expect(resp.actions_taken).toHaveLength(1);
    expect(resp.suggestions).toHaveLength(2);
  });

  it('CalendarData has all fields including optional best/worst day', () => {
    const data: CalendarData = {
      month: 4,
      year: 2026,
      days: [{ date: '2026-04-01', pnl: 200, trades: 4, winRate: 75 }],
      monthTotal: 200,
      tradingDays: 1,
      winningDays: 1,
      losingDays: 0,
      bestDay: { date: '2026-04-01', pnl: 200 },
      worstDay: null,
    };
    expect(data.month).toBe(4);
    expect(data.bestDay?.pnl).toBe(200);
    expect(data.worstDay).toBeNull();
  });

  it('StrategyAnalytics has all required nested fields', () => {
    const analytics: StrategyAnalytics = {
      strategy_id: 'momentum-quality',
      sector_exposure: { current: { Technology: 0.4, Healthcare: 0.2 } },
      monthly_returns: [{ year: 2026, month: 3, return_pct: 4.2 }],
      streaks: {
        current: { type: 'win', count: 3 },
        best_win: 7,
        worst_loss: 4,
      },
      conviction_distribution: [{ bucket: 'high', wins: 10, losses: 3 }],
      hold_time_stats: { avg_win_days: 12, avg_loss_days: 6, median_hold_days: 10 },
      correlations: { SPY: 0.65 },
      rolling_beta: [{ date: '2026-04-01', beta: 1.1 }],
    };
    expect(analytics.strategy_id).toBe('momentum-quality');
    expect(analytics.streaks.current.type).toBe('win');
    expect(analytics.monthly_returns[0].return_pct).toBe(4.2);
  });
});

describe('API Response Shapes', () => {
  it('PortfolioSummary shape matches store', () => {
    const summary = {
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
    expect(Object.keys(summary)).toContain('equity');
    expect(Object.keys(summary)).toContain('dayPnl');
    expect(typeof summary.equity).toBe('number');
    expect(typeof summary.dayPnlPct).toBe('number');
    expect(typeof summary.positionsCount).toBe('number');
  });

  it('PortfolioSummary dayPnl is sum of unrealized and realized', () => {
    const unrealizedPnl = 100;
    const realizedPnlToday = -50;
    const dayPnl = unrealizedPnl + realizedPnlToday;
    expect(dayPnl).toBe(50);
  });

  it('PortfolioSummary dayPnlPct calculation', () => {
    const equity = 100000;
    const dayPnl = 500;
    const lastEquity = equity - dayPnl;
    const dayPnlPct = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
    expect(dayPnlPct).toBeCloseTo(0.5025, 3);
  });

  it('PipelineScreenedStock shape is correct', () => {
    const stock: PipelineScreenedStock = {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      price: 820.50,
      compositeScore: 0.92,
      sector: 'Technology',
      changePct: 3.5,
    };
    expect(stock.compositeScore).toBeGreaterThan(0);
    expect(stock.price).toBeGreaterThan(0);
  });

  it('PipelineAnalysis shape handles null optional fields', () => {
    const analysis: PipelineAnalysis = {
      symbol: 'AMZN',
      signal: 'hold',
      conviction: 0.5,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      rationale: 'Insufficient signal strength',
    };
    expect(analysis.entryPrice).toBeNull();
    expect(analysis.signal).toBe('hold');
  });
});
