import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import StockVerdict from './StockVerdict';
import { candidateView, trendTemplate } from './briefCandidate';
import { positionPlan } from './positionSizing';
import { withAuditFixture } from '../testAuditFixture';

const DATE = '2026-10-02';
const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const bars = (end = DATE) => {
  const list = Array.from({ length: 200 }, (_, i) => { const close = 50 * 1.003 ** i; return { date: day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }; });
  const last = { ...list.at(-1), date: end, open: list.at(-1).close * 0.9, close: list.at(-1).close * 0.9, low: list.at(-1).close * 0.89, volume: 30000 };
  return [...list.slice(0, -1), last];
};
const view = { symbol: 'AAA', name: 'Alpha', state: 'wait', stateLabel: 'ピボット待ち', distance: -3, pivot: 100, upper: 105, price: 97, rs: 80, volumeRatio: 1, fromHigh: 10, earnings: null, pivotSource: 'test' };
const data = (certified, end) => ({
  view, row: { symbol: 'AAA', chart_path: 'AAA.json' }, template: null, technical: null, diagnostics: null, financial: null, institutional: null,
  bars: bars(end), date: DATE, certification: certified ? { certified: true, reason: null } : { certified: false, reason: '最終日足が分析日と不一致' },
  chart: { data: { rs_line: [] }, isError: false },
});
afterEach(cleanup);

describe('brief stock view', () => {
  it('keeps everything computed from uncertified or lagging bars unknown and says why (the conclusion)', () => {
    render(<StockView data={data(false, '2026-10-01')} />);
    expect(screen.getByText('ステージ 未確認')).toBeInTheDocument();
    expect(screen.getByText('損切り −7.0%')).toBeInTheDocument();
  });

  it('labels the stop without a percentage when there is no plan', () => {
    render(<StockView data={{ ...data(true), view: { ...view, pivot: null, price: null } }} />);
    expect(within(screen.getByTestId('brief-conclusion')).getByText('損切り')).toBeInTheDocument();
    expect(screen.queryByText(/−—%/)).toBeNull();
  });
});

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const rule = (label, state) => ({ label, state, evidence: `${label} の根拠` });
  const template = states => ({ passed: states.filter(s => s === 'pass').length, failed: states.filter(s => s === 'fail').length, unknown: states.filter(s => s === 'unknown').length,
    rules: states.map((state, i) => rule(`条件${i + 1}`, state)) });
  const folded = element => Boolean(element.closest('details'));
  const item = text => screen.getByText(text).closest('li');
  afterEach(() => sessionStorage.clear());

  it('lists unmet and unknown conditions and folds the met ones into a line that counts them', () => {
    render(<StockView data={{ ...data(true), template: template(['pass', 'fail', 'pass', 'unknown', 'pass', 'pass', 'pass', 'pass']) }} />);
    expect(folded(item('条件2'))).toBe(false);
    expect(folded(item('条件4'))).toBe(false);
    expect(folded(item('条件1'))).toBe(true);
    expect(screen.getByText('達成した条件 6件').closest('summary')).toBeTruthy();
    cleanup();
    // All met: the eight conditions fold behind one line that says so.
    render(<StockView data={{ ...data(true), template: template(Array(8).fill('pass')) }} />);
    expect(screen.getByText('8条件の内訳（すべて達成）').closest('summary')).toBeTruthy();
    for (let i = 1; i <= 8; i++) expect(folded(item(`条件${i}`))).toBe(true);
  });

  it('shows everything open on the desktop, each footnote in place on its card and no 注記 (the template card)', () => {
    render(<StockView data={{ ...data(true), template: template(Array(8).fill('pass')) }} wide />);
    for (let i = 1; i <= 8; i++) expect(folded(item(`条件${i}`))).toBe(false);
  });
});

