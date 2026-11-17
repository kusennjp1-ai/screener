// SCRATCH (ui-abc yardstick, never committed): THE state table of plan §5.2, as data. Every yard browser tool (matrix,
// values, surfaces, shots) reads its views from here, so a later package adds a state, a screen or a surface by adding a
// row, never by rewriting a tool. Each recipe is opened with the served worktree's own fixture (`openBrief`, frozen) and a
// spec-local mutator COPIED from the cited spec line (the fixture file itself is never edited). A row without a citable
// recipe on main is a declared gap (GAPS below), never an invented state. `expect` is the reach check: a view whose state
// is not reached (the market label/cap the tree's own modelMarket gives the served rows, a stock's data-gate, or a text the
// page must show) is a failed view, so a mutator that silently does not take can never produce a mislabelled view.
//
// Usage: const S = await loadStates(await import(<worktree>/frontend/tests/static/brief-fixture.js));
//        S.views → [{ id, kind, screen, hash, open, clock, steps, modes, expect, shot }]

/** Copied from tests/static/brief-market-r3.spec.js:37 (same as brief-market-phone.spec.js:279). */
export const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));

// The page clocks of the newer-session states (plan D18; §5.2). LATE is brief-freshness.spec.js:9 (TWO_LATER: 10/5 and 10/6
// closed, 10/5's 28-hour grace over). PENDING is 10 minutes after the 10/5 close (the fixture's refresh_schedule close_at
// 20:00Z, brief-fixture.js:385-387): a newer session has closed, inside the grace hours (the bar is unchanged, as
// brief-freshness.spec.js:10-11 WITHIN_GRACE).
export const CLOCKS = Object.freeze({ PENDING: '2026-10-05T20:10:00Z', LATE: '2026-10-07T09:00:00Z' });
export const WATCH4 = ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'];          // brief-compact.spec.js (dump.spec.js WATCH4)
export const WATCH5 = ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'];  // brief-invariants.spec.js:38 (WATCH, with the unlisted QQQX)

