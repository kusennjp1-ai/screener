import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import StockView from './StockView';
import PlanCard, { usePositionPlan } from './StockPlanCard';
import { PLAN_BLOCKED, positionPlan } from './positionSizing';

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
const UP = { label: '上昇トレンド（独自判定）', cap: 0.5 };
/** A trend template whose eight rules and daily-bar integrity rule all pass. */
const PASS = { passed: 8, failed: 0, unknown: 0, integrity: { state: 'pass' } };
/** Certified bars whose bar 190 holds the last measured contraction's low (96: 4.5% under the 100 entry). */
const measured = (low = 96) => {
  const list = bars();
  list[190] = { ...list[190], low };
  return { judged: list, technical: { as_of_date: DATE, vcp: { measurementsValid: true, legs: [{ low: 80, lowDate: list[170].date }, { low, lowDate: list[190].date }] } } };
};
/** The plan card with its hook, as the stock view wires them. */
function Harness({ planView = view, market = UP, template = PASS, technical = null, judged = null, certified = true, chartRef = { current: null }, wide = false }) {
  const { plan, settings, update } = usePositionPlan({ view: planView, template, market, technical, certified, judged, chartRef });
  return <PlanCard view={planView} plan={plan} settings={settings} onChange={update} earnings={null} judged={judged} wide={wide} />;
}
const card = () => screen.getByRole('region', { name: /建て玉と損切りの計画/ });
afterEach(cleanup);
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  const folded = element => Boolean(element.closest('details'));

  it('names the plan inputs on their line and keeps the plan\'s results in view', () => {
    render(<StockView data={data(true)} />);
    expect(screen.getByText(/口座 \$50,000・リスク 1\.25%・損切り 7\.0%・上限 25%/).closest('summary')).toBeTruthy();
    expect(folded(screen.getByRole('spinbutton', { name: '口座資金（$）', hidden: true }))).toBe(true);
    expect(folded(screen.getByRole('spinbutton', { name: '1銘柄の上限（%）', hidden: true }))).toBe(true);
    // The plan's results stay in view.
    expect(folded(screen.getByTestId('brief-shares'))).toBe(false);
    expect(folded(within(card()).getByRole('group', { name: 'R倍数の価格' }))).toBe(false);
  });
});

