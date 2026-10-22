import { describe, expect, it } from 'vitest';
import { BOOK_SOURCE_PAGE_NOTE, BOOK_SOURCE_SCOPE_NOTE, entrySourceContext, entryUseSourceContext, financialSourceContext, trendTemplateSourceContext } from './bookSourceContext';
import { entryPlan } from './researchEngine';

describe('confirmed named sources versus unchanged application conditions', () => {
  it.each([[null, 'unknown'], [NaN, 'unknown'], [-.1, 'waiting'], [0, 'near'], [2, 'near'], [2.01, 'edge'], [3, 'edge'], [3.01, 'beyond']])('preserves proximity state at %j without certifying a setup', (distance, state) => {
    const result = entrySourceContext('minervini', 5, distance);
    expect(result.state).toBe(state);
    expect(result.warning).toBe(state === 'beyond');
    expect(result.detail).toContain('『株式トレード 基本と原則』PDF 245頁');
    expect(result.detail).toContain('『ミネルヴィニの成長株投資法』方式の5%上限はアプリ設定');
  });
  it('preserves every method price model and warning scope at +4%', () => {
    const row = { current_price: 104, se_pivot_price: 100 };
    expect(entryPlan(row, null, 'minervini')).toMatchObject({ state: '買いゾーン内', zone: 5, upper: 105, sourceContext: { warning: true, state: 'beyond' } });
    expect(entryPlan(row, null, 'minervini2')).toMatchObject({ state: '買いゾーン超過', zone: 3, upper: 103, sourceContext: { warning: false, state: 'unverified' } });
    expect(entryPlan(row, null, 'ibd')).toMatchObject({ state: '買いゾーン内', zone: 5, upper: 105, sourceContext: { warning: false, state: 'unverified' } });
    expect(entrySourceContext('minervini2', 3, 4).detail).toContain('現在の3%上限はアプリ設定');
    expect(entrySourceContext('oneil', 5, 4).detail).toContain('全方式共通の購入条件にはしていません');
  });
  it('does not confirm proximity when pivot or price is unavailable', () => {
    expect(entryPlan({ current_price: 100 }, null, 'minervini').sourceContext.state).toBe('unknown');
  });
  it.each([
    ['minervini', 'ミネルヴィニの成長株投資法', '151–152', '30'],
    ['minervini2', '株式トレード 基本と原則', '221–222', '25'],
  ])('attributes %s to its confirmed title and physical PDF pages', (method, title, pages, low) => {
    const text = trendTemplateSourceContext(method);
    for (const item of [`『${title}』`, `PDF ${pages}頁`, `52週安値より${low}%以上`, '52週高値から25%以内', 'RS順位70以上', '近似判定8件', '独自の日足品質確認1件', '21営業日前', '52暦週', '252本以上の日足', '取引所営業日との一致', '傾き・RSとの同等性は未検証']) expect(text).toContain(item);
    expect(text).not.toContain('52週を252営業日とする窓');
    expect(text).not.toMatch(/第[12]冊|25%指定は未確認|Kindle/);
  });
  it.each(['oneil', 'ibd'])('does not attribute a Minervini trend template to %s', method => {
    expect(trendTemplateSourceContext(method)).toBeNull();
  });
  it('separates the O’Neil source from the stricter annual and narrower sales implementation', () => {
    const text = financialSourceContext('oneil');
    for (const item of ['『オニールの相場師養成講座』PDF 197頁', '年率複利25%以上と過去3年の各年増益', '各年EPS成長率25%以上', 'より厳しい独自条件', '原典と同一ではありません', 'PDF 66・197・202頁', 'または直近3四半期の前年同期比成長率の加速', 'より狭い独自条件', '判定を切り替えたものではありません']) expect(text).toContain(item);
  });
  it.each(['minervini', 'minervini2', 'ibd'])('does not attach the O’Neil explanation to %s', method => {
    expect(financialSourceContext(method)).toBeNull();
  });
  it('keeps 2–3% source meanings distinct and never converts them into account risk or VCP depth', () => {
    const text = entryUseSourceContext();
    expect(text).toContain('『株式トレード 基本と原則』PDF 245頁の約2〜3%はピボットからの追随幅');
    expect(text).toContain('『成長株投資の神』（Zanger）PDF 181頁の2〜3%は価格の損切り幅');
    expect(text).toContain('『オニールの相場師養成講座』PDF 147・212頁の2〜3%は買増しの間隔');
    expect(text).toContain('全冊共通の売買基準、口座資金に対するリスク率、VCPの収縮深度には置き換えません');
  });
  it('explains physical page numbering and limited review without exposing private document locations', () => {
    expect(BOOK_SOURCE_PAGE_NOTE).toContain('PDFの先頭を1');
    expect(BOOK_SOURCE_PAGE_NOTE).toContain('紙面頁とは異なります');
    expect(BOOK_SOURCE_SCOPE_NOTE).toContain('全文精読や全230規則の実装を意味しません');
    const texts = [BOOK_SOURCE_PAGE_NOTE, BOOK_SOURCE_SCOPE_NOTE, entryUseSourceContext(), financialSourceContext('oneil'), ...['minervini', 'minervini2', 'oneil', 'ibd'].flatMap(method => [trendTemplateSourceContext(method), entrySourceContext(method, 5, 4).detail])].filter(Boolean).join('\n');
    expect(texts).not.toMatch(/https?:|drive\.google|Kindle|第[12]冊/);
  });
});
