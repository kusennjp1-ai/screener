import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketCard from './MarketCard';

// Payloads in the shape the exporter emits (tools/export-market-trends.mjs): indices carry points,
// latest (null when the index series ends before the analysis date), lastObserved and followThrough.
const ENVIRONMENT = ['trendTemplateCount', 'trendTemplatePercent', 'rs90TemplateCount', 'above150', 'above150Percent', 'above200', 'above200Percent', 'stage1', 'stage2', 'stage3', 'stage4', 'breakouts', 'breakoutsJudged', 'breakoutsHeld', 'leaderCohort', 'leaderCohortAbove50'];
const days = (end, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${end}T00:00:00Z`) - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
const point = (date, over = {}) => ({ date, coverage: 200, eligibleUniverse: 200, universe: 200, above50: 86, above50Percent: 43, newHighs: 40, newLows: 12, leaderCount: 20,
  trendTemplateCount: 30, rs90TemplateCount: 8, above200: 90, above200Percent: 45, stage1: 50, stage2: 70, stage3: 40, stage4: 40, breakoutsJudged: 8, breakoutsHeld: 6, ...over });
const breadth = (end, at = () => ({}), n = 30) => days(end, n).map((date, i) => point(date, at(i, n)));
const confirmed = asOf => ({ available: true, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', asOf, state: 'confirmed', peak: { date: '2026-07-01', close: 6000 }, low: { date: '2026-08-01', low: 5400 }, declinePct: 9.1,
  attempt: { startDate: '2026-08-04', day: 4 }, ftd: { date: '2026-08-07', attemptDay: 4, gainPct: 1.43, volumeRatio: 1.2, sessionsSince: 40, distributionSince: 2 }, failedDate: null, events: [] });
const attempt = asOf => ({ available: true, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', asOf, state: 'rally_attempt', peak: { date: '2026-09-10', close: 21000 }, low: { date: '2026-09-29', low: 19500 }, declinePct: 7.2,
  attempt: { startDate: '2026-09-30', day: 3 }, ftd: null, failedDate: null, events: [] });
const index = (symbol, asOf, value, date, followThrough, legacy) => {
  const points = [{ date: asOf, value, distribution: false, reason: null }];
  const historical = asOf < date;
  return { symbol, available: !historical, points, events: [], latest: historical ? null : points.at(-1), ...(historical ? { historical: true, reason: `${date}は未取得。${asOf}までの過去記録を表示しています。` } : {}),
    ...(legacy ? {} : { lastObserved: { date: asOf, value }, followThrough }) };
};
const trends = ({ asOf = '2026-10-02', date = asOf, rows = breadth(asOf), follow = [confirmed(asOf), attempt(asOf)], legacy = false, history = true } = {}) => ({ loading: false, error: false,
  data: { as_of_date: date, indices: [index('^GSPC', asOf, 3, date, follow[0], legacy), index('^IXIC', asOf, 4, date, follow[1], legacy)], ...(history ? { long_history: { as_of_date: asOf, breadth: rows, sp500: [] } } : {}) } });
const UP = { label: '上昇トレンド（独自判定）', cap: 0.5 };
const show = (value, { date = '2026-10-02', detail = true, market = UP, marketLoading = false } = {}) => render(<MemoryRouter><MarketCard market={market} marketLoading={marketLoading} trends={value} date={date} detail={detail} /></MemoryRouter>);
const tiles = () => [...document.querySelectorAll('.brief-fact')];
const tile = label => tiles().find(element => element.querySelector('small').textContent === label) || null;
const bare = /未取得|未確認|NaN|undefined|null/;

describe('brief market card', () => {
  it('shows every environment metric for the analysis date without an as-of note', () => {
    show(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { trendTemplateCount: 25, rs90TemplateCount: 10, above200: 80, above200Percent: 40 } : {})) }));
    expect(tile('分配日（25日）')).toHaveTextContent('3・4S&P・NAS');
    expect(tile('TT達成数')).toHaveTextContent('30銘柄1か月で +5');
    expect(tile('200日線より上')).toHaveTextContent('45.0%観測200中90銘柄・1か月前 40.0%');
    expect(tile('50日線より上')).toHaveTextContent('43.0%観測200中86銘柄');
    expect(tile('ブレイクアウト成功率')).toHaveTextContent('75%10〜29営業日前の8件・10日で−7%未満');
    expect(tile('RS90以上のTT達成（独自RS）')).toHaveTextContent('8銘柄1か月で −2');
    expect(tile('52週の新高値・新安値')).toHaveTextContent('40・12差 +28');
    const [spx, ndx] = tile('フォロースルーデー（独自判定）').querySelectorAll('.brief-ftd-row');
    expect(spx).toHaveTextContent('S&P確認 8/7+1.4%・反発4日目・その後の分配日2');
    expect(ndx).toHaveTextContent('NAS反発3日目安値9/29・4日目以降の+1.2%上昇待ち');
    for (const element of tiles()) expect(element.textContent).not.toMatch(bare);
    expect(document.querySelector('.brief-fact-asof')).toBeNull();
    expect(screen.queryByText(/時点（分析基準日/)).toBeNull();
    expect(screen.getByText(/独自集計で、IBDの公式値ではありません/)).toBeInTheDocument();
  });

  it('keeps the four buy-or-wait facts on Today and links to the market tab for the rest', () => {
    show(trends(), { detail: false });
    expect(tiles().map(element => element.querySelector('small').textContent)).toEqual(['分配日（25日）', 'TT達成数', '200日線より上', '52週の新高値・新安値']);
    expect(screen.getByText('30銘柄')).toBeInTheDocument();
    expect(screen.getByText('3・4')).toBeInTheDocument();
    expect(screen.queryByText('75%')).toBeNull();
    expect(screen.queryByText(/フォロースルーデー/)).toBeNull();
    expect(screen.queryByRole('img', { name: /ステージ構成/ })).toBeNull();
    expect(screen.getByRole('link', { name: /市場の詳細/ })).toHaveAttribute('href', '/brief/market');
  });

  it('shows the stage mix on the market tab without a link to itself', () => {
    show(trends());
    expect(screen.getByRole('img', { name: /^ステージ構成 ステージ1 25\.0%、ステージ2 35\.0%/ })).toBeInTheDocument();
    expect(screen.queryByTestId('brief-stage-missing')).toBeNull();
    expect(screen.queryByRole('link', { name: /市場の詳細/ })).toBeNull();
  });

  it('labels an older long history and index observation with their own dates, never as today\'s', () => {
    show(trends({ asOf: '2026-10-01', date: '2026-10-02' }));
    expect(screen.getByRole('note')).toHaveTextContent('長期集計は 2026-10-01 時点・分配日は 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）');
    // The exporter withholds latest for an index that ends early; the card shows lastObserved with its date.
    expect(tile('分配日（25日）')).toHaveTextContent('3・4（10/1時点）');
    expect(tile('TT達成数')).toHaveTextContent('30銘柄（10/1時点）');
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('確認 8/7（10/1時点）');
    expect(screen.getByRole('img', { name: /ステージ構成 .*（10\/1時点）$/ })).toBeInTheDocument();
  });

  it('names the one index whose count is older instead of dating both', () => {
    const value = trends();
    value.data.indices[1] = index('^IXIC', '2026-10-01', 4, '2026-10-02', attempt('2026-10-01'));
    show(value);
    expect(tile('分配日（25日）')).toHaveTextContent('3・4（NAS 10/1時点）');
    expect(screen.getByRole('note')).toHaveTextContent('分配日は NAS 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）');
    expect(screen.getByRole('note')).not.toHaveTextContent('長期集計は');
    expect(tile('フォロースルーデー（独自判定）').querySelectorAll('.brief-fact-asof')).toHaveLength(1);
  });

  it('dates an older distribution count from an older publication that has no lastObserved', () => {
    show(trends({ asOf: '2026-10-01', date: '2026-10-02', legacy: true }));
    expect(tile('分配日（25日）')).toHaveTextContent('3・4（10/1時点）');
    expect(screen.getByRole('note')).toHaveTextContent('分配日は 2026-10-01 時点');
    const ftd = tile('フォロースルーデー（独自判定）');
    expect(ftd).toHaveTextContent('未集計旧形式の公開データ');
    expect(ftd.textContent).not.toMatch(bare);
  });

  it('never turns a missing newest value into a change, a unit or today\'s value', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { trendTemplateCount: null, rs90TemplateCount: null, above200: null, above200Percent: null, stage1: null, stage2: null, stage3: null, stage4: null } : i === n - 2 ? { trendTemplateCount: 28 } : {}));
    show(trends({ rows }));
    expect(tile('TT達成数')).toHaveTextContent('28銘柄（10/1時点）');
    expect(tile('TT達成数')).not.toHaveTextContent(/1か月で −30|−28/);
    expect(tile('200日線より上')).toHaveTextContent('45.0%（10/1時点）');
    expect(tile('RS90以上のTT達成（独自RS）')).toHaveTextContent('8銘柄（10/1時点）');
    expect(screen.getByRole('img', { name: /（10\/1時点）$/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/未確認銘柄|未確認%|未取得/);
  });

  it('names an older long history without environment fields instead of a bare unknown', () => {
    const rows = breadth('2026-10-02').map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !ENVIRONMENT.includes(key))));
    show(trends({ rows, legacy: true }));
    for (const label of ['TT達成数', '200日線より上', 'ブレイクアウト成功率', 'RS90以上のTT達成（独自RS）']) expect(tile(label)).toHaveTextContent('未収録旧形式の長期集計 10/2');
    // 50日線 exists in every schema.
    expect(tile('50日線より上')).toHaveTextContent('43.0%観測200中86銘柄');
    expect(tile('52週の新高値・新安値')).toHaveTextContent('40・12');
    expect(screen.getByTestId('brief-stage-missing')).toHaveTextContent('ステージ構成は未収録（旧形式の長期集計 10/2）');
    for (const element of tiles()) expect(element.textContent).not.toMatch(bare);
  });

  it('separates a short breakout sample from a coverage gap and dates an older rate', () => {
    let view = show(trends({ rows: breadth('2026-10-02', (i, n) => (i === n - 1 ? { breakoutsJudged: 3, breakoutsHeld: 2 } : {})) }));
    expect(tile('ブレイクアウト成功率')).toHaveTextContent('75%（10/1時点）8件で判定・最新は3件（5件未満のため率は非表示）');
    view.unmount();
    view = show(trends({ rows: breadth('2026-10-02', () => ({ breakoutsJudged: 3, breakoutsHeld: 2 })) }));
    expect(tile('ブレイクアウト成功率')).toHaveTextContent('3件5件未満のため率は非表示');
    view.unmount();
    show(trends({ rows: breadth('2026-10-02', () => ({ breakoutsJudged: null, breakoutsHeld: null })) }));
    expect(tile('ブレイクアウト成功率')).toHaveTextContent('未算出判定期間に観測不足の日を含む');
  });

  it('says loading while the market series and the verdict load, never 未取得', () => {
    show({ loading: true, error: false, data: undefined }, { market: null, marketLoading: true });
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('判定を読み込み中…');
    expect(screen.queryByText(/新規の買いは控えます/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('市場推移を読み込み中…');
    for (const element of tiles()) expect(element).toHaveTextContent('読み込み中…');
    expect(screen.getByText('ステージ構成は読み込み中…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/未取得|未確認/);
  });

  it('reports an integrity failure with its reason instead of unknown values', () => {
    show({ loading: false, error: true, data: undefined, failureReason: new Error('市場推移の基準日が一致しません。') }, { detail: false });
    expect(screen.getByRole('alert')).toHaveTextContent('市場推移データの整合性を確認できません（市場推移の基準日が一致しません。）');
    for (const element of tiles()) expect(element).toHaveTextContent('確認できません整合性エラー');
    expect(document.body.textContent).not.toMatch(/未取得|0・0/);
  });

  it('keeps distribution days and follow-through usable when only the long history fails', () => {
    const value = trends({ history: false });
    value.data.long_history_error = '長期市場履歴: source retrieval date';
    show(value);
    expect(screen.getByRole('alert')).toHaveTextContent('長期集計の整合性を確認できません（長期市場履歴: source retrieval date）。分配日・フォロースルーデーは指数データから表示しています。');
    expect(tile('分配日（25日）')).toHaveTextContent('3・4');
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('確認 8/7');
    expect(tile('TT達成数')).toHaveTextContent('確認できません長期集計の整合性エラー');
  });

  it('shows the reason for an unavailable index instead of a bare unknown', () => {
    const value = trends();
    value.data.indices[1] = { symbol: '^IXIC', available: false, points: [], events: [], reason: '同じ基準日の出典付き指数履歴は未取得です。', followThrough: { available: false, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', reason: '同じ基準日の出典付き指数履歴は未取得です。' } };
    show(value);
    expect(tile('分配日（25日）')).toHaveTextContent('3・算出不可');
    expect(screen.getByText('NASの分配日：同じ基準日の出典付き指数履歴は未取得です。')).toBeInTheDocument();
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('算出不可同じ基準日の出典付き指数履歴は未取得です。');
  });

  it('keeps unknown values unknown when nothing is published, never 0', () => {
    render(<MemoryRouter><MarketCard market={{ state: 'unknown', label: '市場未確認', cap: 0 }} trends={{ data: null }} date="2026-10-02" /></MemoryRouter>);
    expect(screen.getByText('市場未確認')).toBeInTheDocument();
    expect(screen.getByText('市場推移データはこの公開に含まれていません。')).toBeInTheDocument();
    for (const element of tiles()) expect(element).toHaveTextContent('未配信市場推移データなし');
    expect(screen.queryByText(/^0・0$/)).toBeNull();
  });
});
