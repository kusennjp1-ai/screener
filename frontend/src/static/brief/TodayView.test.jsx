// Today's watch tile (TodayView, E): only the weakness side is counted (no holding is registered), 0件 only when
// every watched stock was checked, and unlisted, unchecked and limited stocks are said, never counted as checked.
import { describe, expect, it } from 'vitest';
import { watchAttention } from './TodayView';

const view = symbol => ({ symbol });
const quiet = { strength: [], weakness: [], hits: 0, strengthHits: 0, weaknessHits: 0 };
const weak = { ...quiet, hits: 1, weaknessHits: 1 };
const climax = { ...quiet, hits: 4, strengthHits: 4 };
const tile = over => watchAttention({ state: 'ready', watched: [], watchCount: 0, unlisted: [], sells: {}, ...over });

describe('the watch tile', () => {
  it('reads 0件 only when every watched stock was checked, with 保有未登録', () => {
    expect(tile({ watched: ['A', 'B', 'C', 'D'].map(view), watchCount: 4, sells: { A: quiet, B: quiet, C: quiet, D: quiet } }))
      .toEqual({ value: '0件', note: '4銘柄を確認・保有未登録', flagged: [] });
  });

  it('counts the stocks whose weakness check fired; a climax alone is a holding\'s signal and is not counted', () => {
    expect(tile({ watched: ['A', 'B', 'C'].map(view), watchCount: 3, sells: { A: weak, B: climax, C: quiet } }))
      .toEqual({ value: '1件', note: '3銘柄を確認・保有未登録', flagged: ['A'] });
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: climax, B: climax } }).value).toBe('0件');
  });

  it('says 確認中 while checks load, never 0件', () => {
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: quiet } })).toEqual({ value: '確認中', note: '2銘柄を確認中・保有未登録', flagged: [] });
    // A fired check is counted as soon as it is in.
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: weak } }).value).toBe('1件');
  });

  it('says unlisted symbols: 7銘柄中6銘柄を確認・1銘柄は対象外（未確認）', () => {
    const watched = ['A', 'B', 'C', 'D', 'E', 'F'].map(view);
    const result = tile({ watched, watchCount: 7, unlisted: ['QQQX'], sells: Object.fromEntries(watched.map(v => [v.symbol, quiet])) });
    expect(result).toEqual({ value: '未確認', note: '7銘柄中6銘柄を確認・1銘柄は対象外（未確認）・保有未登録', flagged: [] });
    expect(tile({ watchCount: 1, unlisted: ['QQQX'] })).toEqual({ value: '未確認', note: '1銘柄中0銘柄を確認・1銘柄は対象外（未確認）・保有未登録', flagged: [] });
  });

  it('says the 12-stock limit and other unchecked stocks as text', () => {
    const watched = Array.from({ length: 13 }, (_, i) => view(`S${i}`));
    const sells = Object.fromEntries(watched.map((v, i) => [v.symbol, i < 12 ? quiet : { unknown: true, limit: 12, reason: '確認は先頭12銘柄まで' }]));
    expect(tile({ watched, watchCount: 13, sells })).toEqual({ value: '未確認', note: '13銘柄中12銘柄を確認・1銘柄は未確認（上限12銘柄）・保有未登録', flagged: [] });
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: quiet, B: { unknown: true, reason: '日足を取得できません' } } }).note).toBe('2銘柄中1銘柄を確認・1銘柄は未確認・保有未登録');
  });

  it('keeps the bundle\'s state before anything is counted, and 未登録 only for an empty watch list', () => {
    expect(tile({ state: 'loading', watchCount: 3 })).toEqual({ value: '読込中', note: '3銘柄を登録', flagged: [] });
    expect(tile({ state: 'error', watchCount: 1 })).toEqual({ value: '取得できません', note: '1銘柄を登録', flagged: [] });
    expect(tile({})).toEqual({ value: '未登録', note: '☆で追加', flagged: [] });
    expect(tile({ state: 'loading' })).toEqual({ value: '未登録', note: '☆で追加', flagged: [] });
  });
});
