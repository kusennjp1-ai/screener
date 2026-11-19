// @vitest-environment node
// Today's gate card (plan S1-P4): the 地合い region rendered from the states of plan S1-P2's table, opened from the browser
// fixture (tests/static/brief-fixture.js, frozen) with the specs' own mutators (copied with their source lines, as
// marketGate.test.js copies them). The first fold is what the card shows with its fold closed; the fold opens in place at 1024px.
// The node environment reads the fixture from disk (its calendar file); the card is rendered to markup and read with jsdom.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import { date, marketTrends, rows as FIXTURE_ROWS, sessions } from '../../../tests/static/brief-fixture.js';
import { marketLines, modelMarket } from '../portfolioPlan';
import { marketCardView, verdictBasis, verdictBasisShort } from './marketTabModel';
import { gateReads } from './marketGateFacts';
import { gateFacts, marketGate } from './marketGate';
import MarketCard from './MarketCard';
import TodayGate, { GUIDE_UNTESTED } from './TodayGate';

// brief-market-r3.spec.js:60-61
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
// brief-market-r3.spec.js:63
const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
// brief-market-r3.spec.js:295
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
// brief-market-r3.spec.js:383-384 (with d = 2: the FTD conflict of brief-market-phone.spec.js:395-398)
const gspcRally = d => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), last = dates.length - 1;
  Object.assign(value.indices[0].followThrough, { state: 'rally_attempt', low: { date: dates[last - d], low: 4980 }, attempt: { startDate: dates[last - d + 1], day: d }, ftd: null, events: [] }); } });
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
const apply = (fn, value) => { const copy = structuredClone(value); fn?.(copy); return copy; };

/** One state as Today reads it (marketGate.test.js's open): the verdict, its lines, the trends query and the manifest. */
function state({ mutate = {}, historyEnd = date, fail = null, loading = false, target = null, late = null } = {}) {
  const rows = apply(mutate.rows, FIXTURE_ROWS);
  const market = fail === 'manifest' || loading ? null : modelMarket(rows), lines = market ? marketLines(rows) : { above50: null, above200: null };
  const data = JSON.parse(marketTrends({ historyEnd, mutate: mutate.trends }).text);
  const trends = loading ? { loading: true } : fail === 'series' ? { error: true, failureReason: Object.assign(new Error('Failed to load static data: series (404)'), { name: 'Error' }) } : { data, loading: false };
  const manifest = fail === 'manifest' ? null : apply(mutate.manifest, { as_of_date: date, markets: { US: { as_of_date: date } } });
  return { market, marketLoading: loading, lines, trends, manifest, target, late };
}
let doc = null;
const mount = element => { doc = new JSDOM(`<!doctype html><body>${renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>)}</body>`).window.document; };
const cleanup = () => { doc = null; };
const show = (input, { wide = false, tileLine = null } = {}) => mount(<MarketCard market={input.market} marketLoading={input.marketLoading} trends={input.trends} date={date}
  manifest={input.manifest} lines={input.lines} target={input.target} late={input.late} wide={wide} tileLine={tileLine} />);
const regions = () => [...doc.querySelectorAll('section')].filter(node => node.getAttribute('aria-label') === '地合い' || doc.getElementById(node.getAttribute('aria-labelledby') ?? '')?.textContent === '地合い');
const region = () => { const found = regions(); expect(found).toHaveLength(1); return found[0]; };
const textOf = selector => region().querySelector(selector)?.textContent ?? null;
/** The card's text with its fold closed: everything but the closed fold's body (the summary line stays). */
const firstFold = () => { const node = region().cloneNode(true); node.querySelectorAll('details:not([open]) > .brief-expander-body').forEach(body => body.remove()); return node.textContent; };
const foldText = () => region().querySelector('.brief-gate-more .brief-expander-body').textContent;
const LATE = { tone: 'warn', age: '2営業日前', detail: '（10/5・10/6 未反映）', note: '' };