export async function loadStates(fx) {
  const { date, sessions, rowBySymbol, SEC_SYMBOL } = fx;
  // ---- market mutators (copied) ----
  // brief-market-r3.spec.js:60-61
  const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
    manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
  // brief-market-r3.spec.js:63
  const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
  // brief-market-r3.spec.js:65-66
  const below200 = { rows: rows => { for (const row of rows) { row.market_above_200dma = false; row.market_regime = 'correction'; } },
    trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 10) point.close = Math.round(point.close * 85) / 100; }); } };
  // brief-market-r3.spec.js:291
  const ftdAgo = n => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), ft = value.indices[0].followThrough; ft.ftd = { ...ft.ftd, date: dates.at(-1 - n), sessionsSince: n }; } });
  // brief-market-r3.spec.js:295
  const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
  // brief-market-r3.spec.js:383-384 (gspcRally): the ^GSPC record in a rally attempt of day d, no FTD. With d = 2 it is the
  // FTD conflict of brief-market-phone.spec.js:395-398 (the backend's FTD upgrade against the app's own ^GSPC record).
  const gspcRally = d => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), last = dates.length - 1;
    Object.assign(value.indices[0].followThrough, { state: 'rally_attempt', low: { date: dates[last - d], low: 4980 }, attempt: { startDate: dates[last - d + 1], day: d }, ftd: null, events: [] }); } });
  // brief-market.spec.js:394 (pressure) and :388 (context: the regime's block, SPY 4 distribution days)
  const pressure = { rows: rows => { for (const row of rows) row.market_regime = 'uptrend_under_pressure'; },
    manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'uptrend_under_pressure', distribution_days: 4, ftd_date: null, ftd_days_since: null, exposure_pct: 55, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
  // YARD-OWN (no spec recipe on main; reach-checked): SPY above both lines under a regime outside the two uptrends
  // (portfolioPlan.js modelMarket's last branch, 新規購入を抑制).
  const restrain = { rows: rows => { for (const row of rows) row.market_regime = 'correction'; } };
  // YARD-OWN (reach-checked): one condition unknown — every row's 50-day field missing while the 200-day line and the regime
  // are known. On main modelMarket's `observed` filter then sees no row: 市場未確認 (the S1 gate names the unknown line).
  const partUnknown = { rows: rows => { for (const row of rows) row.market_above_50dma = null; } };

  // ---- stock mutators (copied) ----
  // brief-invariants.spec.js:15-16
  const fit = bar => { bar.high = Math.max(bar.high, bar.open, bar.close); bar.low = Math.min(bar.low, bar.open, bar.close); };
  const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
  // brief-invariants.spec.js:20-30
  const failedBreakout = symbol => {
    const pivot = Math.round(rowBySymbol[symbol].current_price * 1.02 * 100) / 100;
    return { ...onRow(symbol, row => { row.se_pivot_price = pivot; }),
      charts: served => {
        const bars = served[`${symbol}.json`].bars, n = bars.length, at = n - 4;
        Object.assign(bars[at - 1], { open: pivot * 0.985, close: pivot * 0.985 }); fit(bars[at - 1]);
        Object.assign(bars[at], { open: pivot * 0.99, close: pivot * 1.01 }); fit(bars[at]);
        for (const i of [at + 1, at + 2]) { Object.assign(bars[i], { open: pivot * 0.99, close: pivot * 0.985 }); fit(bars[i]); }
        bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
      } };
  };
  // brief-invariants.spec.js:32-37
  const broken = symbol => ({ charts: served => {
    const bars = served[`${symbol}.json`].bars, n = bars.length, at = n - 9;
    for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
    const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
    Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
    bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
  } });
  // brief-rows.spec.js:152 (BIG_PRICE; its onRow is brief-rows.spec.js:36, the same text as the onRow above): a four-digit
  // price with a two-digit fall (the NFLX/AZO/BKNG class).
  const BIG_PRICE = onRow('ZZNV', row => { row.current_price = 1234.56; Object.assign(row.technical_audit.values, { close: 1234.56, change: -12.34 }); });
  // brief-plan.spec.js:160
  const extended = symbol => ({ rows: rows => { const row = rows.find(item => item.symbol === symbol); row.se_pivot_price = Math.round(row.current_price / 1.15 * 100) / 100; } });
  // brief-decision.spec.js:23
  const EARNINGS_SOON = symbol => onRow(symbol, row => { row.entry_evidence = { ...row.entry_evidence, earnings: { date: '2026-10-05' } }; });
  // brief-decision.spec.js:171-194 (onChart, both, aboveSince; STALE = aboveSince(25): the stalls state)
  const onChart = (symbol, fn) => ({ charts: served => { fn(served[`${symbol}.json`].bars); } });
  const both = (...parts) => parts.reduce((all, part) => {
    for (const [key, fn] of Object.entries(part)) { const prior = all[key]; all[key] = prior ? value => { prior(value); fn(value); } : fn; }
    return all;
  }, {});
  const aboveSince = (ago, { ratio = null, peak = null } = {}) => {
    const row = rowBySymbol[SEC_SYMBOL], pivot = Math.round(row.current_price / 1.03 * 100) / 100;
    return both(onRow(SEC_SYMBOL, r => { r.se_pivot_price = pivot; r.technical_audit.values.change = 1; }), onChart(SEC_SYMBOL, bars => {
      const n = bars.length, at = n - 1 - ago;
      Object.assign(bars[at - 1], { open: pivot * 0.98, close: pivot * 0.98 }); fit(bars[at - 1]);
      for (let i = at; i < n - 1; i++) { if (bars[i].close < pivot * 1.005) Object.assign(bars[i], { open: pivot * 1.006, close: pivot * 1.006 }); fit(bars[i]); }
      if (peak) { Object.assign(bars[at + 3], { open: pivot * peak, close: pivot * peak }); fit(bars[at + 3]); }
      if (ratio) bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * ratio);
    }));
  };
  // brief-chart.spec.js:658-659 (rows only; the spec's withRsLine is left out: it adds an RS line, not the certification)
  const uncertified = symbol => ({ rows: served => { const row = served.find(r => r.symbol === symbol); row.current_price = Math.round(row.current_price * 1.01 * 100) / 100; } });
  // The plan settings as brief-plan.spec.js:30 seeds them (key 'brief-plan', StockPlanCard.jsx:13); stopPercent 5 (plan §5.2)
  // and, YARD-OWN shape (positionSizing.js cleanStructuralSymbols), ZZSD's structural stop applied as 「この位置を使う」 does
  // (brief-plan.spec.js:63-81 clicks it on SEC_SYMBOL and ZZSD).
  const PLAN_5 = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 5, capPercent: 25 } };
  const PLAN_STRUCT = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 7, capPercent: 25, structuralSymbols: ['ZZSD'] } };

  // ---- markets (13; plan §5.2). expect.model: the tree's modelMarket on the served rows; expect.text: the page shows it.
  const MARKETS = [
    { id: 'm50', name: '上昇トレンド・最大50% (default)', src: 'brief-fixture.js:116-126', open: {}, expect: { model: ['上昇トレンド（独自判定）', 0.5] } },
    { id: 'm25', name: '上昇に圧力・最大25%', src: 'brief-market.spec.js:388,394', open: { mutate: pressure }, expect: { model: ['上昇に圧力（独自判定）', 0.25] } },
    { id: 'below50', name: '50日線割れ (correction rows)', src: 'brief-market-r3.spec.js:295', open: { mutate: below50Rows }, expect: { model: ['50日線割れ（弱含み・独自判定）', 0] } },
    { id: 'ftd', name: 'FTD-upgraded under the 50-day line', src: 'brief-market-r3.spec.js:60-63', open: { mutate: compose(ftdUpgraded, belowFiftyIndex) }, expect: { model: ['50日線割れ（弱含み・独自判定）', 0] } },
    { id: 'ftd5', name: 'FTD-upgraded, FTD 5 sessions ago', src: 'brief-market-r3.spec.js:60-63,291', open: { mutate: compose(ftdUpgraded, belowFiftyIndex, ftdAgo(5)) }, expect: { model: ['50日線割れ（弱含み・独自判定）', 0] } },
    { id: 'below200', name: '長期トレンド警戒', src: 'brief-market-r3.spec.js:65-66', open: { mutate: below200 }, expect: { model: ['長期トレンド警戒（独自判定）', 0] } },
    { id: 'restrain', name: '新規購入を抑制 (above both, regime correction)', src: 'YARD-OWN', open: { mutate: restrain }, expect: { model: ['新規購入を抑制（独自判定）', 0] } },
    { id: 'lag1', name: 'market series one session behind', src: 'brief-market-phone.spec.js:36; brief-fundamentals.spec.js:107', open: { historyEnd: sessions.at(-2) }, expect: { model: ['上昇トレンド（独自判定）', 0.5] } },
    { id: 'series404', name: 'market series missing (404)', src: 'brief-market.spec.js:120', open: { fail: 'series' }, expect: { model: ['上昇トレンド（独自判定）', 0.5] } },
    { id: 'manifest503', name: 'manifest missing (503)', src: 'brief-market.spec.js:139; brief-phone.spec.js:115', open: { fail: 'manifest' }, expect: { text: '分析基準日 未確認' } },
    { id: 'partunk', name: 'one condition unknown (50-day field missing)', src: 'YARD-OWN', open: { mutate: partUnknown }, expect: { model: ['市場未確認', 0] } },
    { id: 'ftdconflict', name: 'FTD conflict (^GSPC record not confirmed)', src: 'brief-market-r3.spec.js:60-63,383-384; brief-market-phone.spec.js:395-398', open: { mutate: compose(ftdUpgraded, belowFiftyIndex, gspcRally(2)) }, expect: { model: ['50日線割れ（弱含み・独自判定）', 0] } },
    { id: 'basisconflict', name: 'basis conflict (FTD-upgraded rows, index above its 50-day)', src: 'brief-market-r3.spec.js:60-61', open: { mutate: ftdUpgraded }, expect: { model: ['50日線割れ（弱含み・独自判定）', 0] } },
  ];
  // Screens per market state: Today, 候補 × each filter, ウォッチ (4, 5, and 4 with ZZSD broken), 市場 (each tab on the phone,
  // the one screen at 1440). Filters as dump.spec.js / design-review's 選定すべて; tabs as the 市場タブの表示 tablist.
  const FILTERS = [['zone', '^買いゾーン'], ['near', '^ピボット接近'], ['all', '^選定すべて'], ['one', '^あと1条件']];
  const SCREENS = [
    { screen: 'today', hash: '#/brief', storage: WATCH4, modes: ['375', '390f', '1440'] },
    ...FILTERS.map(([key, label]) => ({ screen: `list-${key}`, hash: '#/brief/list', storage: WATCH4, steps: [{ filter: label }], modes: ['375', '390f', '1440'] })),
    { screen: 'watch4', hash: '#/brief/watch', storage: WATCH4, modes: ['375', '390f', '1440'] },
    { screen: 'watch5', hash: '#/brief/watch', storage: WATCH5, modes: ['375', '390f', '1440'] },
    { screen: 'watchbroken', hash: '#/brief/watch', storage: WATCH4, mutate: broken('ZZSD'), modes: ['375', '390f', '1440'] },
    ...[0, 1, 2, 3].map(i => ({ screen: `market-t${i}`, hash: '#/brief/market', steps: [{ tab: i }], modes: ['375', '390f'] })),
    { screen: 'market', hash: '#/brief/market', modes: ['1440'] },
  ];
  // The newer-session states (D18): pending and late, each at 50%, 25% and 0%, on Today, 候補, ウォッチ and a stock.
  const NEWER = [
    ['pend', CLOCKS.PENDING, { expectText: '分析基準日 10/2（金）引け', notText: '営業日前' }],
    ['late', CLOCKS.LATE, { expectText: '2営業日前' }],
  ];
  const NEWER_MARKETS = MARKETS.filter(m => ['m50', 'm25', 'below50'].includes(m.id));
  const NEWER_SCREENS = [
    { screen: 'today', hash: '#/brief', storage: WATCH4 },
    { screen: 'list', hash: '#/brief/list', storage: WATCH4 },
    { screen: 'watch4', hash: '#/brief/watch', storage: WATCH4 },
    { screen: 'stock-ZZNV', hash: '#/brief/stock/ZZNV', storage: WATCH4, stock: true },
  ];
  // ---- stock states (plan §5.2: 11 + the mutator states that have a recipe on main). gate = the conclusion's data-gate as
  // main 01066ebe gives it (observed in the S1-P0 smoke run and pinned here), so a later package that moves a gate fails the reach.
  const STOCKS = [
    { id: 'ready', symbol: 'ZZRD', src: 'brief-fixture.js:236-250 (oracle)', open: { oracles: true }, gate: 'near' },
    { id: 'near', symbol: 'ZZAR', src: 'brief-fixture.js (default row)', open: {}, gate: 'near' },
    { id: 'touch', symbol: 'ZZNV', src: 'brief-fixture.js (default row)', open: {}, gate: 'touch' },
    { id: 'held', symbol: 'ZZHB', src: 'brief-fixture.js (oracle; weekly-pattern pivot, brief-oracles.spec.js:81)', open: { oracles: true }, gate: 'after' },
    { id: 'extended', symbol: 'ZZKS', src: 'brief-plan.spec.js:160', open: { mutate: extended('ZZKS') }, gate: 'ext' },
    { id: 'failed', symbol: 'ZZAR', src: 'brief-invariants.spec.js:20-30', open: { mutate: failedBreakout('ZZAR') }, gate: 'failedBreakout' },
    { id: 'broken', symbol: 'ZZNV', src: 'brief-invariants.spec.js:32-37', open: { mutate: broken('ZZNV') }, gate: 'broken' },
    { id: 'tt7', symbol: 'ZZZF', src: 'brief-fixture.js (default row, RS推計 61)', open: {}, gate: 'template' },
    { id: 'lowact', symbol: 'ZZPG', src: 'brief-fixture.js:300-312 (oracle)', open: { oracles: true }, gate: 'lowActivity' },
    { id: 'pivotafter', symbol: 'ZZNR', src: 'brief-fixture.js (oracle; a holder chip the call does not state)', open: { oracles: true }, gate: 'near' },
    { id: 'hold', symbol: 'ZZNV', src: 'brief-market-r3.spec.js:295 (zone stock on a 0% day)', open: { mutate: below50Rows }, gate: 'marketHold', only: 'pub' },
    { id: 'stalls', symbol: SEC_SYMBOL, src: 'brief-decision.spec.js:182-194 (STALE = aboveSince(25))', open: { mutate: aboveSince(25) }, gate: 'stale' },
    { id: 'uncert', symbol: 'ZZZF', src: 'brief-chart.spec.js:658-659', open: { mutate: uncertified('ZZZF') }, gate: 'template', text: '未検証の足' },
    { id: 'detailfail', symbol: SEC_SYMBOL, src: 'brief-fundamentals.spec.js:90', open: { fail: 'detail' }, gate: 'touch' },
    { id: 'earnings', symbol: SEC_SYMBOL, src: 'brief-decision.spec.js:23', open: { mutate: EARNINGS_SOON(SEC_SYMBOL) }, gate: 'earnings' },
    { id: 'stop5', symbol: 'ZZNV', src: 'brief-plan.spec.js:30 (settings shape; stopPercent 5)', open: { storage: PLAN_5 }, gate: 'touch', text: '損切り\\s?−5\\.0%' },
    { id: 'structural', symbol: 'ZZSD', src: 'YARD-OWN storage of brief-plan.spec.js:63-81', open: { storage: PLAN_STRUCT }, gate: 'template', text: '構造上の目安・|損切り 構造' },
    { id: 'bigprice', symbol: 'ZZNV', src: 'brief-rows.spec.js:36,152 (BIG_PRICE: $1,234.56, 前日比 −12.34)', open: { mutate: BIG_PRICE }, gate: 'stalePivot', text: '\\$1,23[45]', shot: false },
  ];
  // Row-level states on a 候補 screen (a recipe that changes one row, read where the row is listed), in the default market.
  // shot: false = not in main's screenshot set (yard/README.md says which views were added after it was taken).
  const ROW_STATES = [
    // ZZNV, now far above its old pivot, sorts last (21st): the phone lists 20 rows per page, so the view also takes
    // 「さらに表示」 (step `more`). The row shows the day change, not the price: the reach text is ZZNV's 前日比 −12.3%.
    { id: 'bigprice', src: 'brief-rows.spec.js:36,152 (BIG_PRICE on ZZNV)', mutate: BIG_PRICE, screen: 'list-all', hash: '#/brief/list', steps: [{ filter: '^選定すべて' }, { more: true }], text: '前日比\\s*−12\\.3%' },
  ];
  // The stock-side markets: as published, the 0% day and the unknown market (plan §5.2 "each also under the 0% and the unknown").
  const STOCK_MARKETS = [['pub', null], ['m0', below50Rows], ['unk', partUnknown]];
  const GAPS = [
    ['stale pivot', 'the stale-pivot gate is covered by stock-bigprice@* (BIG_PRICE on ZZNV: main gives it data-gate stalePivot); only a dedicated stale-pivot recipe is missing (S2 adds one in its own spec file)'],
    ['no pivot', 'no recipe on main (S2 adds one in its own spec file)'],
    ['vcp_pivot fallback price', 'no recipe on main (S2 adds one in its own spec file)'],
    ['stop reached / analysis-day breakout', 'S2-P6 (BEH-1) adds them'],
    ['weekly-pattern pivot', 'covered by stock:held (ZZHB, brief-oracles.spec.js:81)'],
    ['sell chip the call does not state', 'covered by stock:pivotafter (ZZNR holder chip)'],
  ];

  const views = [];
  const merge = (...parts) => { const list = parts.filter(Boolean); return list.length ? compose(...list) : undefined; };
  for (const m of MARKETS) for (const s of SCREENS) views.push({
    id: `${m.id}/${s.screen}`, kind: 'market', market: m.id, screen: s.screen, hash: s.hash, src: m.src,
    open: { ...m.open, mutate: merge(m.open.mutate, s.mutate), storage: { 'research-watch': s.storage || WATCH4 } },
    steps: s.steps || [], modes: s.modes, expect: m.expect, shot: ['today', 'list-zone', 'watch4', 'market-t0', 'market'].includes(s.screen),
  });
  for (const [nid, clock, texts] of NEWER) for (const m of NEWER_MARKETS) for (const s of NEWER_SCREENS) views.push({
    id: `${nid}-${m.id}/${s.screen}`, kind: 'newer', market: m.id, screen: s.screen, hash: s.hash, clock, src: `${m.src}; clock ${clock}`,
    open: { ...m.open, storage: { 'research-watch': s.storage } }, steps: [], modes: ['375', '390f', '1440'],
    // The phone's stock bar names the stock, not the date (brief-freshness.spec.js:61-66): there only the late age is checked.
    expect: { ...m.expect, barText: s.stock && nid === 'pend' ? null : texts.expectText, barNot: texts.notText || null }, shot: true, stock: Boolean(s.stock),
  });
  for (const st of STOCKS) for (const [mid, mm] of STOCK_MARKETS) {
    if (st.only && st.only !== mid) continue;
    const model = mid === 'pub' ? null : mid === 'm0' ? ['50日線割れ（弱含み・独自判定）', 0] : ['市場未確認', 0];
    views.push({
      id: `stock-${st.id}@${mid}`, kind: 'stock', market: mid, screen: `stock-${st.symbol}`, symbol: st.symbol, hash: `#/brief/stock/${st.symbol}`, src: st.src,
      open: { ...st.open, mutate: merge(st.open.mutate, mm), storage: { 'research-watch': WATCH4, ...(st.open.storage || {}) } }, steps: [], modes: ['375', '390f', '1440'],
      expect: { ...(model ? { model } : {}), ...(mid === 'pub' && st.gate ? { gate: st.gate } : {}), ...(st.text ? { text: st.text } : {}) }, shot: st.shot !== false && (mid === 'pub' || st.id === 'touch'),
      stock: true,
    });
  }
  const m50 = MARKETS.find(m => m.id === 'm50');
  for (const r of ROW_STATES) views.push({
    id: `row-${r.id}/${r.screen}`, kind: 'row', market: 'm50', screen: r.screen, hash: r.hash, src: r.src,
    open: { mutate: r.mutate, storage: { 'research-watch': WATCH4 } }, steps: r.steps || [], modes: ['375', '390f', '1440'],
    expect: { ...m50.expect, text: r.text }, shot: false,
  });
  return { views, MARKETS, STOCKS, ROW_STATES, GAPS, CLOCKS, compose, mutators: { below50Rows, pressure, partUnknown, broken, ftdUpgraded, belowFiftyIndex } };
}

/** The served rows the page receives for a view (routeBrief's variant: a deep copy, oracles joined, the rows mutator). */
export function servedRows(fx, open) {
  const base = open?.oracles ? [...fx.rows, ...fx.ORACLE_ROWS] : fx.rows;
  const copy = structuredClone(base), mutator = open?.mutate?.rows;
  if (!mutator) return copy;
  const value = mutator(copy);
  return value === undefined ? copy : value;
}

/** A file-safe name for a view id. */
export const safeId = id => id.replace(/[^A-Za-z0-9@._-]+/g, '_');
