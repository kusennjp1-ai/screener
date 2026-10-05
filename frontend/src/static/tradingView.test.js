import { describe, it, expect } from 'vitest';
import { tvSymbol, tradingViewUrl } from './tradingView';

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
