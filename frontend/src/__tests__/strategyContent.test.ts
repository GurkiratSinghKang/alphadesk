import { describe, it, expect } from 'vitest';
import { STRATEGY_CONTENT } from '@/lib/strategy-content';
import type { StrategyContent } from '@/lib/strategy-content';

describe('Strategy Content', () => {
  it('has content for known strategies', () => {
    const keys = Object.keys(STRATEGY_CONTENT);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('each strategy has thesis and parameters', () => {
    for (const [, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.thesis).toBeTruthy();
      expect(content.edge).toBeTruthy();
      expect(content.parameters).toBeDefined();
    }
  });

  it('includes momentum-quality strategy', () => {
    expect(STRATEGY_CONTENT['momentum-quality']).toBeDefined();
  });

  it('includes pead strategy', () => {
    expect(STRATEGY_CONTENT['pead']).toBeDefined();
  });

  it('includes vrp-harvesting strategy', () => {
    expect(STRATEGY_CONTENT['vrp-harvesting']).toBeDefined();
  });

  it('includes earnings-vol-premium strategy', () => {
    expect(STRATEGY_CONTENT['earnings-vol-premium']).toBeDefined();
  });

  it('earnings-vol-premium content matches the checked-in OOS artifact', () => {
    const c = STRATEGY_CONTENT['earnings-vol-premium'];
    expect(c.thesis).toContain('Sharpe 1.43');
    expect(c.thesis).not.toContain('Sharpe 6.10');
    expect(c.parameters.maxPositions).toBe('1');
    expect(c.parameters.entryCriteria).toContain('1.7555');
  });

  it('includes regime-adaptive strategy', () => {
    expect(STRATEGY_CONTENT['regime-adaptive']).toBeDefined();
  });

  it('includes claude-alpha strategy', () => {
    expect(STRATEGY_CONTENT['claude-alpha']).toBeDefined();
  });

  it('includes mean-reversion strategy', () => {
    expect(STRATEGY_CONTENT['mean-reversion']).toBeDefined();
  });

  it('includes vcp-breakout strategy', () => {
    expect(STRATEGY_CONTENT['vcp-breakout']).toBeDefined();
  });

  it('has all strategies documented', () => {
    // 13 original + 7 new TA strategies = 20
    expect(Object.keys(STRATEGY_CONTENT).length).toBeGreaterThanOrEqual(20);
  });

  it('each strategy has a valid risk profile', () => {
    for (const [, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(['Low', 'Medium', 'High']).toContain(content.riskProfile.level);
      expect(content.riskProfile.description).toBeTruthy();
    }
  });

  it('each strategy parameters has all required fields', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      const p = content.parameters;
      expect(p.rebalanceFrequency, `${id} missing rebalanceFrequency`).toBeTruthy();
      expect(p.universe, `${id} missing universe`).toBeTruthy();
      expect(p.positionSizing, `${id} missing positionSizing`).toBeTruthy();
      expect(p.entryCriteria, `${id} missing entryCriteria`).toBeTruthy();
      expect(p.exitCriteria, `${id} missing exitCriteria`).toBeTruthy();
      expect(p.maxPositions, `${id} missing maxPositions`).toBeTruthy();
    }
  });

  it('momentum-quality has Medium risk', () => {
    expect(STRATEGY_CONTENT['momentum-quality'].riskProfile.level).toBe('Medium');
  });

  it('vrp-harvesting has High risk', () => {
    expect(STRATEGY_CONTENT['vrp-harvesting'].riskProfile.level).toBe('High');
  });

  it('vcp-breakout has High risk', () => {
    expect(STRATEGY_CONTENT['vcp-breakout'].riskProfile.level).toBe('High');
  });

  it('planned catalogue strategies are explicit about no backend implementation', () => {
    // R6-6: sector-rotation removed from this list — PR #32 shipped a real
    // backend package (`backend/strategies/sector_rotation/`) with
    // `StrategyStatus.ACTIVE`. Its frontend copy was rewritten to describe
    // the actual rotation logic (see the dedicated spec below).
    for (const id of ['vcp-breakout', 'dividend-capture', 'gap-fill']) {
      const c = STRATEGY_CONTENT[id];
      expect(c.thesis, id).toContain('not an implemented AlphaDesk backend strategy yet');
      expect(c.parameters.maxPositions, id).toContain('0 live');
      expect(c.howItWorks![0], id).toContain('Do not emit live orders today');
      expect(c.risks![0], id).toContain('No backend implementation');
    }
  });

  it('sector-rotation copy reflects the live backend package (R6-6 / PR #32)', () => {
    const c = STRATEGY_CONTENT['sector-rotation'];
    // No longer a "planned catalogue concept" — the package ships real signals.
    expect(c.thesis).not.toContain('planned catalogue concept');
    expect(c.thesis).not.toContain('not an implemented AlphaDesk backend strategy');
    // Names the actual GICS sector universe and the bond-fallback risk-off rule.
    expect(c.thesis).toContain('11 GICS sector SPDR ETFs');
    expect(c.thesis).toContain('XLK');
    expect(c.thesis).toContain('AGG');
    expect(c.thesis).toContain('SPY');
    // Live position sizing — no "0 live" caveat.
    expect(c.parameters.maxPositions).toBe('3 (configurable via `top_n`, range 1-11)');
    expect(c.howItWorks![0]).toContain('last NYSE trading session');
    expect(c.risks![0]).toContain('Concentration risk');
  });

  it('mean-reversion has Medium risk', () => {
    expect(STRATEGY_CONTENT['mean-reversion'].riskProfile.level).toBe('Medium');
  });

  it('mean-reversion content is explicit that the strategy is planned', () => {
    const c = STRATEGY_CONTENT['mean-reversion'];
    expect(c.thesis).toContain('planned catalogue concept');
    expect(c.thesis).toContain('rsi2-reversal');
    expect(c.parameters.maxPositions).toContain('0 live');
    expect(c.risks![0]).toContain('No backend implementation');
  });

  it('pead has Medium risk', () => {
    expect(STRATEGY_CONTENT['pead'].riskProfile.level).toBe('Medium');
  });

  it('momentum-quality thesis mentions momentum', () => {
    const thesis = STRATEGY_CONTENT['momentum-quality'].thesis.toLowerCase();
    expect(thesis).toContain('momentum');
  });

  it('momentum-quality copy distinguishes default 12-1 from checked-in 12-0 tune', () => {
    const c = STRATEGY_CONTENT['momentum-quality'];
    expect(c.thesis).toContain('checked-in 2023-2024 OOS tune used momentum_skip_m=0');
    expect(c.parameters.entryCriteria).toContain('checked-in OOS artifact used momentum_skip_m=0');
    expect(c.howItWorks!.join(' ')).toContain('12-1 month by backend default, 12-0 month in the checked-in OOS tune');
  });

  it('ts-momentum copy caveats crisis alpha when shorts are disabled', () => {
    const c = STRATEGY_CONTENT['ts-momentum'];
    expect(c.edge).toContain('Crisis-alpha behavior requires short legs');
    expect(c.edge).toContain('shorts off');
  });

  it('dual-momentum copy uses checked-in defaults, not diagnostic tuned variant', () => {
    const c = STRATEGY_CONTENT['dual-momentum'];
    expect(c.thesis).toContain('checked-in 2023-2024 OOS artifact uses textbook defaults');
    expect(c.thesis).toContain('variant is intentionally excluded');
    expect(c.thesis).not.toContain('Best tuned');
  });

  it('pead thesis mentions earnings', () => {
    const thesis = STRATEGY_CONTENT['pead'].thesis.toLowerCase();
    expect(thesis).toContain('earnings');
  });

  it('pead workflow copy distinguishes AMC and BMO timing', () => {
    const copy = STRATEGY_CONTENT['pead'].howItWorks!.join(' ');
    expect(copy).toContain('AMC rows from the prior session');
    expect(copy).toContain('BMO rows dated today');
  });

  it('vrp-harvesting edge mentions volatility', () => {
    const edge = STRATEGY_CONTENT['vrp-harvesting'].edge.toLowerCase();
    expect(edge).toContain('volatility');
  });

  it('vrp-harvesting copy makes research-shell status explicit', () => {
    const c = STRATEGY_CONTENT['vrp-harvesting'];
    expect(c.thesis.toLowerCase()).toContain('research-only');
    expect(c.howItWorks!.join(' ')).toContain('options_chain_available=false');
    expect(c.parameters.maxPositions).toContain('0 live');
  });

  it('pairs-trading content matches the checked-in log-price OOS artifact', () => {
    const c = STRATEGY_CONTENT['pairs-trading'];
    expect(c.thesis).toContain('OOS Sharpe is 0.39');
    expect(c.thesis).toContain('96 trades');
    expect(c.thesis).toContain('older 1.23 Sharpe raw-price artifact is intentionally retired');
    expect(c.parameters.entryCriteria).toContain('2.48');
  });

  it('kama-breakout copy is paper-only and does not promise pyramiding', () => {
    const c = STRATEGY_CONTENT['kama-breakout'];
    expect(c.thesis).toContain('structured OOS artifact is now checked in');
    expect(c.thesis).toContain('paper-only');
    expect(c.howItWorks!.join(' ')).toContain('No pyramiding in the current backend');
    expect(c.howItWorks!.join(' ')).not.toContain('Pyramid at +1 ATR');
  });

  it('orb copy is explicit that the registered backend is research-only', () => {
    const c = STRATEGY_CONTENT['orb'];
    expect(c.thesis).toContain('research-only registered strategy');
    expect(c.thesis).toContain('Sharpe 4.78');
    expect(c.thesis).not.toContain('Sharpe 8.34');
    expect(c.parameters.maxPositions).toBe('0 live');
  });

  it('vwap-strategy copy is explicit that the registered backend is research-only', () => {
    const c = STRATEGY_CONTENT['vwap-strategy'];
    expect(c.thesis).toContain('research-only registered strategy');
    expect(c.thesis).toContain('2024-H1 Sharpe 0.95');
    expect(c.parameters.maxPositions).toContain('0 live');
    expect(c.howItWorks![0]).toContain('emits no signals');
  });

  it('claude-alpha mentions LLM or AI', () => {
    const thesis = STRATEGY_CONTENT['claude-alpha'].thesis;
    expect(thesis).toMatch(/\bAI\b|\bLLM\b|large language model/i);
  });

  it('claude-alpha content is explicit that the strategy is planned', () => {
    const c = STRATEGY_CONTENT['claude-alpha'];
    expect(c.thesis).toContain('planned research concept');
    expect(c.parameters.maxPositions).toContain('0 live');
    expect(c.risks![0]).toContain('No backend implementation');
  });

  it('all strategies have non-empty thesis (at least 100 chars)', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.thesis.length, `${id} thesis too short`).toBeGreaterThan(100);
    }
  });

  it('all strategies have non-empty edge (at least 20 chars)', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.edge.length, `${id} edge too short`).toBeGreaterThan(20);
    }
  });

  it('StrategyContent type is correctly structured', () => {
    const content: StrategyContent = STRATEGY_CONTENT['momentum-quality'];
    expect(typeof content.thesis).toBe('string');
    expect(typeof content.edge).toBe('string');
    expect(typeof content.riskProfile.level).toBe('string');
    expect(typeof content.riskProfile.description).toBe('string');
    expect(typeof content.parameters.maxPositions).toBe('string');
  });

  it('maxPositions is a string representation of a number or descriptive text', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      const maxPos = content.parameters.maxPositions;
      // Should start with a digit or be a descriptive string (e.g. "No limit ...")
      expect(maxPos, `${id} maxPositions should be non-empty`).toBeTruthy();
    }
  });
});
