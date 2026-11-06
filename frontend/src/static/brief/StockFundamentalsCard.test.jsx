import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import FundamentalsCard, { EPS_NOTE } from './StockFundamentalsCard';
import { EARNINGS_CHIP_NOTE, NO_REVENUE_CONCEPT, secStatus } from '../fundamentalsExplain.js';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
import { financialHistory } from '../financialHistory';
import { code33Layered } from '../code33Reference';
import { secPoint, secRecord, secUnavailable } from '../../test/fixtures/secRecord';

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
// The desktop render of the shell's split test: every condition of the trend template met.
const allMet = { passed: 8, failed: 0, unknown: 0, rules: Array.from({ length: 8 }, (_, i) => ({ label: `条件${i + 1}`, state: 'pass', evidence: `条件${i + 1} の根拠` })) };
afterEach(cleanup);

describe('brief fundamentals card', () => {
  const now = Date.parse('2026-10-02T22:00:00Z');
  const QUARTERS = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
    ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30']];
  const record = (options = {}) => secRecord({ symbol: 'AAA', asOfDate: DATE, retrievedAt: '2026-10-02T21:00:00.000Z', quarters: QUARTERS, ...options });
  // The fiscal year ends in June; the June quarter's EPS is only in the 10-K annual value.
  const tenQFiler = () => {
    const value = record();
    value.quarterly.eps = value.quarterly.eps.filter(p => !p.end.endsWith('06-30'));
    value.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4), secPoint('eps', ['2025-07-01', '2026-06-30'], 5.5)];
    return value;
  };
  const financial = (book_financials, { history = null } = {}) => {
    const row = { symbol: 'AAA', market: 'US', as_of_date: DATE, book_financials };
    const book = book_financials ? bookFinancialCurrent(book_financials, 'AAA', DATE, now, row) : null;
    const report = book?.current ? book.report : null;
    const series = history ? financialHistory(history, 'AAA', DATE, now) : null;
    return { report, sec: secStatus(row, book), history: series, historyRetrievedAt: history?.retrieved_at || null, code33: code33Layered(report, series, DATE) };
  };
  const card = value => { render(<StockView data={{ ...data(true), financial: value }} />); return within(screen.getByTestId('brief-fundamentals')); };
  const tile = (scope, label) => scope.getAllByText(label).find(element => element.tagName === 'SMALL').closest('.brief-fact');

  it('shows the latest quarter that has EPS growth and why the newer fiscal Q4 has none', () => {
    const scope = card(financial(tenQFiler()));
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('+40%');
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('2026-03期・最新 2026-06期はQ4のEPSは年次報告のみ');
    expect(tile(scope, '売上 前年比')).toHaveTextContent('+100%2026-06期・前期 +60%');
    expect(scope.getByText('出典：SEC XBRL（10-Q 2026-07-30 提出）・2026-06期まで')).toBeInTheDocument();
    expect(scope.getByText('Code 33 未確認')).toBeInTheDocument();
    // The EPS growth that is known is stated as facts; the fiscal-Q4 EPS stays unknown and is never estimated.
    expect(scope.getByText(/EPS の加速は未確認：EPS前年比 \+10→\+20→\+40（Q4は10-Kのみで未確認）/)).toBeInTheDocument();
    // A phone's legend stays on one line; the reasons are one fold away, with their count.
    expect(scope.getByText('値なし', { selector: '.brief-q-legend span' })).toBeInTheDocument();
    expect(scope.getByText('値なしの理由').closest('summary')).toHaveTextContent('値なしの理由3件・業績の質の根拠・対象外の項目');
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/カーソル|長押し/);
    expect(scope.getByRole('img', { name: /2026-06-30: EPS Q4のEPSは年次報告のみ、売上 \+100%/ })).toBeInTheDocument();
    // Every grey bar's reason is readable text, not only an SVG title.
    expect(scope.getByRole('list', { name: '値なしの理由' }).textContent).toBe(['EPS 前年比：24-09〜25-03期は前年同期の値なし', '売上 前年比：24-09〜25-06期は前年同期の値なし', 'EPS 前年比：25-06・26-06期はQ4のEPSは年次報告のみ'].join(''));
    // Each quarter's period, EPS and sales growth (grey — when unknown) and margin sit under its bars as HTML.
    const axis = [...document.querySelectorAll('.brief-q-axis > span')].map(cell => [...cell.children].map(part => part.textContent));
    expect(axis).toEqual([['24年', '9月', '—', '—', '10'], ['24年', '12月', '—', '—', '10'], ['25年', '3月', '—', '—', '10'], ['25年', '6月', '—', '—', '10'],
      ['25年', '9月', '+10', '+10', '10'], ['25年', '12月', '+20', '+30', '11'], ['26年', '3月', '+40', '+60', '12'], ['26年', '6月', '—', '+100', '13']]);
    expect([...document.querySelectorAll('.brief-q-axis .is-unknown')]).toHaveLength(9);
    // The Q4 EPS explanation is given once, in the Code 33 section (the parts it repeats are hidden on a phone).
    expect(screen.getByTestId('brief-fundamentals').textContent.match(/Q4は10-Kのみで未確認|年次報告（10-K）にしか無い/g)).toHaveLength(1);
    expect(document.querySelector('.brief-code33-parts')).toHaveClass('is-said');
    // The quality row: three-valued. +10% and +20% are known and under 25%, so the missing fiscal-Q4 EPS cannot
    // rescue the rule: 未達, with the quarters named in the fold. Nothing passes from missing quarters.
    expect([...document.querySelectorAll('.brief-fin-quality li')].map(chip => [chip.textContent, chip.className])).toEqual([['EPS前年比≥25%（直近4期）未達', 'brief-chip tone-ext'], ['年間EPS最高 未確認', 'brief-chip']]);
    expect(scope.getByRole('list', { name: '業績の質の根拠' }).closest('details')).not.toBeNull();
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('EPS前年比が25%未満の期：25-09期 +10%・25-12期 +20%');
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent('未取得');
  });

  it('flags a sales rate whose quarter or year-ago base is a derived Q4', () => {
    const derive = point => Object.assign(point, { form: '10-K', derived: 'fiscal-year-minus-three-quarters', components: ['fy', 'q1', 'q2', 'q3'] });
    // Only the base (2025-06) is derived: the shown 2026-06 quarter is reported.
    const baseOnly = tenQFiler();
    for (const key of ['revenue', 'netIncome']) derive(baseOnly.quarterly[key].find(p => p.end === '2025-06-30'));
    let scope = card(financial(baseOnly));
    expect(tile(scope, '売上 前年比')).toHaveTextContent('+100%2026-06期・前期 +60%・前年同期はQ4算出');
    expect(scope.getByText(/^出典：SEC XBRL（10-Q 2026-07-30 提出）・2026-06期まで・売上\/純利益のQ4は10-K年度値−3四半期で算出$/)).toBeInTheDocument();
    expect(tile(scope, '純利益率')).not.toHaveTextContent('Q4算出');
    cleanup();
    // Both the quarter and its base are derived: the source names the derivation once.
    const both = tenQFiler();
    for (const key of ['revenue', 'netIncome']) for (const end of ['2025-06-30', '2026-06-30']) derive(both.quarterly[key].find(p => p.end === end));
    scope = card(financial(both));
    expect(tile(scope, '売上 前年比')).toHaveTextContent('・前年同期はQ4算出');
    expect(scope.getByText(/^出典：SEC XBRL（10-K 2026-07-30 提出）・2026-06期まで・売上\/純利益のQ4は10-K年度値−3四半期で算出$/)).toBeInTheDocument();
    cleanup();
    // Neither derived: no derivation note anywhere.
    scope = card(financial(tenQFiler()));
    expect(tile(scope, '売上 前年比')).not.toHaveTextContent('Q4算出');
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent('年度値−3四半期で算出');
  });

  it('tells a swing from a loss to a profit as a fact (黒字転換), never as a growth rate', () => {
    const loss = record(); loss.quarterly.eps.forEach((p, i) => { p.value = i < 4 ? -0.2 : 0.15; });
    const scope = card(financial(loss));
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('黒字転換2026-06期・前年 −0.20 → 0.15');
    expect(tile(scope, 'EPS 前年比')).not.toHaveTextContent('%');
    const turned = [...document.querySelectorAll('.brief-q-axis .q-eps-t')].slice(-4);
    expect(turned.map(cell => cell.textContent)).toEqual(['黒字', '黒字', '黒字', '黒字']);
    // 黒字 is a known fact: it keeps the EPS colour, never the grey of 値なし.
    for (const cell of turned) expect(cell).not.toHaveClass('is-unknown');
    cleanup();
    // A loss now (both years negative) stays 比較不可 with the EPS, written with the minus sign the card uses everywhere.
    const deeper = record(); deeper.quarterly.eps.forEach((p, i) => { p.value = i < 4 ? -0.2 : -0.1; });
    const other = card(financial(deeper));
    expect(tile(other, 'EPS 前年比')).toHaveTextContent('比較不可');
    expect(tile(other, 'EPS 前年比')).toHaveTextContent('前年同期が赤字・ゼロ（EPS −0.10）');
    cleanup();
    // A profit a year ago and a loss now: the fact 赤字 in four characters or fewer, never −1300.
    const fell = record({ eps: [1, 1, 1, 1, 1.1, 1.2, 1.4, -12] });
    card(financial(fell));
    const last = [...document.querySelectorAll('.brief-q-axis .q-eps-t')].at(-1);
    expect(last).toHaveTextContent('赤字');
    expect(last).not.toHaveClass('is-unknown');
    for (const cell of document.querySelectorAll('.brief-q-axis .q-eps-t, .brief-q-axis .q-sales-t')) expect(cell.textContent.length).toBeLessThanOrEqual(4);
    // The 未達 it settles says the loss as a fact as well.
    expect(screen.getByText('未達の根拠：EPS 前年比が2026-03期 +40% → 2026-06期は赤字（EPS −12.00）です。')).toBeInTheDocument();
  });

  it('labels each quarter in four characters or fewer and flags only recent balance-sheet growth well above sales', () => {
    const value = record({ revenue: [100, 100, 100, 100, 1200, 65, 160, 200] });
    value.quarterly.inventory = QUARTERS.map(([, end], i) => secPoint('inventory', [null, end], [50, 50, 50, 50, 50, 50, 50, 150][i]));
    const scope = card(financial(value));
    expect([...document.querySelectorAll('.brief-q-axis .q-sales-t')].map(cell => cell.textContent).slice(-4)).toEqual(['>999', '−35', '+60', '+100']);
    for (const cell of document.querySelectorAll('.brief-q-axis .q-eps-t, .brief-q-axis .q-sales-t')) expect(cell.textContent.length).toBeLessThanOrEqual(4);
    // Inventory +200% against sales +100% in the newest quarter: a caution, labelled as this app's own rule on its
    // face, with its numbers in visible text (the fold on a phone), not only in a title.
    const caution = scope.getByText('在庫の伸び＞売上（26-06期・独自判定）');
    expect(caution).toHaveClass('tone-wait');
    const detail = '在庫の伸び：26-06期 前年比 +200%、売上 +100%（20ポイント以上の差で表示する独自判定）';
    expect(caution).toHaveAttribute('title', detail);
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent(detail);
    cleanup();
    // Within 20 points, or no balance-sheet quarters at all: no caution.
    const close = record(); close.quarterly.inventory = QUARTERS.map(([, end], i) => secPoint('inventory', [null, end], [50, 50, 50, 50, 50, 50, 50, 105][i]));
    card(financial(close));
    expect(document.querySelector('.brief-fin-quality').textContent).not.toContain('在庫');
    cleanup();
    card(financial(record()));
    expect(document.querySelector('.brief-fin-quality').textContent).not.toMatch(/在庫|売掛金/);
  });

  it('passes the EPS floor and the annual record only on known values and names the quarters behind a 未達', () => {
    const strong = record({ eps: [1, 1, 1, 1, 1.3, 1.4, 1.6, 2] });
    // The three years as the newest 10-K presents them (one accession).
    const tenK = { form: '10-K', accession: 'k-2025' };
    strong.annualEps = [secPoint('eps', ['2023-01-01', '2023-12-31'], 3, tenK), secPoint('eps', ['2024-01-01', '2024-12-31'], 3.5, tenK), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5, tenK)];
    let scope = card(financial(strong));
    expect([...document.querySelectorAll('.brief-fin-quality li')].map(chip => [chip.textContent, chip.className])).toEqual([
      ['EPS前年比≥25%（直近4期）達成', 'brief-chip tone-zone'], ['年間EPS最高 更新', 'brief-chip tone-zone']]);
    // The span the annual record compared is said in words, not only in a title.
    expect(document.querySelectorAll('.brief-fin-quality li')[1]).toHaveAttribute('title', '直近10-Kの3年度で最高');
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('年間EPS：直近の年度（2025-12期）の 5.50 は、直近10-Kの3年度で最高です。');
    cleanup();
    // A newest 10-K with two years beside an older one: a split between them cannot be ruled out, so no record is claimed.
    const twoYear = record({ eps: [1, 1, 1, 1, 1.3, 1.4, 1.6, 2] });
    twoYear.annualEps = [secPoint('eps', ['2023-01-01', '2023-12-31'], 0.3, { accession: 'k-2023' }), secPoint('eps', ['2024-01-01', '2024-12-31'], 2, tenK), secPoint('eps', ['2025-01-01', '2025-12-31'], 2.6, tenK)];
    scope = card(financial(twoYear));
    expect(document.querySelectorAll('.brief-fin-quality li')[1]).toHaveTextContent('年間EPS最高 未確認');
    expect(document.querySelectorAll('.brief-fin-quality li')[1]).toHaveAttribute('class', 'brief-chip');
    expect(document.querySelectorAll('.brief-fin-quality li')[1]).toHaveAttribute('title', '直近10-Kが2年度分のみで、分割の影響を確かめられないため未確認');
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('年間EPS：直近10-Kが2年度分のみで、分割の影響を確かめられないため未確認。');
    cleanup();
    // A lower latest annual EPS is 未更新; one growth rate under 25% in the latest four is 未達, and the 20% level
    // reached by every quarter is said on the chip itself.
    const weaker = record({ eps: [1, 1, 1, 1, 1.3, 1.22, 1.4, 1.5] });
    weaker.annualEps = [secPoint('eps', ['2023-01-01', '2023-12-31'], 3), secPoint('eps', ['2024-01-01', '2024-12-31'], 5.5), secPoint('eps', ['2025-01-01', '2025-12-31'], 5)];
    scope = card(financial(weaker));
    const chips = [...document.querySelectorAll('.brief-fin-quality li')];
    expect(chips.map(chip => [chip.textContent, chip.className])).toEqual([['EPS前年比≥25%（直近4期）未達（20%以上は達成）', 'brief-chip tone-ext'], ['年間EPS最高 未更新', 'brief-chip tone-ext']]);
    expect(chips[0]).toHaveAttribute('title', 'EPS前年比が25%未満の期：25-12期 +22%（20%以上は直近4期とも達成）');
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('EPS前年比が25%未満の期：25-12期 +22%（20%以上は直近4期とも達成）');
    cleanup();
    // A loss-maker whose loss shrinks every year never reads as a record (and never in the zone tone).
    const shrinking = record({ eps: [1, 1, 1, 1, 1.3, 1.4, 1.6, 2] });
    shrinking.annualEps = [-3, -2, -1.5, -0.8].map((value, i) => secPoint('eps', [`${2022 + i}-01-01`, `${2022 + i}-12-31`], value));
    scope = card(financial(shrinking));
    const annual = [...document.querySelectorAll('.brief-fin-quality li')][1];
    expect([annual.textContent, annual.className]).toEqual(['年間EPS 赤字', 'brief-chip tone-ext']);
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/更新/);
    expect([...document.querySelectorAll('.brief-fin-quality li.tone-zone')].map(chip => chip.textContent)).toEqual(['EPS前年比≥25%（直近4期）達成']);
    expect(scope.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('年間EPS：直近の年度（2025-12期）は −0.80 の赤字です（赤字の年度は最高と数えません）。');
    cleanup();
    // Sales growth +10, +30, +60, then +30: a known fall settles 未達, and the card names the series and its two quarters.
    const falling = record({ revenue: [100, 100, 100, 100, 110, 130, 160, 130] });
    scope = card(financial(falling));
    expect(scope.getByText('Code 33 未達')).toBeInTheDocument();
    expect(scope.getByText('未達の根拠：売上 前年比が2026-03期 +60% → 2026-06期 +30%と伸びが鈍化しています。')).toBeInTheDocument();
    // A 未達 keeps the three parts visible on a phone (the text names only the failed one).
    expect(document.querySelector('.brief-code33-parts')).not.toHaveClass('is-said');
  });

  it('folds a stock without SEC quarters into one line on a phone, with the reasons in its fold', () => {
    render(<StockView data={{ ...data(true), financial: financial(null) }} />);
    const scope = within(screen.getByTestId('brief-fundamentals'));
    const summary = scope.getByText('業績：SEC未配信・Code 33 未確認');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(summary.closest('details')).toHaveTextContent('この銘柄の当日分の SEC 四半期データは配信されていません。');
    cleanup();
    // A delivery failure of the publication says so in the line; a refused record says it was not verified.
    const coverage = { schema_version: 'fundamentals-coverage-v1', as_of_date: DATE, sec_fetch_ran: false, sec_as_of: null, file_schema: null, universe: 993, requested: null, eligible: null, truncated: null, deadline_unreached: null, ticker_map_ok: null, admitted: 0, with_quarters: 0, not_requested: 0, not_fetched: 993, refused: 0, refused_by_reason: {} };
    const failed = row => ({ report: null, sec: secStatus(row, null, { detail: 'loaded', coverage }), history: null, code33: code33Layered(null, null, DATE) });
    render(<StockView data={{ ...data(true), financial: failed({ symbol: 'AAA', market: 'US', as_of_date: DATE }) }} />);
    expect(screen.getByText('業績：SEC未配信（配信側の問題）・Code 33 未確認')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).toHaveTextContent('この公開（10/2分）では SEC 四半期データを反映していません（反映は公開993銘柄中0銘柄・配信側の問題で、業績の良し悪しではありません）。');
    cleanup();
    const refused = { ...coverage, sec_fetch_ran: true, sec_as_of: DATE, file_schema: 2, requested: 600, not_fetched: 0, not_requested: 973, refused: 20, refused_by_reason: { cik_url: 20 } };
    render(<StockView data={{ ...data(true), financial: { report: null, sec: secStatus({ symbol: 'AAA', market: 'US', as_of_date: DATE, sec_admission: { state: 'refused', reason: 'cik_url' } }, null, { detail: 'loaded', coverage: refused }), history: null, code33: code33Layered(null, null, DATE) } }} />);
    expect(screen.getByText('業績：SEC不採用（検証できず）・Code 33 未確認')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).toHaveTextContent('取得対象でしたが、SEC の記録を検証できず不採用にしました（出典URLとCIK番号が一致しないため）。');
    cleanup();
    // The desktop keeps today's layout: nothing folded.
    render(<StockView data={{ ...data(true), financial: financial(null), template: allMet }} wide />);
    expect(within(screen.getByTestId('brief-fundamentals')).queryByText(/^業績：/)).toBeNull();
    expect(screen.getByTestId('brief-fundamentals').querySelector('details')).toBeNull();
  });

  it('lists the quarters themselves when there is no year-ago base yet', () => {
    // Rising margins keep Code 33 open (a flat margin would already make it 未達).
    const young = secRecord({ symbol: 'AAA', asOfDate: DATE, retrievedAt: '2026-10-02T21:00:00.000Z', quarters: QUARTERS.slice(-4), netIncome: [10, 11, 12, 13] });
    const scope = card(financial(young));
    expect(scope.getByRole('table')).toHaveTextContent('2026-06');
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('前年同期なし');
    expect(scope.getByText('前年同期の値がないため成長率は表示できません（4期分のみ）。')).toBeInTheDocument();
    expect(scope.getByText('四半期データが 4 期分のため判定できません（直近4期とその前年同期の計8期が必要）。')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent('未取得');
    // The text says only 「4 期分」, so the known rise of the margin stays visible on a phone.
    expect(document.querySelector('.brief-code33-parts')).not.toHaveClass('is-said');
    expect(document.querySelector('.brief-code33-parts')).toHaveTextContent('純利益率の上昇達成');
  });

  it('gives the reason for every missing SEC record instead of 未取得', () => {
    const later = record({ asOfDate: '2026-10-02' }); later.quarterly = { ...later.quarterly, eps: later.quarterly.eps.slice(0, 4), revenue: later.quarterly.revenue.slice(0, 4), netIncome: later.quarterly.netIncome.slice(0, 4) };
    const cases = [[null, 'この銘柄の当日分の SEC 四半期データは配信されていません'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_cik' }), 'SEC の銘柄コード表に該当がありません'],
      [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_companyfacts' }), 'SEC に XBRL の財務データがありません。'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_quarterly', forms: ['20-F'] }), '四半期報告（10-Q）を提出しない企業です（20-F）。'],
      [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'transient' }), 'SEC からの取得が一時的に失敗しました（この公開には値がありません）。'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'invalid_payload' }), 'SEC の記録を読み取れませんでした（取得側の処理エラーで、業績の良し悪しではありません）。'],
      [later, '直近の四半期（2025-06期）から180日を超えているため判定しません。']];
    for (const [value, text] of cases) {
      const scope = card(financial(value));
      expect(scope.getByText(new RegExp(text.replace(/[()（）.]/g, '.')))).toBeInTheDocument();
      expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent('未取得');
      cleanup();
    }
    const fund = { report: null, sec: secStatus({ symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF' }, null), history: null, code33: { state: 'unknown', source: null } };
    expect(card(fund).getByText(/ファンド・ETF などは企業業績の対象外です。/)).toBeInTheDocument();
  });

  it('says the detail is loading or failed instead of 未配信 while the SEC record cannot have arrived', () => {
    const pending = (detail, history = null) => {
      const row = { symbol: 'AAA', market: 'US', as_of_date: DATE };
      const sec = secStatus(row, null, { detail });
      return { report: null, sec, history, historyRetrievedAt: null, code33: code33Layered(null, history, DATE) };
    };
    let scope = card(pending('loading'));
    // The phone's one line says it once.
    expect(document.querySelector('.brief-fin-missing summary').textContent).toBe('業績：読み込み中…');
    for (const label of ['EPS 前年比', '売上 前年比', '純利益率']) expect(tile(scope, label)).toHaveTextContent('読み込み中…');
    expect(scope.getByText('Code 33 読み込み中')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/未配信|配信されていません/);
    cleanup();
    scope = card(pending('error'));
    for (const label of ['EPS 前年比', '売上 前年比', '純利益率']) expect(tile(scope, label)).toHaveTextContent('取得できません');
    expect(scope.getByText('詳細データを取得できません。 Code 33 は判定していません。')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/未配信|配信されていません/);
  });

  it('writes a negative margin with U+2212, never the ASCII hyphen', () => {
    const history = { symbol: 'AAA', as_of_date: DATE, status: 'available', basis: 'reported_diluted_eps', currency: 'USD', retrieved_at: '2026-10-02T20:15:00Z', annual: [],
      quarterly: [['2025-06-30', -1, 100, -900], ['2025-09-30', -1.1, 110, -1000], ['2025-12-31', -1.2, 120, -1100], ['2026-03-31', -1.3, 130, -1200], ['2026-06-30', -1.5, 150, -2052.9]].map(([end, eps, revenue, netIncome]) => ({ end, eps, revenue, netIncome })) };
    const scope = card(financial(null, { history }));
    expect(tile(scope, '純利益率')).toHaveTextContent('−1368.6%');
    expect(screen.getByTestId('brief-fundamentals').textContent).not.toMatch(/(^|[^\w])-\d/);
  });

  it('labels Yahoo quarterly values as a reference only when that history is current', () => {
    const history = { symbol: 'AAA', as_of_date: DATE, status: 'available', basis: 'reported_diluted_eps', currency: 'USD', retrieved_at: '2026-10-02T20:15:00Z', annual: [],
      quarterly: [['2025-06-30', 1, 100, 10], ['2025-09-30', 1.1, 110, 12], ['2025-12-31', 1.2, 120, 13], ['2026-03-31', 1.3, 130, 15], ['2026-06-30', 1.5, 150, 18]].map(([end, eps, revenue, netIncome]) => ({ end, eps, revenue, netIncome })) };
    let scope = card(financial(null, { history }));
    expect(scope.getByText('出典：参考 Yahoo 四半期値（取得 10-02 20:15 UTC・提出日未確認）')).toBeInTheDocument();
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('+50%参考・Yahoo 2026-06期');
    expect(tile(scope, '純利益率')).toHaveTextContent('12.0%');
    expect(scope.getByText(/配信されていません/)).toBeInTheDocument();
    cleanup();
    scope = card(financial(null, { history: { ...history, retrieved_at: '2026-09-20T00:00:00Z' } }));
    expect(scope.queryByText(/Yahoo/)).toBeNull();
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('—SEC 未配信');
    cleanup();
    // A current history whose newest quarter is more than 190 days old: the rates are not compared, and
    // the tiles say that, not 比較不可.
    const old = { ...history, quarterly: [['2024-12-31', 1, 100, 10], ['2025-03-31', 1, 100, 10], ['2025-06-30', 1.1, 110, 12], ['2025-09-30', 1.2, 120, 13], ['2025-12-31', 1.3, 130, 15]].map(([end, eps, revenue, netIncome]) => ({ end, eps, revenue, netIncome })) };
    scope = card(financial(null, { history: old }));
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('—参考・Yahoo 2025-12期は190日超のため比較しません');
    expect(tile(scope, '売上 前年比')).toHaveTextContent('—参考・Yahoo 2025-12期は190日超のため比較しません');
    expect(tile(scope, '純利益率')).toHaveTextContent('11.5%参考・Yahoo 2025-12期');
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent('比較不可');
    cleanup();
    // A newest quarter with no year-ago quarter names that.
    scope = card(financial(null, { history: { ...history, quarterly: history.quarterly.slice(1) } }));
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('—参考・Yahoo 前年同期の値なし');
  });
});