describe('the plan card', () => {
  it('both stop inputs go down to 1%, and a 1% stop is used as set', () => {
    render(<Harness wide />);
    const number = screen.getByRole('spinbutton', { name: '損切り幅（%）' }), slider = screen.getByRole('slider', { name: '損切り幅（%）' });
    expect(number).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('min', '1');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(within(card()).getByRole('group', { name: 'R倍数の価格' })).toHaveTextContent('−1R 99.00');
    fireEvent.change(number, { target: { value: '0.2' } });
    expect(number).toHaveValue(1);
  });

  it('has no duplicate stop tile: shares and their limit, the cost, and the market guide', () => {
    render(<Harness />);
    const tiles = [...card().querySelectorAll('.brief-kgrid > div')];
    expect(tiles.map(tile => tile.querySelector('small').textContent)).toEqual(['株数', '投資額', '地合いの目安']);
    expect(tiles[0]).toHaveTextContent('リスク $625');
    expect(tiles[1]).toHaveTextContent('口座の 17.8%');
    expect(tiles[2]).toHaveTextContent('最大50%うち 17.8%');
  });

  it('the R bar shows the −1R, +2R and +3R prices; the heading names the entry', () => {
    render(<Harness />);
    expect(within(card()).getByRole('group', { name: 'R倍数の価格' })).toHaveTextContent('損切り −1R 93.00+2R 114.00+3R 121.00');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('建て玉と損切りの計画 ピボット 100.00 で買う場合');
    expect(card()).toHaveTextContent('AAA の試算です。売買の推奨ではありません。');
  });

  it('names the cap when it sets the share count, with the loss it leaves', () => {
    localStorage.setItem('brief-plan', JSON.stringify({ account: 50000, riskPercent: 2, stopPercent: 1, capPercent: 25 }));
    render(<Harness />);
    expect(screen.getByTestId('brief-shares')).toHaveTextContent('125');
    const note = card().querySelector('.brief-kgrid > div em');
    expect(note).toHaveTextContent('上限25%・実リスク $125');
    // It breaks only at the 「・」: 「上限25%・」 and 「実リスク $125」.
    expect([...note.querySelectorAll('.brief-frag')].map(part => part.textContent)).toEqual(['上限25%・', '実リスク $125']);
    expect(screen.getByText('条件')).toBeTruthy();
  });

  it('the inputs read as the defaults (既定条件) until one changes; wide, the heading says so', () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByText('既定条件')).toBeTruthy();
    unmount();
    render(<Harness wide />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ピボット 100.00 で買う場合・既定条件');
    expect(card()).toHaveTextContent('地合いの目安は市場の判定によるエクスポージャーの目安（独自判定）です。');
  });

  it('a stored risk above 5% reads as 5%, the input\'s maximum', () => {
    localStorage.setItem('brief-plan', JSON.stringify({ account: 50000, riskPercent: 400, stopPercent: 7, capPercent: 25 }));
    render(<Harness />);
    expect(screen.getByText(/リスク 5%・損切り 7\.0%/)).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '1回のリスク（%）', hidden: true })).toHaveAttribute('max', '5');
  });

  it('a value that cannot be computed reads —, with its screen-reader word, never —%', () => {
    localStorage.setItem('brief-plan', JSON.stringify({ account: 50, riskPercent: 1.25, stopPercent: 7, capPercent: 25 }));
    render(<Harness />);
    const [shares, cost, guide] = card().querySelectorAll('.brief-kgrid > div');
    expect(shares).toHaveTextContent('株数—（算出できません）');
    expect(cost).toHaveTextContent('投資額—（算出できません）口座の —（算出できません）');
    expect(cost).not.toHaveTextContent('—%');
    expect(guide).toHaveTextContent('最大50%うち —（算出できません）');
  });

  it('over the market guide, the note breaks between its parts (うち x% / （超過）)', () => {
    localStorage.setItem('brief-plan', JSON.stringify({ account: 50000, riskPercent: 5, stopPercent: 1, capPercent: 100 }));
    render(<Harness market={{ label: '上昇トレンド（警戒）', cap: 0.25 }} />);
    const guide = card().querySelectorAll('.brief-kgrid > div')[2];
    expect(guide).toHaveClass('tone-ext');
    expect([...guide.querySelectorAll('em .brief-frag')].map(part => part.textContent)).toEqual(['うち 100.0%', '（超過）']);
    expect([...guide.querySelectorAll('small .brief-frag')].map(part => part.textContent)).toEqual(['地合いの', '目安']);
  });

  it('reads 試算のみ when the market guide is 0% or unknown, never 0% for unknown', () => {
    const { unmount } = render(<Harness market={{ label: '長期トレンド警戒', cap: 0 }} />);
    expect(card().querySelectorAll('.brief-kgrid > div')[2]).toHaveTextContent('地合いの目安試算のみ目安 0%（新規は控える）');
    unmount();
    render(<Harness market={{ label: '市場未確認', cap: 0, state: 'unknown' }} />);
    expect(card().querySelectorAll('.brief-kgrid > div')[2]).toHaveTextContent('地合いの目安試算のみ地合い 未確認');
  });

  it('a stock beyond the buy zone gets the reason, not a plan, and the screen gets no plan', () => {
    const ext = { ...view, state: 'ext', price: 115, distance: 15 };
    render(<Harness planView={ext} />);
    expect(screen.getByTestId('brief-plan-blocked')).toHaveTextContent(PLAN_BLOCKED.ext);
    expect(screen.queryByTestId('brief-shares')).toBeNull();
    expect(card().querySelector('.brief-rbar')).toBeNull();
    const { result } = renderHook(() => usePositionPlan({ view: ext, market: UP, chartRef: { current: null } }));
    expect(result.current.plan).toBeNull();
  });

  it('a template that is not passed marks the plan 参考 with its reason: TT未達, or TT未確認 (never read as passed)', () => {
    const heading = () => screen.getByRole('heading', { level: 2 });
    const { unmount } = render(<Harness template={{ ...PASS, passed: 7, failed: 1 }} />);
    expect(heading()).toHaveTextContent('ピボット 100.00 で買う場合・参考（TT未達）');
    unmount();
    for (const template of [null, { ...PASS, passed: 7, unknown: 1 }, { ...PASS, integrity: { state: 'unknown' } }]) {
      const { unmount: next } = render(<Harness template={template} />);
      expect(heading()).toHaveTextContent('ピボット 100.00 で買う場合・参考（TT未確認）');
      next();
    }
    render(<Harness />);
    expect(heading()).not.toHaveTextContent('参考');
  });

  it('in the buy zone the entry is the analysis date\'s close (終値), never called the current price', () => {
    render(<Harness planView={{ ...view, state: 'zone', price: 102.5, distance: 2.5 }} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('建て玉と損切りの計画 終値 102.50 で買う場合');
    expect(card()).not.toHaveTextContent('現在値');
  });
});

