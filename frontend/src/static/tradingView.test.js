import { describe, it, expect } from 'vitest';
import { tvSymbol, tradingViewUrl, buildPineScript } from './tradingView';

describe('tvSymbol', () => {
  it('leaves US tickers bare (TradingView resolves them)', () => {
    expect(tvSymbol('NVDA', 'US')).toBe('NVDA');
    expect(tvSymbol('nvda')).toBe('NVDA');
  });
  it('prefixes non-US markets with the exchange and strips suffixes', () => {
    expect(tvSymbol('0700.HK', 'HK')).toBe('HKEX:0700');
    expect(tvSymbol('7203.T', 'JP')).toBe('TSE:7203');
    expect(tvSymbol('2330.TW', 'TW')).toBe('TWSE:2330');
  });
  it('falls back to a bare ticker for unknown markets', () => {
    expect(tvSymbol('FOO', 'ZZ')).toBe('FOO');
  });
  it('returns null for empty input', () => {
    expect(tvSymbol('')).toBeNull();
    expect(tvSymbol(null)).toBeNull();
  });
});

describe('tradingViewUrl', () => {
  it('builds an encoded chart URL', () => {
    expect(tradingViewUrl('NVDA', 'US')).toBe('https://www.tradingview.com/chart/?symbol=NVDA');
    expect(tradingViewUrl('0700.HK', 'HK')).toBe('https://www.tradingview.com/chart/?symbol=HKEX%3A0700');
  });
  it('returns null without a symbol', () => {
    expect(tradingViewUrl(null)).toBeNull();
  });
});

describe('buildPineScript', () => {
  it('emits a v5 overlay with all plan levels and the buy zone', () => {
    const pine = buildPineScript({
      symbol: 'NVDA', asOf: '2026-07-21', pivot: 132.5, stop: 124.1, stopPct: 6.3,
      target2r: 149.3, target3r: 157.7,
    });
    expect(pine).toContain('//@version=5');
    expect(pine).toContain('indicator("Screener Plan — NVDA", overlay=true)');
    expect(pine).toContain('pivot = 132.5');
    expect(pine).toContain('zoneHi = 139.125'); // 132.5 * 1.05
    expect(pine).toContain('stop = 124.1  // -6.3%');
    expect(pine).toContain('hline(149.3, "2R target"');
    expect(pine).toContain('hline(157.7, "3R target"');
    expect(pine).toContain('bgcolor(close >= pivot and close <= zoneHi');
  });

  it('omits levels that are missing rather than emitting NaN', () => {
    const pine = buildPineScript({ symbol: 'XYZ', pivot: 50, stop: 47 });
    expect(pine).toContain('pivot = 50');
    expect(pine).toContain('stop = 47');
    expect(pine).not.toContain('2R target');
    expect(pine).not.toContain('3R target');
    expect(pine).not.toContain('NaN');
    expect(pine).not.toContain('undefined');
  });

  it('never emits NaN when nothing is provided', () => {
    const pine = buildPineScript({});
    expect(pine).toContain('//@version=5');
    expect(pine).not.toContain('NaN');
    expect(pine).not.toMatch(/pivot =|stop =/);
  });
});
