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

  it('mean-reversion has Medium risk', () => {
    expect(STRATEGY_CONTENT['mean-reversion'].riskProfile.level).toBe('Medium');
  });

  it('mean-reversion content is explicit that the strategy is planned', () => {
    const c = STRATEGY_CONTENT['mean-reversion'];
    expect(c.thesis).toContain('planned catalogue concept');
    expect(c.thesis).toContain('rsi2-reversal');
    expect(c.parameters.maxPositions).toContain('0 live');
    expect(c.risks[0]).toContain('No backend implementation');
  });

  it('pead has Medium risk', () => {
    expect(STRATEGY_CONTENT['pead'].riskProfile.level).toBe('Medium');
  });

  it('momentum-quality thesis mentions momentum', () => {
    const thesis = STRATEGY_CONTENT['momentum-quality'].thesis.toLowerCase();
    expect(thesis).toContain('momentum');
  });

  it('pead thesis mentions earnings', () => {
    const thesis = STRATEGY_CONTENT['pead'].thesis.toLowerCase();
    expect(thesis).toContain('earnings');
  });

  it('pead workflow copy distinguishes AMC and BMO timing', () => {
    const copy = STRATEGY_CONTENT['pead'].howItWorks.join(' ');
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
    expect(c.howItWorks.join(' ')).toContain('options_chain_available=false');
    expect(c.parameters.maxPositions).toContain('0 live');
  });

  it('claude-alpha mentions LLM or Claude', () => {
    const thesis = STRATEGY_CONTENT['claude-alpha'].thesis;
    expect(thesis).toContain('Claude');
  });

  it('claude-alpha content is explicit that the strategy is planned', () => {
    const c = STRATEGY_CONTENT['claude-alpha'];
    expect(c.thesis).toContain('planned research concept');
    expect(c.parameters.maxPositions).toContain('0 live');
    expect(c.risks[0]).toContain('No backend implementation');
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