describe('the structural stop and ADR come from certified bars only', () => {
  it('the structural button sets this stock\'s stop there, moves the chart\'s stop line and keeps the focus', () => {
    const moves = [], chartRef = { current: { moveStop: stop => moves.push(stop) } };
    const { judged, technical } = measured(96);
    render(<Harness judged={judged} technical={technical} chartRef={chartRef} />);
    const stop = 96 * 0.995;
    expect(card()).toHaveTextContent(`構造上の損切り目安 ${stop.toFixed(2)}買値比 −${(100 - stop).toFixed(1)}%・収縮の安値の0.5%下`);
    const button = screen.getByRole('button', { name: 'この位置を使う' });
    button.focus();
    fireEvent.click(button);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toBeCloseTo(stop, 9);
    expect(within(card()).getByRole('group', { name: 'R倍数の価格' })).toHaveTextContent(`−1R ${stop.toFixed(2)}`);
    expect(screen.getByText(/損切り 構造 4\.5%・上限 25%/)).toBeTruthy();
    // Applied, it stays focusable: the same button, still focused, inert and announced as 適用済み.
    const applied = screen.getByRole('button', { name: '適用済み' });
    expect(applied).toBe(button);
    expect(applied).toHaveAttribute('aria-disabled', 'true');
    expect(applied).not.toBeDisabled();
    expect(document.activeElement).toBe(applied);
    fireEvent.click(applied);
    expect(moves).toHaveLength(1);
    // Kept for this stock only: the stop setting every stock reads is unchanged.
    expect(JSON.parse(localStorage.getItem('brief-plan'))).toMatchObject({ stopPercent: 7, structuralSymbols: ['AAA'] });
  });

  it('one stock\'s structural stop never becomes another stock\'s stop; a stop typed on that stock replaces it', () => {
    const { judged, technical } = measured(96);
    const first = render(<Harness judged={judged} technical={technical} />);
    fireEvent.click(screen.getByRole('button', { name: 'この位置を使う' }));
    first.unmount();
    // The next stock (the stock screen remounts per symbol) opens with the stop setting.
    const other = render(<Harness planView={{ ...view, symbol: 'BBB' }} judged={judged} technical={technical} />);
    expect(screen.getByText(/損切り 7\.0%・上限 25%/)).toBeTruthy();
    expect(within(card()).getByRole('group', { name: 'R倍数の価格' })).toHaveTextContent('−1R 93.00');
    expect(screen.getByRole('button', { name: 'この位置を使う' })).not.toHaveAttribute('aria-disabled');
    other.unmount();
    // Back on the first stock its own structural stop is still chosen, until a stop is typed there.
    render(<Harness judged={judged} technical={technical} />);
    expect(screen.getByRole('button', { name: '適用済み' })).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: '損切り幅（%）', hidden: true }), { target: { value: '6' } });
    expect(screen.getByRole('button', { name: 'この位置を使う' })).toBeTruthy();
    expect(within(card()).getByRole('group', { name: 'R倍数の価格' })).toHaveTextContent('−1R 94.00');
    expect(JSON.parse(localStorage.getItem('brief-plan'))).toMatchObject({ stopPercent: 6, structuralSymbols: [] });
  });

  it('wide, it names the low, and the terms beside the inputs name the buffer and the cap as 独自設定', () => {
    const { judged, technical } = measured(96);
    render(<Harness judged={judged} technical={technical} wide />);
    expect(card()).toHaveTextContent('買値比 −4.5%・最後の収縮の安値 96.00 の0.5%下');
    expect(card()).toHaveTextContent('1銘柄に投じる額の上限です（独自設定・初期25%・最大100%）。信用取引は試算しません。');
    expect(card()).toHaveTextContent('構造上の損切り目安は、最後の収縮の安値の0.5%下です（独自設定）。');
  });

  it('says the contraction low is unknown without certified bars or measured legs, with no button', () => {
    const { judged, technical } = measured(96);
    const { unmount } = render(<Harness judged={judged} technical={technical} certified={false} />);
    expect(card()).toHaveTextContent('構造上の損切り目安：収縮の安値 未確認（日足が分析日で未検証）');
    expect(screen.queryByRole('button', { name: 'この位置を使う' })).toBeNull();
    expect(card()).toHaveTextContent('ADR 未確認（日足が分析日で未検証）');
    unmount();
    render(<Harness judged={judged} technical={{ vcp: { measurementsValid: false, legs: [] } }} />);
    expect(card()).toHaveTextContent('構造上の損切り目安：収縮の安値 未確認（収縮を測定できません）');
  });

  it('a structural stop of 10% or more is a reason to pass; one over the 9.5% input limit only cannot be set', () => {
    const deep = measured(85);
    const { unmount } = render(<Harness judged={deep.judged} technical={deep.technical} />);
    expect(card()).toHaveTextContent(`構造上の損切り目安 ${(85 * 0.995).toFixed(2)}（買値比 −${(100 - 85 * 0.995).toFixed(1)}%）深すぎる（10%以上・見送り候補）`);
    expect(card().querySelector('.brief-structural')).toHaveClass('tone-ext');
    expect(screen.queryByRole('button', { name: 'この位置を使う' })).toBeNull();
    unmount();
    const edge = measured(90.5);
    render(<Harness judged={edge.judged} technical={edge.technical} />);
    expect(card()).toHaveTextContent('（買値比 −9.95%）入力の上限9.5%を超えるため、この位置は使えません');
    expect(card()).not.toHaveTextContent('見送り候補');
    expect(card().querySelector('.brief-structural')).not.toHaveClass('tone-ext');
    expect(screen.queryByRole('button', { name: 'この位置を使う' })).toBeNull();
  });

  it('shows ADR (20 days, 独自計算) beside the stop width, or why it is unknown', () => {
    const judged = bars();
    const { unmount } = render(<Harness judged={judged} wide />);
    const window = judged.slice(-20), adr = window.reduce((sum, bar) => sum + bar.high / bar.low - 1, 0) / 20 * 100;
    expect(card()).toHaveTextContent(`損切り幅 7.0%（10%未満）ADR ${adr.toFixed(1)}%（20日・独自計算）`);
    unmount();
    render(<Harness judged={judged.slice(-10)} wide />);
    expect(card()).toHaveTextContent('ADR 未確認（日足20本未満）');
  });
});