describe('Today\'s gate card on a phone (fold closed)', () => {
  it('上昇トレンド 50%: the answer with 独自判定, the labelled figure and its definition, one 根拠 line with 実測, the sign, nothing trimmed', () => {
    const input = state();
    show(input, { tileLine: 'NAS調整中：〈sentence〉' });
    const text = firstFold();
    expect(region().querySelector('h2').textContent).toBe('地合い');
    expect(textOf('.brief-gate-kicker')).toMatch(/^地合い・10\/2（金）引け市場の詳細 ›$/);
    expect(textOf('.brief-gate-headline')).toMatch(/^新規の買いを検討できる（独自判定）$/);
    expect(textOf('.brief-gate-figure')).toMatch(/^新規買いの目安（独自設定）最大50%$/);
    expect(text).toContain('最大50%＝新規建ての上限（口座比・独自設定）');
    // The first fold says the 根拠 in its short form (ledger step 3), with 実測; the fold says the market tab's own words.
    expect(textOf('.brief-gate-basis')).toBe(`${verdictBasisShort(input.market, date)}（実測）`);
    expect(textOf('.brief-gate-basis')).toBe('根拠：SPYが50日線・200日線の上で、局面判定が「上昇トレンド」（実測）');
    expect(textOf('.brief-gate-more .brief-gate-basis-full')).toBe(`${verdictBasis(input.market, date).text}（実測）`);
    expect(firstFold()).not.toContain('スキャン時点');
    expect(textOf('.brief-gate-sign')).toMatch(/^NAS調整中$/);
    // No condition is unmet on a 50% day: no condition line in the first fold; the met ones are in the fold.
    expect(region().querySelector('.brief-gate-conds')).toBeNull();
    expect(foldText()).toContain('目安が動く条件（独自設定）SPY終値が200日線・50日線の上：達成局面判定が上昇トレンド／上昇に圧力：達成');
    expect(textOf('details > summary')).toContain('根拠と目安が動く条件');
    // The sign's sentence, the four facts, the kinds and 未検証 are in the fold, never in the first fold.
    expect(foldText()).toContain('NAS調整中：〈sentence〉');
    expect(foldText()).toContain(GUIDE_UNTESTED);
    for (const words of ['分配日（25日）', '52週の新高値・新安値', '200日線より上', 'TT達成数', '未検証']) expect(text).not.toContain(words);
    // TT達成 appears once on the card; the IBD line is outside the fold, last.
    expect([...region().querySelectorAll('small')].filter(node => /^TT達成/.test(node.textContent)).map(node => node.textContent)).toEqual(['TT達成数']);
    expect([...region().querySelectorAll(':scope > .brief-note')].at(-1).textContent).toBe('地合いの判定・各集計・RS推計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。');
    expect(region().textContent).not.toMatch(/条件中|目安≤/);
  });

  it('50日線割れ 0%: 買いは控える, 0% with its definition, each unmet condition by name, the met one in the fold', () => {
    show(state({ mutate: below50Rows }));
    const text = firstFold();
    expect(textOf('.brief-gate-headline')).toMatch(/^買いは控える（独自判定）$/);
    expect(textOf('.brief-gate-figure')).toMatch(/^新規買いの目安（独自設定）0%$/);
    expect(text).toContain('0%＝新規建ての上限（口座比・独自設定）');
    expect(textOf('.brief-gate-conds')).toMatch(/^買いの再開の条件（独自設定）SPY終値が50日線の上：未達局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）$/);
    expect(foldText()).toContain('SPY終値が200日線の上：達成');
    expect(text).not.toContain('達成：');
    expect(textOf('details > summary')).toContain('根拠と再開の条件');
  });

  it('never prints 0%, 未達 or 達成, and no figure, while the market is unknown or loading', () => {
    for (const input of [state({ fail: 'manifest' }), state({ loading: true })]) {
      show(input);
      const text = firstFold();
      expect(text).not.toMatch(/%|未達|達成/);
      expect(region().querySelector('.brief-gate-figure')).toBeNull();
      expect(text).not.toContain('新規建ての上限');
      cleanup();
    }
    show(state({ fail: 'manifest' }));
    expect(textOf('.brief-gate-headline')).toMatch(/^買いは見送り$/);
    expect(textOf('.brief-gate-conds')).toMatch(/^再開の条件：未確認$/);
    expect(textOf('details > summary')).toContain('根拠（未確認の項目）');
    cleanup();
    // Without a publication there is no analysis date: the kicker names the subject alone, never a stray character.
    mount(<MarketCard market={null} trends={{ data: null }} date={null} wide={false} />);
    expect(textOf('.brief-gate-kicker')).toBe('地合い市場の詳細 ›');
    cleanup();
    show(state({ loading: true }));
    expect(textOf('.brief-gate-headline')).toMatch(/^読込中$/);
    expect(region().querySelector('.brief-gate-conds')).toBeNull();
  });

  it('a newer closed session with an open guide: the waiting form, never 検討, the figure dated, the late age in the kicker', () => {
    for (const cap of ['m50', 'm25']) {
      const mutate = cap === 'm25' ? { rows: rows => { for (const row of rows) row.market_regime = 'uptrend_under_pressure'; } } : {};
      show(state({ mutate, target: '2026-10-06', late: LATE }));
      expect(textOf('.brief-gate-headline')).toMatch(/^10\/2時点の判定・更新待ち（独自判定）$/);
      expect(textOf('.brief-gate-figure')).toContain(`新規買いの目安（10/2時点・独自設定）最大${cap === 'm25' ? 25 : 50}%`);
      expect(textOf('.brief-gate-kicker')).toMatch(/^地合い・10\/2（金）引け・2営業日前市場の詳細 ›$/);
      expect(textOf('.brief-gate-kicker .is-warn')).toContain('・2営業日前');
      expect(region().textContent).not.toMatch(/検討できる|検討可/);
      cleanup();
      // At 1024px and wider the verdict block says the waiting lead in place of 「新規の買いを検討できる地合い…」.
      show(state({ mutate, target: '2026-10-06', late: LATE }), { wide: true });
      expect(textOf('[data-testid="brief-regime"]')).toContain('10/2引け時点の判定です。新しい公開を待っています（買いの検討は最新の判定で）');
      expect(region().textContent).not.toMatch(/検討できる|検討可/);
      cleanup();
    }
    // A closed guide keeps its words, with the age.
    show(state({ mutate: below50Rows, target: '2026-10-06', late: LATE }));
    expect(textOf('.brief-gate-headline')).toMatch(/^買いは控える（独自判定）$/);
    expect(textOf('.brief-gate-kicker .is-warn')).toContain('・2営業日前');
  });

  it('keeps Today\'s note, the status alert and the withheld sign in the first fold', () => {
    show(state({ historyEnd: sessions.at(-2) }));
    expect([...region().querySelectorAll('[role="note"]')].map(node => node.textContent)).toEqual(['市場の集計は10/1時点（10/2分は再集計待ち）']);
    expect(textOf('.brief-gate-sign')).toMatch(/^サイン：未確認（10\/2分は再集計待ち）$/);
    expect(firstFold()).toContain('再集計待ち');
    cleanup();
    show(state({ fail: 'series' }));
    expect(region().querySelector('[role="alert"]').textContent).toContain('数値は表示しません。');
    expect(region().querySelector('details > .brief-expander-body [role="alert"]')).toBeNull();
  });

  it('an FTD-upgraded regime under the 50-day line: the FTD line on its own, 目安は 0%のまま, never merged with a condition', () => {
    show(state({ mutate: compose(ftdUpgraded, belowFiftyIndex) }));
    expect(textOf('.brief-gate-sign')).toMatch(/^(FTD確認済み|前回のFTD \d+\/\d+)（参考・目安は 0%のまま：SPYが50日線の下）$/);
    expect(textOf('.brief-gate-conds')).toMatch(/^買いの再開の条件（独自設定）SPY終値が50日線の上：未達$/);
  });

  it('the FTD conflict: the 根拠 line points below, and the fold says the cause line (regimeCause) and nothing is merged', () => {
    show(state({ mutate: compose(ftdUpgraded, belowFiftyIndex, gspcRally(2)) }));
    expect(textOf('.brief-gate-basis')).toBe('根拠：SPYの終値が50日線の下（指数の履歴と不一致・下に詳細）（実測）');
    expect(textOf('.brief-gate-more .brief-gate-basis-full')).toBe('根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下（指数の履歴と不一致・下に詳細）（実測）');
    // The ^GSPC record is a rally attempt: no FTD line; the cause line names both reads, in the fold only.
    expect(textOf('.brief-gate-sign')).toBeNull();
    const ftd = sessions.at(-8);
    expect([...region().querySelectorAll('.brief-gate-more .brief-gate-conflict')].map(node => node.textContent))
      .toEqual([`局面判定はSPYのFTD（${Number(ftd.slice(5, 7))}/${Number(ftd.slice(8))}）による上昇トレンド。^GSPCの日足ではFTD未確認。この目安はSPYが50日線の下のため0%（独自判定）`]);
    expect(firstFold()).not.toContain('^GSPCの日足では');
  });
});

