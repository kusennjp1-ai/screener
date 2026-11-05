import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import StockView from './StockView';
import { secStatus } from '../fundamentalsExplain.js';
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
    expect(scope.getByText(/EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です/)).toBeInTheDocument();
    expect(scope.getByText('灰色＝値なし（理由は下記）')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/カーソル|長押し/);
    expect(scope.getByRole('img', { name: /2026-06-30: EPS Q4のEPSは年次報告のみ、売上 \+100%/ })).toBeInTheDocument();
    // Every grey bar's reason is readable text, not only an SVG title.
    expect(scope.getByRole('list', { name: '値なしの理由' }).textContent).toBe(['EPS 前年比：24-09〜25-03期は前年同期の値なし', '売上 前年比：24-09〜25-06期は前年同期の値なし', 'EPS 前年比：25-06・26-06期はQ4のEPSは年次報告のみ'].join(''));
    // Each quarter's period and margin sit under its bars as HTML.
    const axis = [...document.querySelectorAll('.brief-q-axis > span')].map(cell => cell.textContent);
    expect(axis).toEqual(['24年9月10', '24年12月10', '25年3月10', '25年6月10', '25年9月10', '25年12月11', '26年3月12', '26年6月13']);
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

  it('says a loss-making base cannot be compared and shows the EPS', () => {
    const loss = record(); loss.quarterly.eps.forEach((p, i) => { p.value = i < 4 ? -0.2 : 0.15; });
    const scope = card(financial(loss));
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('比較不可');
    expect(tile(scope, 'EPS 前年比')).toHaveTextContent('前年同期が赤字・ゼロ（EPS 0.15）');
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
  });

  it('gives the reason for every missing SEC record instead of 未取得', () => {
    const later = record({ asOfDate: '2026-10-02' }); later.quarterly = { ...later.quarterly, eps: later.quarterly.eps.slice(0, 4), revenue: later.quarterly.revenue.slice(0, 4), netIncome: later.quarterly.netIncome.slice(0, 4) };
    const cases = [[null, 'この銘柄の当日分の SEC 四半期データは配信されていません'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_cik' }), 'SEC の銘柄コード表に該当がありません'],
      [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_companyfacts' }), 'SEC に XBRL の財務データがありません。'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'no_quarterly', forms: ['20-F'] }), '四半期報告（10-Q）を提出しない企業です（20-F）。'],
      [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'transient' }), 'SEC からの取得が一時的に失敗しました。次回の更新で再取得します。'], [secUnavailable({ symbol: 'AAA', asOfDate: DATE, reason: 'invalid_payload' }), '提出日や期間を検証できないため使いません。'],
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
    for (const label of ['EPS 前年比', '売上 前年比', '純利益率']) expect(tile(scope, label)).toHaveTextContent('読み込み中…');
    expect(scope.getByText('Code 33 読み込み中')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/未配信|配信されていません/);
    expect(screen.getByText('Code 33 読み込み中', { selector: '.brief-chip' })).toBeInTheDocument();
    cleanup();
    scope = card(pending('error'));
    for (const label of ['EPS 前年比', '売上 前年比', '純利益率']) expect(tile(scope, label)).toHaveTextContent('取得できません');
    expect(scope.getByText('詳細データを取得できません。 Code 33 は判定していません。')).toBeInTheDocument();
    expect(screen.getByTestId('brief-fundamentals')).not.toHaveTextContent(/未配信|配信されていません/);
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