// The conclusion: green only when the trend template, the market, the earnings date and the position allow
// a new buy. Rendered on its own from views built the way useStockData builds them.
describe('the conclusion says why there is no buy', () => {
  const DAY = '2026-10-02';
  const OPEN = { label: '上昇トレンド（独自判定）', cap: 0.5 };
  const audited = ({ price = 101, pivot = 100, change = 2, volume = 1.6, rs = 90, ...extra } = {}) => {
    const row = withAuditFixture({ symbol: 'AAA', market: 'US', currency: 'USD', company_name: 'Alpha', current_price: price, se_pivot_price: pivot, rs_rating: rs, ...extra }, DAY);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    return row;
  };
  const conclusionOf = ({ row = audited(), assessment, market = OPEN, plan, template, judged = null } = {}) => {
    const t = template === undefined ? trendTemplate(row) : template;
    const a = assessment || { qualified: t.qualified, passed: t.passed + (t.integrity?.state === 'pass' ? 1 : 0), failed: t.failed, unknown: t.unknown, total: 9 };
    const view = candidateView({ row, assessment: a }, DAY);
    render(<StockVerdict view={view} plan={plan === undefined ? positionPlan(view) : plan} stage={null} technical={null} bars={null} judged={judged} template={t} rsHigh={false} financial={null} row={row} sells={null} diagnostics={null} market={market} />);
    return screen.getByTestId('brief-conclusion');
  };
  const title = card => card.querySelector('strong').textContent, sub = card => card.querySelector('.brief-call-status p').textContent;
  const tiles = card => [...card.querySelectorAll('.brief-kgrid > div')].map(tile => [...tile.children].map(node => node.textContent));

  it('keeps a qualified TT 8/8 stock in a confirmed uptrend as before: a green call in the buy zone', () => {
    const card = conclusionOf();
    expect(card.className).toContain('tone-zone');
    expect([title(card), sub(card)]).toEqual(['本日ピボットを出来高1.60×で上抜け', 'ピボット比 +1.0%・50日線から +11.1%。ピボットから＋5%までが買いの範囲です。']);
    expect(card.querySelector('.brief-meter').getAttribute('aria-label')).toBe('ピボットからの位置 +1.0%');
    expect([...card.querySelectorAll('.brief-meter-labels > span')].map(node => node.textContent)).toEqual(['土台形成中', 'ピボット接近', '買いゾーン', '買いゾーン超過']);
    expect(tiles(card)).toEqual([['買いの範囲', '100.00', '〜105.00'], ['損切り −7.0%', '93.93', '買値 101.00'], ['株数', '88株', 'リスク $625']]);
    expect(card.querySelectorAll('.brief-tilequal')).toHaveLength(0);
  });

  it('names the failed template rule with its value, in a neutral tone, and marks the position and the prices 参考', () => {
    const card = conclusionOf({ row: audited({ rs: 61.4 }) });
    expect(card.className).toContain('tone-neutral');
    expect(title(card)).toBe('トレンドテンプレート未達（未達：RS ≥ 70（61））— 買いの対象外');
    expect(sub(card)).toBe('位置は参考：本日ピボットを出来高1.60×で上抜け・ピボット比 +1.0%。');
    expect(card.querySelector('.brief-meter').getAttribute('aria-label')).toBe('ピボットからの位置（参考） +1.0%');
    expect(tiles(card)).toEqual([['買いの範囲', '100.00', '〜105.00', '参考'], ['損切り −7.0%', '93.93', '買値 101.00', '参考'], ['株数', '88株', 'リスク $625', '参考']]);
  });

  it('says TT未確認 when a rule is unknown and none failed, and 選定対象外 with the existing reason when TT 8/8 is not selected', () => {
    const unknown = audited();
    unknown.technical_audit.values.sma200_21ago = null;
    expect(title(conclusionOf({ row: unknown }))).toBe('TT未確認・買い判断不可');
    expect(sub(screen.getByTestId('brief-conclusion'))).toMatch(/^未確認：SMA200の21営業日上昇。位置は参考：/);
    cleanup();
    const excluded = conclusionOf({ assessment: { qualified: false, passed: 9, failed: 0, unknown: 0, total: 9, financial_exclusion: { label: '財務データの公開例外（確認待ち）' } } });
    expect([title(excluded), excluded.className.includes('tone-neutral')]).toEqual(['選定対象外（財務データの公開例外（確認待ち））', true]);
  });

  it('holds off under a known market with a cap of 0, moving the position under it', () => {
    const card = conclusionOf({ market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(card.className).toContain('tone-neutral');
    expect([title(card), sub(card)]).toEqual(['地合いが新規の買いを控える状態（独自判定）', '位置：本日ピボットを出来高1.60×で上抜け・ピボット比 +1.0%・50日線から +11.1%。']);
  });

  it('says 地合い未確認 for an unknown market (or none), never 控える', () => {
    for (const market of [{ label: '市場未確認', cap: 0, state: 'unknown' }, null]) {
      const card = conclusionOf({ market });
      expect([title(card), card.className.includes('tone-neutral')]).toEqual(['地合い未確認（新規の買いは判断を保留）', true]);
      expect(card.textContent).not.toContain('控える');
      cleanup();
    }
  });

  it('puts an earnings date 10 days away or nearer in the conclusion line, and leaves an unknown date 未確認', () => {
    const card = conclusionOf({ row: audited({ entry_evidence: { earnings: { date: '2026-10-05' } } }) });
    expect([title(card), card.className.includes('tone-neutral')]).toEqual(['決算まで3日：発表前の新規買いは見送り候補（独自判定）', true]);
    expect([...card.querySelectorAll('.brief-chip.tone-ext')].map(node => node.textContent)).toEqual(['決算まで 3日']);
    cleanup();
    expect(title(conclusionOf({ row: audited({ entry_evidence: { earnings: { date: '2026-10-13' } } }) }))).toBe('本日ピボットを出来高1.60×で上抜け');
    cleanup();
    expect(within(conclusionOf()).getByText('決算日 未確認')).toBeInTheDocument();
  });

  it('reads — in every tile without a plan, and the plan contract\'s qualifiers when they are set', () => {
    expect(tiles(conclusionOf({ plan: null }))).toEqual([['買いの範囲', '100.00', '〜105.00'], ['損切り', '—', '買値 —'], ['株数', '—', 'リスク —']]);
    cleanup();
    expect(tiles(conclusionOf({ plan: { blocked: '買いゾーン超過：新規の試算はしません（次の土台を待つ）' } })).slice(1)).toEqual([['損切り', '—', '買値 —'], ['株数', '—', 'リスク —']]);
    cleanup();
    const base = { entry: 101, stop: 93.93, stopPercent: 7, risk: 7.07, r2: 115.14, r3: 122.21, riskDollars: 625, shares: 88, cost: 8888, weight: 17.8 };
    for (const [flag, text] of [['trialOnly', '試算のみ'], ['defaults', '既定条件'], ['reference', '参考']]) {
      expect([...conclusionOf({ plan: { ...base, [flag]: true } }).querySelectorAll('.brief-tilequal')].map(node => node.textContent)).toEqual(flag === 'reference' ? ['参考', '参考', '参考'] : [text, text]);
      cleanup();
    }
  });

  it('calls a heavy down day in the zone a warning and dates a recent crossing from certified bars', () => {
    const down = conclusionOf({ row: audited({ change: -1 }) });
    expect([title(down), down.className.includes('tone-ext')]).toEqual(['下落日の大商い 1.60×（要注意）', true]);
    cleanup();
    const bars = [['2026-09-28', 98], ['2026-09-29', 99], ['2026-09-30', 100.5], ['2026-10-01', 101.5], ['2026-10-02', 103]].map(([date, close]) => ({ date, close }));
    expect(title(conclusionOf({ row: audited({ price: 103, change: 1.5 }), judged: bars }))).toBe('買いゾーン内（9/30に上抜け・2営業日前）');
    cleanup();
    expect(title(conclusionOf({ row: audited({ price: 103, change: 1.5 }) }))).toBe('買いゾーン内（上抜け後）');
  });
});