describe('brief stock view on a phone folds what is secondary, never a fired or unknown check', () => {
  afterEach(() => sessionStorage.clear());

  it('gathers the methodology footnotes in the screen\'s one 注記 (the fundamentals card\'s)', () => {
    render(<StockView data={data(true)} />);
    // The methodology footnotes are in the screen's one 注記.
    const notes = screen.getByText('注記').closest('details');
    expect(notes).toHaveTextContent('EPS は報告値（希薄化）で調整後EPSとは異なります。');
  });

  it('shows everything open on the desktop, each footnote in place on its card and no 注記 (the fundamentals card)', () => {
    render(<StockView data={{ ...data(true), template: allMet }} wide />);
    expect(within(screen.getByTestId('brief-fundamentals')).getByText(/^EPS は報告値（希薄化）で調整後EPSとは異なります。/)).toBeInTheDocument();
  });
});

describe('round-2 card copy (plan DT1-DT4, DT7, DT10)', () => {
  const DATE = '2026-11-04', now = Date.parse('2026-11-04T12:00:00Z');
  const financial = (book_financials, extra = {}) => {
    const row = { symbol: 'AAA', market: 'US', as_of_date: DATE, book_financials };
    const book = book_financials ? bookFinancialCurrent(book_financials, 'AAA', DATE, now, row) : null;
    const report = book?.current ? book.report : null;
    return { report, sec: secStatus(row, book), history: null, historyRetrievedAt: null, code33: code33Layered(report, null, DATE), ...extra };
  };
  const show = (value, wide = false) => { render(<FundamentalsCard financial={value} wide={wide} />); return screen.getByTestId('brief-fundamentals'); };
  const quarters = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
    ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30']];

  it('says a fiscal Q4 without any quarterly value is in the annual report only, never 古い or 欠け', () => {
    const value = secRecord({ symbol: 'AAA', asOfDate: DATE, quarters: quarters.slice(0, 8) });
    for (const key of ['eps', 'revenue', 'netIncome']) value.quarterly[key] = value.quarterly[key].filter(p => !p.end.endsWith('06-30'));
    value.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4, { form: '10-K', filed: '2025-08-20', accession: 'k-25' }), secPoint('eps', ['2025-07-01', '2026-06-30'], 5, { form: '10-K', filed: '2026-08-20', accession: 'k-26' })];
    const card = show(financial(value));
    expect(card.querySelector('.brief-fin-missing summary').textContent).toBe('業績：Q4年次のみ・Code 33 未確認');
    expect(card).toHaveTextContent('第4四半期（26-06期）は年次報告のみで四半期の値がありません。');
    expect(card).not.toHaveTextContent(/古い|欠け/);
  });

  it('says a bank\'s sales are out of scope, and an unreadable payload is a fetch-side error', () => {
    const bank = secRecord({ symbol: 'AAA', asOfDate: DATE, quarters: quarters.slice(1) }); bank.quarterly.revenue = [];
    const card = show(financial(bank));
    // One short line per tile; the full sentence is the tile's title (and the 値なしの理由 list's).
    expect(card.querySelector('.brief-fact:nth-child(2)')).toHaveTextContent('売上 前年比対象外銀行・保険など');
    expect(card.querySelector('.brief-fact:nth-child(3)')).toHaveTextContent('純利益率対象外売上の科目なし');
    for (const n of [2, 3]) expect(card.querySelector(`.brief-fact:nth-child(${n})`)).toHaveAttribute('title', NO_REVENUE_CONCEPT);
    // Every quarter is out of scope, so the reasons list says it once, without the periods.
    expect(within(card).getByRole('list', { name: '値なしの理由' })).toHaveTextContent(`売上 前年比：${NO_REVENUE_CONCEPT}`);
    expect(card.querySelector('.brief-facts')).not.toHaveTextContent('未報告');
    cleanup();
    const invalid = secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'invalid_payload', invalid_detail: { class: 'PayloadMismatch', message: 'companyfacts cik does not match the requested cik', requested_cik: 6, received_cik: 9 } });
    const other = show(financial(invalid));
    expect(other).toHaveTextContent('SEC の記録を読み取れませんでした（取得側の処理エラーで、業績の良し悪しではありません）。返された記録の CIK 番号が要求と違いました。');
    expect(other).not.toHaveTextContent('提出日や期間');
  });

  it('compares the annual record within the newest 10-K\'s years and says so', () => {
    const value = secRecord({ symbol: 'AAA', asOfDate: DATE, quarters: quarters.slice(1) });
    const tenK = (year, eps) => secPoint('eps', [`${year - 1}-07-01`, `${year}-06-30`], eps, { form: '10-K', filed: '2026-08-20', accession: 'k-2026' });
    value.annualEps = [secPoint('eps', ['2022-07-01', '2023-06-30'], 12, { form: '10-K', filed: '2023-08-20', accession: 'k-2023' }), tenK(2024, 1.2), tenK(2025, 1.6), tenK(2026, 2.0)];
    show(financial(value), true);
    expect(screen.getByText('年間EPS最高 更新')).toHaveAttribute('title', '直近10-Kの3年度で最高');
    expect(screen.getByRole('list', { name: '業績の質の根拠' })).toHaveTextContent('年間EPS：直近の年度（2026-06期）の 2.00 は、直近10-Kの3年度で最高です。');
  });

  it('colours only an SEC 達成: a 未達 and a Yahoo reference read in the neutral tone', () => {
    const fail = secRecord({ symbol: 'AAA', asOfDate: DATE, quarters: quarters.slice(1) });
    [12, 11, 10, 9, 12, 11, 10, 9].forEach((m, i) => { fail.quarterly.netIncome[i].value = fail.quarterly.revenue[i].value * m / 100; });
    const card = show(financial(fail));
    expect(card.querySelector('.brief-code33')).toHaveClass('tone-neutral');
    expect(card.querySelector('.brief-code33 strong')).toHaveTextContent('Code 33 未達');
    cleanup();
    const reference = show({ report: null, sec: { state: 'no_quarterly', short: '四半期報告なし', long: '…' }, history: null, code33: { state: 'pass', source: 'yahoo', label: '参考：Yahoo四半期値' } });
    expect(reference.querySelector('.brief-code33')).toHaveClass('tone-neutral');
    expect(reference.querySelector('.brief-code33 strong')).toHaveTextContent('Code 33 達成（参考）');
  });

  it('says the green earnings chip\'s 独自設定 rule in the phone notes, and keeps the desktop card note as it was', () => {
    expect(EPS_NOTE.endsWith(EARNINGS_CHIP_NOTE)).toBe(true);
    const wide = show(financial(secRecord({ symbol: 'AAA', asOfDate: DATE })), true);
    expect(wide).toHaveTextContent(/^.*EPS は報告値（希薄化）/);
    expect(wide).not.toHaveTextContent('業績チップ');
  });
});
