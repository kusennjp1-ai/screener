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
    // The chart labels its stop line the same way; the conclusion's tile is the one asserted here.
    expect(within(screen.getByTestId('brief-conclusion')).getByText('損切り −7.0%')).toBeInTheDocument();
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
  // The rule's row in the template card (the conclusion may name the same rule in its line).
  const item = text => screen.getAllByText(text).map(node => node.closest('li')).find(Boolean);
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
  // The analysis day's afternoon in New York: the earnings countdown runs from the analysis date.
  const NOW = Date.parse(`${DAY}T19:00:00Z`);
  const conclusionOf = ({ row = audited(), assessment, market = OPEN, plan, template, judged = null, now = NOW } = {}) => {
    const t = template === undefined ? trendTemplate(row) : template;
    const a = assessment || { qualified: t.qualified, passed: t.passed + (t.integrity?.state === 'pass' ? 1 : 0), failed: t.failed, unknown: t.unknown, total: 9 };
    const view = candidateView({ row, assessment: a }, DAY);
    render(<StockVerdict view={view} plan={plan === undefined ? positionPlan(view, {}, { market, template: t }) : plan} stage={null} technical={null} bars={null} judged={judged} template={t} rsHigh={false} financial={null} row={row} sells={null} diagnostics={null} market={market} now={now} />);
    return screen.getByTestId('brief-conclusion');
  };
  const title = card => card.querySelector('strong').textContent, sub = card => card.querySelector('.brief-call-status p').textContent;
  const tiles = card => [...card.querySelectorAll('.brief-kgrid > div')].map(tile => [...tile.children].map(node => node.textContent));
  const quals = card => [...card.querySelectorAll('.brief-tilequal')].map(node => node.textContent);
  const meter = card => card.querySelector('.brief-meter');
  // A dash is — on screen and 未計算 to a screen reader.
  const DASH = '—未計算';

  it('keeps a qualified TT 8/8 stock in a confirmed uptrend as before: a green call in the buy zone', () => {
    const card = conclusionOf();
    expect(card.className).toContain('tone-zone');
    expect([title(card), sub(card)]).toEqual(['10/2に上抜け・出来高1.60×', 'ピボット比 +1.0%・50日線から +11.1%。ピボットから＋5%までが買いの範囲です。']);
    expect(card.textContent).not.toContain('本日');
    expect(meter(card).getAttribute('aria-label')).toBe('ピボットからの位置 +1.0%');
    expect(meter(card).classList.contains('is-reference')).toBe(false);
    expect([...card.querySelectorAll('.brief-meter-name')].map(node => node.textContent)).toEqual(['土台形成中', 'ピボット接近', '買いゾーン', '買いゾーン超過']);
    // The short names a column narrower than a word shows instead (a 375px phone at 200% zoom).
    expect([...card.querySelectorAll('.brief-meter-short')].map(node => node.textContent)).toEqual(['土台', '接近', '買い', '超過']);
    // The plan is the shell's (usePositionPlan passes the market and the template); with every input at its
    // default, the stop and the shares carry 既定条件 (Track F's contract), and nothing reads 参考.
    expect(tiles(card)).toEqual([['買いの範囲', '100.00', '〜105.00'], ['損切り −7.0%', '93.93', '買値 101.00', '既定条件'], ['株数', '88株', 'リスク $625', '既定条件']]);
    expect(quals(card)).toEqual(['既定条件', '既定条件']);
  });

  it('names the failed template rule with its value, in a neutral tone, and marks the position and the prices 参考', () => {
    const card = conclusionOf({ row: audited({ rs: 61.4 }) });
    expect(card.className).toContain('tone-neutral');
    expect(title(card)).toBe('トレンドテンプレート未達（未達：RS ≥ 70（61））— 買いの対象外');
    expect(sub(card)).toBe('位置は参考：買いゾーン・ピボット比 +1.0%。');
    expect(meter(card).getAttribute('aria-label')).toBe('ピボットからの位置（参考） +1.0%');
    expect(meter(card).classList.contains('is-reference')).toBe(true);
    expect(tiles(card)).toEqual([['買いの範囲', '100.00', '〜105.00', '参考'], ['損切り −7.0%', '93.93', '買値 101.00', '参考'], ['株数', '88株', 'リスク $625', '参考']]);
    // The rule and its value are one unit a line never splits.
    expect(card.querySelector('strong .brief-nowrap').textContent).toBe('RS ≥ 70（61）');
  });

  it('counts any other unmet rule, or several, in a one-line title and names the first in the line under it', () => {
    const far = audited({ rs: 90 });
    far.technical_audit.values.belowHigh = 30.25;
    const one = conclusionOf({ row: far });
    expect([title(one), sub(one), one.className.includes('tone-neutral')]).toEqual(['TT未達（1条件）— 買いの対象外', '未達：高値から25%以内（30.3%）。位置は参考：買いゾーン・ピボット比 +1.0%。', true]);
    cleanup();
    const three = audited({ rs: 61 });
    Object.assign(three.technical_audit.values, { belowHigh: 30.2, sma50: 120 });
    const card = conclusionOf({ row: three });
    expect([title(card), sub(card)]).toEqual(['TT未達（3条件）— 買いの対象外', '未達：株価 > SMA50、ほか2件。位置は参考：買いゾーン・ピボット比 +1.0%。']);
    expect(quals(card)).toEqual(['参考', '参考', '参考']);
  });

  it('says TT未確認 when a rule is unknown and none failed, and 選定対象外 with the existing reason when TT 8/8 is not selected', () => {
    const unknown = audited();
    unknown.technical_audit.values.sma200_21ago = null;
    expect(title(conclusionOf({ row: unknown }))).toBe('TT未確認・買い判断不可');
    expect(sub(screen.getByTestId('brief-conclusion'))).toMatch(/^未確認：SMA200の21営業日上昇。位置は参考：/);
    cleanup();
    const several = audited();
    Object.assign(several.technical_audit.values, { sma200_21ago: null, sma150: null });
    expect(sub(conclusionOf({ row: several }))).toBe('未確認：株価 > SMA150・SMA200、ほか3件。位置は参考：買いゾーン・ピボット比 +1.0%。');
    cleanup();
    const excluded = conclusionOf({ assessment: { qualified: false, passed: 9, failed: 0, unknown: 0, total: 9, financial_exclusion: { label: '財務データの公開例外（確認待ち）' } } });
    expect([title(excluded), excluded.className.includes('tone-neutral')]).toEqual(['選定対象外（財務データの公開例外（確認待ち））', true]);
  });

  it('holds off under a known market with a cap of 0, moving the position under it and marking the meter and the tiles 参考', () => {
    const card = conclusionOf({ market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(card.className).toContain('tone-neutral');
    expect([title(card), sub(card)]).toEqual(['地合いが新規の買いを控える状態（独自判定）', '位置は参考：買いゾーン・ピボット比 +1.0%。']);
    // Never 「控える」 and an order size in the same glance: the sizing tiles carry 参考.
    expect(quals(card)).toEqual(['参考', '参考', '参考']);
    expect(meter(card).classList.contains('is-reference')).toBe(true);
  });

  it('says 地合い未確認 for an unknown market (or none), never 控える', () => {
    for (const market of [{ label: '市場未確認', cap: 0, state: 'unknown' }, null]) {
      const card = conclusionOf({ market });
      expect([title(card), card.className.includes('tone-neutral')]).toEqual(['地合い未確認（新規の買いは判断を保留）', true]);
      expect(card.textContent).not.toContain('控える');
      expect(quals(card)).toEqual(['参考', '参考', '参考']);
      cleanup();
    }
  });

  it('puts an earnings date 10 days away or nearer in the conclusion line, and leaves an unknown date 未確認', () => {
    const card = conclusionOf({ row: audited({ entry_evidence: { earnings: { date: '2026-10-05' } } }) });
    expect([title(card), card.className.includes('tone-neutral')]).toEqual(['決算まで3日（10/5）：新規買いは見送り候補（独自判定）', true]);
    expect([...card.querySelectorAll('.brief-chip.tone-ext')].map(node => node.textContent)).toEqual(['決算まで3日']);
    expect(quals(card)).toEqual(['参考', '参考', '参考']);
    cleanup();
    expect(title(conclusionOf({ row: audited({ entry_evidence: { earnings: { date: '2026-10-13' } } }) }))).toBe('10/2に上抜け・出来高1.60×');
    cleanup();
    expect(within(conclusionOf()).getByText('決算日 未確認')).toBeInTheDocument();
  });

  it('dates the earnings line, says 決算当日 on the day itself, and counts from today when the analysis is older', () => {
    const earnings = date => audited({ entry_evidence: { earnings: { date } } });
    const day0 = conclusionOf({ row: earnings(DAY) });
    expect([title(day0), within(day0).getByText('決算当日').className]).toEqual(['決算当日（10/2）：新規買いは見送り候補（独自判定）', 'brief-chip tone-ext']);
    expect(day0.textContent).not.toContain('0日');
    cleanup();
    // The analysis is 10/2 and today is 10/4: earnings on 10/13 is 9 days away (11 from the analysis date) and warns.
    expect(title(conclusionOf({ row: earnings('2026-10-13'), now: Date.parse('2026-10-04T15:00:00Z') }))).toBe('決算まで9日（10/13）：新規買いは見送り候補（独自判定）');
    cleanup();
    // A report since the analysis date: the analysis predates it.
    const passed = conclusionOf({ row: earnings('2026-10-05'), now: Date.parse('2026-10-07T15:00:00Z') });
    expect([title(passed), within(passed).getByText('決算日経過').className]).toEqual(['決算（10/5）後のデータ待ち：新規買いは保留（独自判定）', 'brief-chip tone-ext']);
  });

  it('calls a crossing without the volume no breakout: not green, and says why in the line under it', () => {
    const card = conclusionOf({ row: audited({ volume: 1.2 }) });
    expect([title(card), card.className.includes('tone-wait')]).toEqual(['10/2に上抜け・出来高不足', true]);
    expect(sub(card)).toBe('ピボット比 +1.0%・50日線から +11.1%。出来高1.20×は基準の1.4×に届きません。');
  });

  it('draws no meter for a pivot more than 25% away: the line already says why', () => {
    const card = conclusionOf({ row: audited({ price: 132, pivot: 100 }) });
    expect(title(card)).toBe('旧ピボットから +32%・有効な買い水準なし（新しいベース待ち）');
    expect(card.querySelector('.brief-meter')).toBeNull();
    expect(card.textContent).not.toContain('位置は未確認');
  });

  it('reads — in every tile without a plan, and the plan contract\'s qualifiers when they are set', () => {
    const none = conclusionOf({ plan: null });
    expect(tiles(none)).toEqual([['買いの範囲', '100.00', '〜105.00'], ['損切り', DASH, `買値 ${DASH}`], ['株数', DASH, `リスク ${DASH}`]]);
    for (const dash of none.querySelectorAll('.brief-kgrid [aria-hidden="true"]')) expect([dash.textContent, dash.nextSibling.className]).toEqual(['—', 'sr-only']);
    cleanup();
    expect(tiles(conclusionOf({ plan: { blocked: '買いゾーン超過：新規の試算はしません（次の土台を待つ）' } })).slice(1)).toEqual([['損切り', DASH, `買値 ${DASH}`], ['株数', DASH, `リスク ${DASH}`]]);
    cleanup();
    const base = { entry: 101, stop: 93.93, stopPercent: 7, risk: 7.07, r2: 115.14, r3: 122.21, riskDollars: 625, shares: 88, cost: 8888, weight: 17.8 };
    for (const [flag, text] of [['trialOnly', '試算のみ'], ['defaults', '既定条件'], ['reference', '参考']]) {
      expect([...conclusionOf({ plan: { ...base, [flag]: true } }).querySelectorAll('.brief-tilequal')].map(node => node.textContent)).toEqual(flag === 'reference' ? ['参考', '参考', '参考'] : [text, text]);
      cleanup();
    }
    // Fewer than one share is a result, never a dash: 1株未満, with the limit that set it.
    expect(tiles(conclusionOf({ plan: { ...base, shares: 0 } }))[2]).toEqual(['株数', '1株未満', 'リスク上限超']);
    cleanup();
    expect(tiles(conclusionOf({ plan: { ...base, shares: null, binding: 'cap' } }))[2]).toEqual(['株数', '1株未満', '1銘柄の上限超']);
    cleanup();
    // No risk budget (no account): nothing was computed, so a dash.
    expect(tiles(conclusionOf({ plan: { ...base, shares: null, riskDollars: null } }))[2]).toEqual(['株数', DASH, `リスク ${DASH}`]);
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