describe('Today\'s gate card at 1024px and wider (fold in place)', () => {
  it('leads with the verdict block and the index chart, the gate\'s lines and the fold in place, one region named 地合い', () => {
    show(state(), { wide: true });
    expect(regions()).toHaveLength(1);
    expect(textOf('[data-testid="brief-regime"]')).toContain('上昇トレンド（独自判定）新規の買いを検討できる地合い。エクスポージャーの目安は最大 50%（独自判定）。');
    expect(region().querySelector('svg.brief-index')).not.toBeNull();
    expect(region().querySelector('details')).toBeNull();
    expect(region().querySelector('.brief-gate-headline')).toBeNull();
    expect(textOf('.brief-gate-figure')).toMatch(/^新規買いの目安（独自設定）最大50%$/);
    // The 根拠 line says the market tab's own words here, once (no short form, no second copy in the fold).
    expect(textOf('.brief-gate-basis')).toBe(`${verdictBasis(state().market, date).text}（実測）`);
    expect(region().querySelector('.brief-gate-basis-full')).toBeNull();
    expect(region().textContent).toContain(GUIDE_UNTESTED);
    expect([...region().querySelectorAll('.brief-gate-group h3')].map(node => node.textContent)).toEqual(['判定', '根拠（指数側）', '広がり（参考）', '銘柄側（参考・目安は変えません）']);
    // The 判定 row names the regime's label (without its 独自判定 mark: the row's kind says it).
    expect(region().querySelector('.brief-gate-group .brief-gate-fact').textContent).toBe('判定上昇トレンド・新規の買いを検討できる独自判定');
  });
});