// Seam F owns and the stock view shell (A) calls.
describe('usePositionPlan', () => {
  it('returns the plan, its inputs, update and moveStop, and moves the chart\'s stop line with the stop', () => {
    const moves = [];
    const chartRef = { current: { moveStop: stop => moves.push(stop) } };
    const { result } = renderHook(() => usePositionPlan({ view, template: null, market: null, technical: null, certified: true, judged: bars(), chartRef }));
    expect(Object.keys(result.current).sort()).toEqual(['moveStop', 'plan', 'settings', 'update']);
    expect(result.current.settings).toEqual({ stopPercent: 7, account: 50000, riskPercent: 1.25, capPercent: 25, structuralSymbols: [] });
    expect(result.current.plan).toEqual(positionPlan(view, result.current.settings, { judged: bars() }));
    act(() => result.current.update('stopPercent', 5));
    expect(result.current.settings.stopPercent).toBe(5);
    expect(moves).toEqual([positionPlan(view, { ...result.current.settings }).stop]);
    expect(JSON.parse(localStorage.getItem('brief-plan'))).toMatchObject({ stopPercent: 5 });
    result.current.moveStop(90);
    expect(moves.at(-1)).toBe(90);
    // A value that is not a number changes nothing.
    act(() => result.current.update('account', Number.NaN));
    expect(result.current.settings.account).toBe(50000);
    // The cap never goes above 100%, the risk never above 5%.
    act(() => result.current.update('capPercent', 300));
    expect(result.current.settings.capPercent).toBe(100);
    act(() => result.current.update('riskPercent', 50));
    expect(result.current.settings.riskPercent).toBe(5);
    // A key that is not a plan input changes nothing.
    act(() => result.current.update('structuralSymbols', 3));
    expect(result.current.settings.structuralSymbols).toEqual([]);
  });

  it('has no plan without a view', () => {
    const { result } = renderHook(() => usePositionPlan({ view: null, chartRef: { current: null } }));
    expect(result.current.plan).toBeNull();
  });
});
