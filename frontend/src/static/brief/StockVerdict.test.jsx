import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import StockVerdict from './StockVerdict';
import { breakoutEvent, candidateView, earningsCall, trendTemplate } from './briefCandidate';
import { HEAVY_DOWN_NOTE, SE_CONFIDENCE_FLOOR } from './buyGate';
import { WEAKNESS_CHIP, WEAKNESS_ROW_CHIP } from './briefSell';
import { code33ChipView } from '../fundamentalsExplain.js';
import { positionPlan } from './positionSizing';
import { conditionNote } from '../missingCondition';
import { withAuditFixture } from '../testAuditFixture';

// The round-2 earnings seams the conclusion calls (data's, plan §2.2): each answers as its owner's module
// does unless a test sets a value (undefined: the real body; null at step 0), and records what it was given.
const seams = vi.hoisted(() => ({ chip: undefined, caution: undefined, asked: [] }));
vi.mock('../fundamentalsExplain.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual,
    earningsChipView: financial => { seams.asked.push(['chip', financial]); return seams.chip === undefined ? actual.earningsChipView(financial) : seams.chip; },
    earningsCaution: financial => { seams.asked.push(['caution', financial]); return seams.caution === undefined ? actual.earningsCaution(financial) : seams.caution; } };
});

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
  // Every row's Setup Engine base is current for the analysis day at a confidence of 60 (over the floor of 55), as published.
  const BASE = { setup_recalculation: { status: 'calculated', as_of_date: DAY }, se_pattern_confidence: 60 };
  const audited = ({ price = 101, pivot = 100, change = 2, volume = 1.6, rs = 90, ...extra } = {}) => {
    const row = withAuditFixture({ symbol: 'AAA', market: 'US', currency: 'USD', company_name: 'Alpha', current_price: price, se_pivot_price: pivot, rs_rating: rs, ...BASE, ...extra }, DAY);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    return row;
  };
  // The analysis day's afternoon in New York: the earnings countdown runs from the analysis date.
  const NOW = Date.parse(`${DAY}T19:00:00Z`);
  /**
   * Certified daily bars ending on DAY (one a calendar day), under the pivot of 100 until `ago` sessions back, then
   * 100.5, 101.5 … to DAY's 103; the crossing bar trades `ratio` times the 50 before it (1.6×; null: unknown).
   */
  const crossing = (ago = 2, ratio = 1.6) => {
    const at = 60 - ago, date = i => new Date(Date.parse(DAY) - (60 - i) * 86400000).toISOString().slice(0, 10);
    return Array.from({ length: 61 }, (_, i) => ({ date: date(i), close: i < at ? 99 : i === 60 ? 103 : 100.5 + (i - at),
      volume: i === at ? (ratio === null ? null : 10000 * ratio) : 10000 }));
  };
  const conclusionOf = ({ row = audited(), assessment, market = OPEN, plan, template, judged = null, now = NOW, technical = null, sells = null, financial = null } = {}) => {
    const t = template === undefined ? trendTemplate(row) : template;
    const a = assessment || { qualified: t.qualified, passed: t.passed + (t.integrity?.state === 'pass' ? 1 : 0), failed: t.failed, unknown: t.unknown, total: 9 };
    const view = candidateView({ row, assessment: a }, DAY);
    render(<StockVerdict view={view} plan={plan === undefined ? positionPlan(view, {}, { market, template: t }) : plan} stage={null} technical={technical} bars={null} judged={judged} template={t} rsHigh={false} financial={financial} row={row} sells={sells} diagnostics={null} market={market} now={now} />);
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

  it('counts an unmet RS estimate in the one-line title and names it with its value and threshold under it, marking the position and the prices 参考', () => {
    const row = audited({ rs: 61.4 });
    const card = conclusionOf({ row });
    expect(card.className).toContain('tone-neutral');
    expect(title(card)).toBe('TT 1条件未達 — 買いの対象外');
    const rule = trendTemplate(row).rules.find(r => /^RS 推計/.test(r.label));
    expect(sub(card)).toBe(`${conditionNote(rule)}。位置は参考：買いゾーン・ピボット比 +1.0%。`);
    expect(conditionNote(rule)).toBe('未達：RS推計 61（基準70）');
    expect(meter(card).getAttribute('aria-label')).toBe('ピボットからの位置（参考） +1.0%');
    expect(meter(card).classList.contains('is-reference')).toBe(true);
    expect(tiles(card)).toEqual([['買いの範囲', '100.00', '〜105.00', '参考'], ['損切り −7.0%', '93.93', '買値 101.00', '参考'], ['株数', '88株', 'リスク $625', '参考']]);
    // The rule, its value and its threshold are one unit a line never splits.
    expect(card.querySelector('.brief-call-status p .brief-nowrap').textContent).toBe('RS推計 61（基準70）');
    // The title's closing phrase is one too, so a 320px phone never breaks 「対／象外」.
    expect([...card.querySelectorAll('strong .brief-nowrap')].map(node => node.textContent)).toEqual(['買いの対象外']);
  });

  it('counts any other unmet rule, or several, in a one-line title and names the first in the line under it', () => {
    const far = audited({ rs: 90 });
    far.technical_audit.values.belowHigh = 30.25;
    const one = conclusionOf({ row: far });
    expect([title(one), sub(one), one.className.includes('tone-neutral')]).toEqual(['TT 1条件未達 — 買いの対象外', '未達：高値から25%以内（30.3%）。位置は参考：買いゾーン・ピボット比 +1.0%。', true]);
    cleanup();
    const three = audited({ rs: 61 });
    Object.assign(three.technical_audit.values, { belowHigh: 30.2, sma50: 120 });
    const card = conclusionOf({ row: three });
    expect([title(card), sub(card)]).toEqual(['TT 3条件未達 — 買いの対象外', '未達：株価 > SMA50、ほか2件。位置は参考：買いゾーン・ピボット比 +1.0%。']);
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
    cleanup();
    // Track F's binding (I4, requested by Track F): the risk budget reads as before; when the single-stock cap
    // set the count, the tile gives the cap and the loss at the stop, which is then below the budget.
    expect(tiles(conclusionOf({ plan: { ...base, binding: 'risk', capPercent: 25, actualRisk: 622.2 } }))[2]).toEqual(['株数', '88株', 'リスク $625']);
    cleanup();
    expect(tiles(conclusionOf({ plan: { ...base, binding: 'cap', capPercent: 25, actualRisk: 547.3 } }))[2]).toEqual(['株数', '88株', '上限25%・実リスク $547']);
    cleanup();
    expect(tiles(conclusionOf({ plan: { ...base, binding: 'cap', capPercent: 25, actualRisk: null } }))[2]).toEqual(['株数', '88株', `上限25%・実リスク ${DASH}`]);
  });

  it('calls a heavy down day in the zone a warning with no buy range, and its tiles 参考', () => {
    const row = audited({ change: -1 });
    const down = conclusionOf({ row });
    // The title is breakoutEvent's (rows'): asserted through it.
    const event = breakoutEvent(candidateView({ row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } }, DAY));
    expect([event.kind, title(down), down.className.includes('tone-ext')]).toEqual(['heavyDown', event.title, true]);
    expect(sub(down)).toBe(`ピボット比 +1.0%・50日線から +11.1%。${HEAVY_DOWN_NOTE}`);
    expect(down.textContent).not.toContain('買いの範囲です');
    expect(quals(down)).toEqual(['参考', '参考', '参考']);
    expect(meter(down).classList.contains('is-reference')).toBe(true);
  });

  it('dates a crossing from certified bars, waits when it cannot or on light volume, and stops the green call once it stalls', () => {
    const dated = conclusionOf({ row: audited({ price: 103, change: 1.5 }), judged: crossing() });
    expect([title(dated), dated.className.includes('tone-zone')]).toEqual(['9/30に上抜け・2営業日前', true]);
    expect(sub(dated)).toMatch(/^ピボット比 \+3\.0%・50日線から \+[\d.]+%。ピボットから＋5%までが買いの範囲です。$/);
    expect(quals(dated)).toEqual(['既定条件', '既定条件']);
    // The crossing date with its verb never splits on a 320px phone.
    expect([...dated.querySelectorAll('strong .brief-nowrap')].map(node => node.textContent)).toEqual(['9/30に上抜け']);
    cleanup();
    // The crossing day on 0.8× or with its volume unknown: no breakout, so it waits, with the tiles as for a light crossing.
    for (const [ratio, text] of [[0.8, '出来高不足'], [null, '出来高 未確認']]) {
      const light = conclusionOf({ row: audited({ price: 103, change: 1.5 }), judged: crossing(2, ratio) });
      expect([title(light), light.className.includes('tone-wait')]).toEqual([`9/30に上抜け・${text}`, true]);
      expect(light.textContent).not.toContain('買いの範囲です');
      expect(quals(light)).toEqual(['既定条件', '既定条件']);
      cleanup();
    }
    // Without certified bars the crossing is never dated: not green, and the tiles stay as for a crossing without its volume.
    const undated = conclusionOf({ row: audited({ price: 103, change: 1.5 }) });
    expect([title(undated), undated.className.includes('tone-wait')]).toEqual(['買いゾーン内（上抜け日 未確認）', true]);
    expect(sub(undated)).toMatch(/^ピボット比 \+3\.0%・50日線から \+[\d.]+%。上抜けの日を検証済みの日足で確認できないため、買いの裏付けはありません。$/);
    cleanup();
    // Still in the zone 13 sessions after the crossing: wait for the next pivot, the tiles 参考.
    const day = i => new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10);
    const long = Array.from({ length: 32 }, (_, i) => ({ date: day(i), close: i < 19 ? 98 : 102 })).concat([{ date: DAY, close: 103 }]);
    const stalled = conclusionOf({ row: audited({ price: 103, change: 1.5 }), judged: long });
    expect([title(stalled), stalled.className.includes('tone-wait')]).toEqual(['上抜けから13営業日・停滞（次のピボット待ち）', true]);
    expect(sub(stalled)).toMatch(/^ピボット比 \+3\.0%・50日線から \+[\d.]+%。新規の買いは見送り。9\/20に上抜け、10営業日を超えて伸びないため停滞（独自判定）。$/);
    expect(stalled.textContent).not.toContain('買いの範囲です');
    expect(quals(stalled)).toEqual(['参考', '参考', '参考']);
  });

  // Track E's sell checks (I4, requested by Track E): a broken setup is never a buy-side call, and the chip says it in full.
  it('calls a broken setup neutral whatever the position, names its check, and gives the chip its full sentence', () => {
    const ma50 = state => ({ key: 'ma50', label: '出来高を伴う50日線割れ（1.40×以上）', state, date: '2026-09-22', detail: '9/22 に出来高 2.20×で割れ、以降50日線の下（9営業日）', ...(state === 'hit' ? { headline: '50日線割れ（9/22・出来高2.20×）' } : {}) });
    const sells = state => ({ strength: [], weakness: [ma50(state)], hits: state === 'hit' ? 1 : 0, breakdownHits: state === 'hit' ? 1 : 0, cautions: state === 'caution' ? 1 : 0, unknowns: 0 });
    const card = conclusionOf({ sells: sells('hit') });
    expect(card.className).toContain('tone-neutral');
    expect([title(card), sub(card)]).toEqual(['買いの前提が崩れた（独自判定）', '50日線割れ（9/22・出来高2.20×）。位置は参考：買いゾーン・ピボット比 +1.0%。']);
    expect(quals(card)).toEqual(['参考', '参考', '参考']);
    expect(meter(card).classList.contains('is-reference')).toBe(true);
    // The title already says the setup broke: the chip is the short form, its sentence in its title.
    const chip = [...card.querySelectorAll('.brief-tags .brief-chip')].find(node => node.textContent === WEAKNESS_ROW_CHIP);
    expect(chip.title).toBe(`${WEAKNESS_CHIP}：出来高を伴う50日線割れ（1.40×以上）`);
    expect(card.textContent).not.toContain(WEAKNESS_CHIP);
    cleanup();
    // The book's combined warning is a broken setup too; it is named by its label.
    const book = { key: 'book', label: '20日線割れ・3日連続の安値切り下げ・大商い（書籍の複合警告）', state: 'hit', detail: '20日線割れ' };
    expect(sub(conclusionOf({ sells: { ...sells('clear'), weakness: [ma50('clear'), book] } }))).toBe('20日線割れ・3日連続の安値切り下げ・大商い（書籍の複合警告）。位置は参考：買いゾーン・ピボット比 +1.0%。');
    cleanup();
    // A light break still under the line is a caution: the buy call stays, the chip says 50日線の下.
    const caution = conclusionOf({ sells: sells('caution') });
    expect([title(caution), caution.className.includes('tone-zone')]).toEqual(['10/2に上抜け・出来高1.60×', true]);
    expect([...caution.querySelectorAll('.brief-tags .brief-chip')].map(node => node.textContent)).toContain('50日線の下（大商いの割れは未確認）');
  });

  // Track A's footprint says when the base was already broken out of (I4, requested by Track A).
  it('keeps the VCP chip green only while the base still contracts, or for a breakout on the analysis date', () => {
    const vcp = base => ({ vcp: { measurementsValid: true, depthsContract: true, volumeContracts: true, droppedLegs: 0,
      legs: [{ depthPct: 25, startDate: '2026-07-01', endDate: '2026-07-31' }, { depthPct: 12, startDate: '2026-08-01', endDate: '2026-08-31' }, { depthPct: 6, startDate: '2026-09-01', endDate: '2026-09-25' }],
      base: { startDate: '2026-07-01', endDate: '2026-09-28', ...base } } });
    const chip = card => [...card.querySelectorAll('.brief-tags .brief-chip')].find(node => node.textContent.startsWith('VCP'));
    const contracting = chip(conclusionOf({ technical: vcp({ brokeOut: false }) }));
    expect([contracting.textContent, contracting.classList.contains('tone-zone')]).toEqual(['VCP 12週 25/6 3T', true]);
    cleanup();
    const broken = chip(conclusionOf({ technical: vcp({ brokeOut: true, breakoutDate: '2026-09-28' }) }));
    expect([broken.textContent, broken.classList.contains('tone-zone')]).toEqual(['VCP 13週 25/6 3T・土台の高値を上抜け（9/28）', false]);
    cleanup();
    const today = chip(conclusionOf({ technical: vcp({ brokeOut: true, endDate: DAY, breakoutDate: DAY }) }));
    expect([today.textContent, today.classList.contains('tone-zone')]).toEqual(['VCP 13週 25/6 3T・土台の高値を上抜け（10/2）', true]);
  });

  // The VCP base's high is not always the canonical pivot: two crossings of two levels on two days.
  it('names which level each breakout crossed when the base high is not the pivot, so the two dates never contradict', () => {
    const bars = crossing();
    // 9/28 closes above the base's high (98) but under the pivot.
    Object.assign(bars.at(-5), { close: 98.5 });
    // The base's high was crossed on 9/28 (below the pivot of 100); the pivot itself on 9/30.
    const technical = { vcp: { measurementsValid: true, depthsContract: true, volumeContracts: true, droppedLegs: 0,
      legs: [{ depthPct: 25, startDate: '2026-07-01', endDate: '2026-07-31' }, { depthPct: 12, startDate: '2026-08-01', endDate: '2026-08-31' }, { depthPct: 6, startDate: '2026-09-01', endDate: '2026-09-25' }],
      base: { startDate: '2026-07-01', endDate: '2026-09-25', brokeOut: true, breakoutDate: '2026-09-28' } } };
    const card = conclusionOf({ row: audited({ price: 103, change: 1.5 }), judged: bars, technical });
    expect(title(card)).toBe('9/30に上抜け・2営業日前');
    const vcpChip = [...card.querySelectorAll('.brief-tags .brief-chip')].find(node => node.textContent.startsWith('VCP'));
    expect(vcpChip.textContent).toBe('VCP 12週 25/6 3T・土台の高値を上抜け（9/28）');
    // The chip never claims a pivot crossing of its own.
    expect(vcpChip.textContent).not.toMatch(/ピボット|上抜け済み/);
  });
  // The data track's earnings chip and caution line: asked with the stock's financial view, nothing shown while null.
  it('asks the earnings seams with the financial view: the chip is the first fundamentals chip, the caution a line under a green call only', () => {
    const chips = card => [...card.querySelectorAll('.brief-tags .brief-chip')];
    onTestFinished(() => Object.assign(seams, { chip: undefined, caution: undefined, asked: [] }));
    let card = conclusionOf();
    expect(seams.asked.slice(-2)).toEqual([['chip', null], ['caution', null]]);
    const before = chips(card).map(node => node.textContent);
    expect(card.querySelectorAll('.brief-call-status p')).toHaveLength(1);
    cleanup();
    seams.chip = { text: '〈earnings〉', tone: 'zone', title: '〈title〉' };
    seams.caution = { text: '〈caution〉' };
    card = conclusionOf();
    const after = chips(card);
    // Right after the RS estimate's chip, where the fundamentals start.
    const rs = after.findIndex(node => node.textContent.startsWith('RS推計'));
    expect([after[rs + 1].textContent, after[rs + 1].className, after[rs + 1].getAttribute('title')]).toEqual(['〈earnings〉', 'brief-chip tone-zone', '〈title〉']);
    expect(after.map(node => node.textContent).filter(text => text !== '〈earnings〉')).toEqual(before);
    // The caution never stops the green call: it is one wait-tone line under it.
    const lines = card.querySelectorAll('.brief-call-status p');
    expect([card.className.includes('tone-zone'), lines.length, lines[1].textContent, lines[1].className]).toEqual([true, 2, '〈caution〉', 'brief-call-caution']);
    cleanup();
    // Under a call that is no buy anyway, no caution line.
    card = conclusionOf({ market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(card.querySelectorAll('.brief-call-status p')).toHaveLength(1);
    expect(card.querySelector('.brief-call-caution')).toBeNull();
  });

  it('shows the Code 33 chip only when it is met; a miss or an unknown stays in the fundamentals card', () => {
    const code33 = financial => [...conclusionOf({ financial }).querySelectorAll('.brief-tags .brief-chip')].filter(node => node.textContent.startsWith('Code 33'));
    const pass = { code33: { state: 'pass' } };
    expect(code33(pass).map(node => [node.textContent, node.className])).toEqual([[code33ChipView(pass).text, `brief-chip tone-${code33ChipView(pass).tone}`]]);
    cleanup();
    for (const financial of [{ code33: { state: 'fail' } }, { code33: { state: 'unknown' } }, null]) {
      expect(code33(financial)).toEqual([]);
      cleanup();
    }
  });

  it('names the base check when the Setup Engine base is not current or below its floor: neutral, 参考, never 0', () => {
    const calc = (over = {}) => ({ setup_recalculation: { status: 'calculated', as_of_date: DAY, ...over } });
    const cases = [
      [{ ...calc(), se_pattern_confidence: 31 }, `土台の信頼度 31（基準${SE_CONFIDENCE_FLOOR}）`],
      [{ ...calc(), se_pattern_confidence: null }, '土台の信頼度 未確認'],
      [{ ...calc({ as_of_date: '2026-10-01' }), se_pattern_confidence: 60 }, '土台の再計算が分析日のものではありません（10/1）'],
      [{ setup_recalculation: { status: 'unavailable', as_of_date: DAY }, se_pattern_confidence: 60 }, '土台の再計算不可'],
      [{ ...calc({ reason: 'primary_pattern_below_confidence_floor / other' }), se_pattern_confidence: 60 }, '主パターンが信頼度の基準55未満（Setup Engine）'],
    ];
    for (const [over, note] of cases) {
      const card = conclusionOf({ row: audited(over) });
      expect([card.className.includes('tone-neutral'), title(card), sub(card)]).toEqual([true, '土台を確認できない — ピボットは参考（独自判定）', `${note}。位置は参考：買いゾーン・ピボット比 +1.0%。`]);
      expect(quals(card)).toEqual(['参考', '参考', '参考']);
      expect(meter(card).classList.contains('is-reference')).toBe(true);
      expect(card.textContent).not.toMatch(/信頼度 0\b/);
      cleanup();
    }
    // A certified VCP footprint does not override it (owner decision §9-13's default); its chip still shows.
    const vcp = { vcp: { measurementsValid: true, depthsContract: true, volumeContracts: true, droppedLegs: 0,
      legs: [{ depthPct: 25, startDate: '2026-07-01', endDate: '2026-07-31' }, { depthPct: 12, startDate: '2026-08-01', endDate: '2026-08-31' }, { depthPct: 6, startDate: '2026-09-01', endDate: '2026-09-25' }],
      base: { startDate: '2026-07-01', endDate: '2026-09-28', brokeOut: false } } };
    const card = conclusionOf({ row: audited({ se_pattern_confidence: 31 }), technical: vcp });
    expect(title(card)).toBe('土台を確認できない — ピボットは参考（独自判定）');
    expect([...card.querySelectorAll('.brief-tags .brief-chip')].some(node => node.textContent.startsWith('VCP 12週'))).toBe(true);
  });

  it('labels the stage: ステージ2（ベース形成中） for a stage-2 base, green for 2, the ext tone for 3 and 4, neutral otherwise', () => {
    const chip = stage => { const view = candidateView({ row: audited(), assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } }, DAY);
      render(<StockVerdict view={view} plan={null} stage={stage} technical={null} bars={null} template={trendTemplate(audited())} rsHigh={false} financial={null} row={audited()} sells={null} diagnostics={null} market={OPEN} now={NOW} />);
      const node = [...screen.getByTestId('brief-conclusion').querySelectorAll('.brief-chip')][0];
      cleanup();
      return [node.textContent, node.className];
    };
    expect(chip({ value: 2, computed: false, phase: 'base' })).toEqual(['ステージ2（ベース形成中）', 'brief-chip tone-zone']);
    expect(chip({ value: 2, computed: true, phase: 'base' })).toEqual(['ステージ2（ベース形成中・日足から算出）', 'brief-chip tone-zone']);
    // A published 3 that the certified bars show as a stage-2 base: the 2 is from the bars.
    expect(chip({ value: 3, computed: false, phase: 'base' })).toEqual(['ステージ2（ベース形成中・日足から算出）', 'brief-chip tone-zone']);
    expect(chip({ value: 2, computed: false })).toEqual(['ステージ2', 'brief-chip tone-zone']);
    expect(chip({ value: 3, computed: true })).toEqual(['ステージ3（日足から算出）', 'brief-chip tone-ext']);
    expect(chip({ value: 4, computed: false })).toEqual(['ステージ4', 'brief-chip tone-ext']);
    expect(chip({ value: 1, computed: false })).toEqual(['ステージ1', 'brief-chip']);
    expect(chip(null)).toEqual(['ステージ 未確認', 'brief-chip']);
  });

  it('keeps the industry rank neutral and says its date is unknown (no as-of date is exported)', () => {
    const card = conclusionOf({ row: audited({ ibd_group_rank: 12 }) });
    const node = [...card.querySelectorAll('.brief-chip')].find(chip => chip.textContent.startsWith('業種'));
    expect([node.textContent, node.className]).toEqual(['業種 12位（推計・基準日未確認）', 'brief-chip']);
  });

  it('reads the stock view\'s one earnings call when it is given, never its own clock', () => {
    const row = audited({ entry_evidence: { earnings: { date: '2026-10-05' } } });
    const view = candidateView({ row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } }, DAY);
    // The call as of 10/4 (a day before earnings), whatever `now` says.
    const call = earningsCall(view, Date.parse('2026-10-04T15:00:00Z'));
    render(<StockVerdict view={view} plan={null} stage={null} technical={null} bars={null} template={trendTemplate(row)} rsHigh={false} financial={null} row={row} sells={null} diagnostics={null} market={OPEN} now={NOW} earningsCall={call} />);
    const card = screen.getByTestId('brief-conclusion');
    expect(title(card)).toBe(call.line);
    expect([...card.querySelectorAll('.brief-chip')].at(-1).textContent).toBe(call.chip);
    cleanup();
    // A null call is an unknown date.
    render(<StockVerdict view={view} plan={null} stage={null} technical={null} bars={null} template={trendTemplate(row)} rsHigh={false} financial={null} row={row} sells={null} diagnostics={null} market={OPEN} now={NOW} earningsCall={null} />);
    expect([...screen.getByTestId('brief-conclusion').querySelectorAll('.brief-chip')].at(-1).textContent).toBe('決算日 未確認');
  });
});