describe('the first fold\'s warnings (TodayGate)', () => {
  it('puts a firing ▲ and the ▲ split alert in the first fold, the ○ 参考 lines in the fold', () => {
    const input = state();
    const view = marketCardView({ market: input.market, trends: input.trends, date, update: { target: null }, facts: gateReads });
    const gate = marketGate({ market: input.market, lines: input.lines, date, target: null, trends: input.trends, manifest: input.manifest, view });
    const facts = gateFacts({ market: input.market, trends: input.trends, manifest: { data: input.manifest }, date }, { lines: input.lines, target: null, view });
    const warned = { ...view, warnings: [{ key: 'fired', text: '〈fired〉', reference: false }, { key: 'ref', text: '〈reference〉', reference: true }],
      split: { warning: true, reference: false, fromHigh: -1.2, above200Percent: 41 } };
    mount(<section aria-label="地合い"><TodayGate gate={gate} view={warned} facts={facts} wide={false} renderFact={fact => <div key={fact.key} className="brief-fact">{fact.label}</div>} statusAlert={null} /></section>);
    const text = firstFold();
    expect(text).toContain('▲ 〈fired〉（独自判定）');
    expect(text).toContain('▲ 指数は1年高値まであと1.2%の位置ですが、200日線より上の銘柄は41.0%。指数と個別株が乖離しています（独自判定）。');
    expect(text).not.toContain('〈reference〉');
    expect(textOf('.brief-expander-body')).toContain('○ 参考：〈reference〉（独自判定）');
  });
});
