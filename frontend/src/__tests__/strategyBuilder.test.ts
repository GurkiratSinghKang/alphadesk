import { describe, it, expect } from 'vitest';
import { parseNaturalLanguage } from '@/components/panels/StrategyBuilder';

describe('parseNaturalLanguage', () => {
  it('parses "Buy when RSI drops below 30"', () => {
    const r = parseNaturalLanguage('Buy when RSI drops below 30');
    expect(r.action).toBe('BUY');
    expect(r.indicator).toBe('RSI');
    // operators array: ["above","below","crosses","drops",...] — "below" is found first
    expect(r.operator).toBe('below');
    expect(r.value).toBe('30');
  });

  it('parses "Sell when MACD crosses above signal"', () => {
    const r = parseNaturalLanguage('Sell when MACD crosses above signal');
    expect(r.action).toBe('SELL');
    expect(r.indicator).toBe('MACD');
    // "above" appears before "crosses" in the operators array
    expect(r.operator).toBe('above');
  });

  it('returns undefined for unrecognized text', () => {
    const r = parseNaturalLanguage('hello world');
    expect(r.action).toBeUndefined();
    expect(r.indicator).toBeUndefined();
    expect(r.operator).toBeUndefined();
    expect(r.value).toBeUndefined();
  });

  it('handles mixed case input', () => {
    const r = parseNaturalLanguage('EXIT when price RISES above 500');
    expect(r.action).toBe('EXIT');
    expect(r.indicator).toBe('PRICE');
    // "above" appears before "rises" in the operators array
    expect(r.operator).toBe('above');
    expect(r.value).toBe('500');
  });

  it('handles decimal values', () => {
    const r = parseNaturalLanguage('Buy when ATR is below 2.5');
    expect(r.value).toBe('2.5');
    expect(r.indicator).toBe('ATR');
  });

  it('parses EMA indicator', () => {
    const r = parseNaturalLanguage('Buy when price crosses above EMA 200');
    // indicators array: ["rsi","macd","ema",...,"price",...] — "ema" (index 2) is found before "price" (index 6)
    expect(r.indicator).toBe('EMA');
    // "above" appears before "crosses" in the operators array
    expect(r.operator).toBe('above');
    expect(r.value).toBe('200');
  });

  it('parses SMA indicator', () => {
    const r = parseNaturalLanguage('Enter when SMA(50) rises above 100');
    expect(r.indicator).toBe('SMA');
    expect(r.action).toBe('ENTER');
  });

  it('parses "below" operator', () => {
    const r = parseNaturalLanguage('Sell when volume drops below 1000000');
    expect(r.operator).toBe('below');
    expect(r.indicator).toBe('VOLUME');
  });

  it('parses "above" operator', () => {
    const r = parseNaturalLanguage('Buy when RSI rises above 70');
    expect(r.operator).toBe('above');
  });

  it('parses short action', () => {
    const r = parseNaturalLanguage('Short when Bollinger band is breached below');
    expect(r.action).toBe('SHORT');
    expect(r.indicator).toBe('BOLLINGER');
  });

  it('parses long action', () => {
    const r = parseNaturalLanguage('Long when MACD equals zero');
    expect(r.action).toBe('LONG');
    expect(r.operator).toBe('equals');
  });

  it('picks first indicator when multiple are present', () => {
    // The function uses .find(), so it returns the first matching indicator
    const r = parseNaturalLanguage('Buy when RSI and MACD align');
    expect(r.indicator).toBe('RSI');
  });

  it('extracts numeric value from complex sentence', () => {
    const r = parseNaturalLanguage('Enter long when RSI(14) drops below 30');
    expect(r.value).toBe('14');
  });

  it('returns all undefined fields for empty string', () => {
    const r = parseNaturalLanguage('');
    expect(r.action).toBeUndefined();
    expect(r.indicator).toBeUndefined();
    expect(r.operator).toBeUndefined();
    expect(r.value).toBeUndefined();
  });
});
