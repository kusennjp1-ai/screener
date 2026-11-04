import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketCard from './MarketCard';
import { attempt, breadth, closes, confirmed, index, oldSchema, trends, UP } from '../../test/fixtures/marketTrends';

const show = (value, { date = '2026-10-02', detail = true, market = UP, marketLoading = false, onOpenMetric } = {}) => render(<MemoryRouter><MarketCard market={market} marketLoading={marketLoading} trends={value} date={date} detail={detail} onOpenMetric={onOpenMetric} /></MemoryRouter>);
const tiles = () => [...document.querySelectorAll('.brief-fact')];
const tile = label => tiles().find(element => element.querySelector('small').textContent === label) || null;
const toggle = label => within(tile(label)).getAllByRole('button')[0];
const bare = /未取得|未確認|NaN|undefined|null/;
const group = name => screen.getByRole('group', { name: new RegExp(`^${name}`) });
const signals = () => screen.getByRole('group', { name: '注意サイン（独自判定）' });

describe('brief market card: market tab', () => {
  it('leads with the verdict, its exposure guide and basis, dated once when current', () => {
    show(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { trendTemplateCount: 25, rs90TemplateCount: 10, above200: 80, above200Percent: 40 } : {})) }));
    expect(screen.getByRole('heading', { level: 2 }).parentElement).toHaveTextContent('地合い◷ 10/2 引け');
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('上昇トレンド（独自判定）新規の買いを検討できます。エクスポージャーの目安最大 50%');
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('根拠（10/2スキャン時点）：S&P 500（SPY）が50日線・200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」');
    expect(signals()).toHaveTextContent(/^注意サインなし（独自判定）判定していない項目 1件：指数と個別株の乖離（指数の履歴が1年に満たない）$/);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['指数のトレンド', '市場の参加度', 'リーダーの健全性']);
    expect(screen.queryByRole('note')).toBeNull();
    expect(document.querySelector('.brief-fact-asof')).toBeNull();
    expect(screen.getByText(/独自集計で、IBDの公式値ではありません。注意サインの基準もこのアプリの独自判定です。/)).toBeInTheDocument();
  });

  it('shows each row as a value, its one-month change and a status slot that is empty unless a rule fired', () => {
    show(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { trendTemplateCount: 25, rs90TemplateCount: 10, above200: 80, above200Percent: 40 } : {})) }));
    expect(tile('TT達成数')).toHaveTextContent(/^TT達成数30銘柄\+5 1か月比⌄$/);
    expect(tile('200日線より上')).toHaveTextContent(/^200日線より上45\.0%\+5\.0pt 1か月比⌄$/);
    expect(tile('RS90以上のTT達成（独自RS）')).toHaveTextContent('8銘柄−2 1か月比');
    expect(tile('ブレイクアウト成功率')).toHaveTextContent('75%8件で判定');
    expect(tile('リーダーの健全度')).toHaveTextContent('70%20営業日前のTT達成30銘柄が対象');
    expect(tile('52週の新高値・新安値')).toHaveTextContent('新高値40新安値12');
    const [spx, ndx] = tile('フォロースルーデー（独自判定）').querySelectorAll('.brief-ftd-row');
    expect(spx).toHaveTextContent('S&P確認 8/7+1.4%・反発4日目・FTD後の有効な分配日2');
    expect(ndx).toHaveTextContent('NAS反発3日目安値9/29・4日目以降の+1.2%上昇待ち');
    expect(tile('分配日（25日）')).toHaveTextContent('S&P3日NAS4日');
    for (const element of tiles()) {
      expect(element.textContent).not.toMatch(bare);
      expect(element.querySelector('.brief-env-status')).toBeEmptyDOMElement();
    }
    expect(screen.getByRole('img', { name: /^ステージ構成 ステージ1 25\.0%、ステージ2 35\.0%、ステージ3 20\.0%、ステージ4 20\.0%$/ })).toBeInTheDocument();
    // The stage legend names each stage.
    expect(tile('ステージ構成')).toHaveTextContent('1 底固め 25%2 上昇 35%3 天井圏 20%4 下降 20%');
  });

  it('opens a row to its details, its rule and a link that opens the metric in the long history', () => {
    const onOpenMetric = vi.fn();
    show(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { above200: 80, above200Percent: 40 } : {})) }), { onOpenMetric });
    const button = toggle('200日線より上');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('観測200中90銘柄・1か月前 40.0%');
    expect(panel).toHaveTextContent('基準終値が200日線より上の銘柄の割合（観測できた銘柄のうち）。S&P 500が1年高値から5%以内なのに50%未満のとき「指数と個別株の乖離」で注意サインです。');
    fireEvent.click(within(panel).getByRole('button', { name: '市場環境の推移で見る' }));
    expect(onOpenMetric).toHaveBeenCalledWith('movingAverages');
    fireEvent.click(button);
    expect(panel).not.toBeVisible();
  });

  it('draws a row\'s last year when it has one, and its labelled scale only once opened', () => {
    const rows = breadth('2026-10-02', (i, n) => ({ trendTemplateCount: 20 + (i % 40), ...(i === n - 1 ? { trendTemplateCount: 70 } : {}) }), 260);
    show(trends({ rows }));
    expect(tile('TT達成数')).toHaveTextContent('70銘柄1年で最高');
    expect(tile('TT達成数').querySelector('svg.brief-env-spark')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img', { name: /TT達成数の直近1年の推移/ })).toBeNull();
    fireEvent.click(toggle('TT達成数'));
    expect(screen.getByRole('img', { name: 'TT達成数の直近1年の推移。最低 20、最高 70、最新 70' })).toBeInTheDocument();
  });

  it('names each fired warning in a sentence under the verdict, beside its value and on its group', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30, stage1: 40, stage2: 40, stage4: 80, breakoutsJudged: 10, breakoutsHeld: 3 } : {}));
    const value = trends({ rows });
    value.data.indices[0] = index('^GSPC', '2026-10-02', 6, '2026-10-02', confirmed('2026-10-02'));
    show(value);
    expect(signals()).toHaveTextContent('注意サイン 4件（独自判定）');
    expect(within(signals()).getAllByRole('listitem').map(li => li.textContent)).toEqual(['▲S&Pの分配日が25日間で6日', '▲新安値（30）が新高値（10）を上回る', '▲ステージ4（40%）がステージ2（20%）を上回る', '▲ブレイクアウトの成功率が30%に低下']);
    expect(signals()).toHaveTextContent('注意サインは判定とは別の確認項目で、エクスポージャーの目安は変えません。');
    expect(tile('分配日（25日）')).toHaveTextContent(/^▲注意分配日（25日）S&P6日▲注意：5日以上NAS4日⌄$/);
    expect(tile('52週の新高値・新安値')).toHaveTextContent('新安値30▲注意：新高値より多い');
    expect(tile('ブレイクアウト成功率')).toHaveTextContent(/^▲注意ブレイクアウト成功率30%10件で判定.*注意：40%未満/);
    expect(tile('ステージ構成')).toHaveTextContent('ステージ2 20%注意：ステージ4がステージ2より多い');
    expect(tile('50日線より上').querySelector('.brief-env-status')).toBeEmptyDOMElement();
    expect(group('指数のトレンド')).toHaveTextContent('▲ 注意 1');
    expect(group('市場の参加度')).toHaveTextContent('▲ 注意 1');
    expect(group('リーダーの健全性')).toHaveTextContent('▲ 注意 2');
  });

  it('summarises the index in three figures and says when its close disagrees with the verdict\'s scan input', () => {
    const sp500 = closes('2026-10-02', 260, 6000, -2);
    show(trends({ sp500 }));
    const stats = screen.getByRole('group', { name: 'S&P 500（長期履歴の^GSPC終値、10/2）' });
    expect(stats).toHaveTextContent('S&P 5005,482.0010/2終値1年高値から−8.4%50日線比−0.9%');
    // The verdict says SPY was above its 50-day line at the scan; the long history's ^GSPC close is not.
    expect(screen.getByText('判定の根拠はスキャン時点のSPY、この数値は長期履歴の^GSPC終値（10/2）です。50日線・200日線との位置が一致していません。')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線（2026-05-26〜2026-10-02）。有効な分配日 0日$/ })).toBeInTheDocument();
  });

  it('jumps from the phone navigation to a group heading and moves focus there', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show(trends());
    const nav = screen.getByRole('navigation', { name: '市場タブ内の移動' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['指数', '参加度', 'リーダー', '推移']);
    fireEvent.click(within(nav).getByRole('button', { name: '参加度' }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toHaveTextContent('市場の参加度');
    delete Element.prototype.scrollIntoView;
  });

  it('dates an older block once, tags the verdict with its own date, and dates rows only where they differ', () => {
    show(trends({ asOf: '2026-10-01', date: '2026-10-02' }));
    expect(screen.getByRole('note')).toHaveTextContent(/^市場データは10\/1引け時点（分析基準日10\/2の再集計待ち）。日付が異なる項目には個別に日付を付けています。$/);
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('判定 10/2');
    for (const name of ['指数のトレンド', '市場の参加度', 'リーダーの健全性']) expect(screen.getByRole('group', { name: `${name} 10/1時点の値` })).toBeInTheDocument();
    expect(document.querySelector('.brief-fact-asof')).toBeNull();
    expect(signals()).toHaveTextContent('注意サインなし（10/1時点・独自判定）');
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('確認 8/7');
    expect(screen.getByRole('img', { name: /ステージ構成 .*（10\/1時点）$/ })).toBeInTheDocument();
  });

  it('names the one index whose count is older instead of dating the block', () => {
    const value = trends();
    value.data.indices[1] = index('^IXIC', '2026-10-01', 4, '2026-10-02', attempt('2026-10-01'));
    show(value);
    expect(screen.getByRole('group', { name: '指数のトレンド' })).toBeInTheDocument();
    expect(tile('分配日（25日）')).toHaveTextContent('S&P3日NAS4日（10/1時点）');
    expect(screen.getByRole('note')).toHaveTextContent('分配日・FTDはNAS 10/1引け時点（分析基準日10/2の再集計待ち）');
    expect(tile('フォロースルーデー（独自判定）').querySelectorAll('.brief-fact-asof')).toHaveLength(1);
  });

  it('names what an older long-history schema never recorded once per group, and what it could not judge', () => {
    show(trends({ rows: oldSchema(breadth('2026-10-02')) }));
    for (const label of ['TT達成数', '200日線より上', 'ブレイクアウト成功率', 'RS90以上のTT達成（独自RS）', 'リーダーの健全度', 'ステージ構成']) expect(tile(label)).toBeNull();
    expect(screen.getByTestId('brief-missing-breadth')).toHaveTextContent(/^旧形式の長期集計（10\/2）には未収録：200日線より上・TT達成数$/);
    expect(screen.getByTestId('brief-missing-leaders')).toHaveTextContent(/^旧形式の長期集計（10\/2）には未収録：RS90以上のTT達成（独自RS）・ブレイクアウト成功率・リーダーの健全度・ステージ構成$/);
    expect(tile('50日線より上')).toHaveTextContent('43.0%');
    expect(tile('先導株数（価格条件）')).toHaveTextContent('20銘柄');
    expect(signals()).toHaveTextContent('判定していない項目 5件：指数と個別株の乖離・TT達成数の急減・ステージ構成・リーダーの健全度・ブレイクアウト成功率（旧形式の長期集計に未収録）');
    for (const element of tiles()) expect(element.textContent).not.toMatch(bare);
  });

  it('says loading once per group while the series and the verdict load, never 未取得', () => {
    show({ loading: true, error: false, data: undefined }, { market: null, marketLoading: true });
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('判定を読み込み中…');
    expect(screen.getByRole('status')).toHaveTextContent('市場推移を読み込み中…');
    for (const name of ['指数のトレンド', '市場の参加度', 'リーダーの健全性']) expect(group(name)).toHaveTextContent(/読み込み中…$/);
    expect(tiles()).toHaveLength(0);
    expect(screen.queryByRole('group', { name: '注意サイン（独自判定）' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/未取得|未確認|新規の買いは控えます/);
  });

  it('calls a missing series file a delivery failure, without its path or hash', () => {
    const hex = '9ec644adcb9a10278d3cb10e893f3cf01ac8161a58df769c9466965cecc85046';
    show({ loading: false, error: true, data: undefined, failureReason: new Error(`Failed to load static data: market-trends/series-${hex}.json (404)`) });
    expect(screen.getByRole('alert')).toHaveTextContent(/^市場推移データを取得できません（配信ファイルが見つかりません）。数値は表示しません。$/);
    expect(screen.getByRole('alert')).toHaveAttribute('data-failure', 'fetch');
    for (const name of ['指数のトレンド', '市場の参加度', 'リーダーの健全性']) expect(group(name)).toHaveTextContent('市場推移データを取得できないため表示しません。');
    expect(document.body.textContent).not.toMatch(/整合性|series-|[a-f0-9]{16}|Failed/);
  });

  it('keeps distribution days and follow-through usable when only the long history fails', () => {
    const value = trends({ history: false });
    // The sentence readMarketTrends sets when validateLongHistory rejects only the long history.
    value.data.long_history_error = '長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 取得日時）。';
    value.data.long_history_error_key = 'source retrieval date';
    show(value);
    // The English validator key is kept for diagnosis only, never in the visible sentence.
    expect(screen.getByRole('alert')).toHaveAttribute('data-check', 'source retrieval date');
    expect(screen.getByRole('alert')).toHaveTextContent(/^長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 取得日時）。分配日・フォロースルーデーは指数データから表示しています。$/);
    expect(screen.getByText('指数の履歴は長期集計の整合性を確認できないため表示しません。')).toBeInTheDocument();
    expect(tile('分配日（25日）')).toHaveTextContent('S&P3日NAS4日');
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('確認 8/7');
    expect(group('市場の参加度')).toHaveTextContent('長期集計の整合性を確認できないため表示しません。');
    expect(signals()).toHaveTextContent(/^注意サインなし（独自判定）長期集計がないため、分配日とFTDだけを判定しています。$/);
  });

  const unavailable = symbol => ({ symbol, available: false, points: [], events: [], reason: '同じ基準日の出典付き指数履歴は未取得です。',
    followThrough: { available: false, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', reason: '同じ基準日の出典付き指数履歴は未取得です。' } });

  it('never reads 注意サインなし when no check could be judged', () => {
    const value = trends({ history: false });
    value.data.long_history = null;
    value.data.indices = [unavailable('^GSPC'), unavailable('^IXIC')];
    const view = show(value);
    expect(signals()).toHaveTextContent(/^注意サインを判定できません（独自判定）長期集計がないため、市場の参加度とリーダーの健全性も判定していません。判定していない項目 4件：S&Pの分配日・NASの分配日・S&PのFTD・NASのFTD（指数データを確認できません）$/);
    expect(signals()).not.toHaveTextContent('注意サインなし');
    expect(signals()).not.toHaveTextContent('分配日とFTDだけ');
    view.unmount();
    // One index judged, the other not: the scope names only what was judged, and the rest keep their reason.
    const partly = trends({ history: false });
    partly.data.indices[1] = unavailable('^IXIC');
    show(partly);
    expect(signals()).toHaveTextContent(/^注意サインなし（独自判定）長期集計がないため、S&Pの分配日・S&PのFTDだけを判定しています。判定していない項目 2件：NASの分配日・NASのFTD（指数データを確認できません）$/);
  });

  it('says 判定できません when a history is present but no check was judged', () => {
    const value = trends({ rows: [] });
    value.data.indices = [unavailable('^GSPC'), unavailable('^IXIC')];
    show(value);
    expect(signals()).toHaveTextContent(/^注意サインを判定できません（独自判定）判定していない項目 10件：/);
    expect(signals()).not.toHaveTextContent('注意サインなし');
  });

  it('shows the reason for an unavailable index instead of a bare unknown', () => {
    const value = trends();
    value.data.indices[1] = { symbol: '^IXIC', available: false, points: [], events: [], reason: '同じ基準日の出典付き指数履歴は未取得です。', followThrough: { available: false, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', reason: '同じ基準日の出典付き指数履歴は未取得です。' } };
    show(value);
    expect(tile('分配日（25日）')).toHaveTextContent('S&P3日NAS算出不可同じ基準日の出典付き指数履歴は未取得です。');
    expect(tile('フォロースルーデー（独自判定）')).toHaveTextContent('算出不可同じ基準日の出典付き指数履歴は未取得です。');
  });
});

describe('brief market card: Today', () => {
  it('keeps the four buy-or-wait facts and links to the market tab for the rest', () => {
    show(trends(), { detail: false });
    expect(tiles().map(element => element.querySelector('small').textContent)).toEqual(['分配日（25日）', 'TT達成数', '200日線より上', '52週の新高値・新安値']);
    expect(tile('分配日（25日）')).toHaveTextContent(/^分配日（25日）S&P3日NAS4日5日以上で注意$/);
    expect(tile('TT達成数')).toHaveTextContent('30銘柄');
    expect(tile('52週の新高値・新安値')).toHaveTextContent('高40安12差 +28');
    expect(screen.queryByText(/フォロースルーデー/)).toBeNull();
    expect(screen.queryByRole('img', { name: /ステージ構成/ })).toBeNull();
    expect(screen.queryByRole('group', { name: '注意サイン（独自判定）' })).toBeNull();
    expect(screen.getByRole('link', { name: /市場の詳細/ })).toHaveAttribute('href', '/brief/market');
    // Today's rows show RS推計, so Today's card names the RS as the app's own, not IBD's.
    expect(screen.getByText('地合いの判定・各集計・RSは公開日足からの独自判定・独自集計で、IBDの公式値ではありません。')).toBeInTheDocument();
  });

  it('marks a warning with ▲ and a word on the side that fired, and names a stand-in for an older schema', () => {
    const rows = oldSchema(breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 5, newLows: 9 } : {})));
    const value = trends({ rows, legacy: true });
    value.data.indices[0] = index('^GSPC', '2026-10-02', 5, '2026-10-02', undefined, true);
    show(value, { detail: false });
    expect(tiles().map(element => element.querySelector('small').textContent)).toEqual(['分配日（25日）', '先導株数（価格条件）', '50日線より上', '52週の新高値・新安値']);
    expect(tile('分配日（25日）')).toHaveTextContent('S&P▲注意 5日NAS4日注意：S&Pが5日以上');
    expect(tile('52週の新高値・新安値')).toHaveTextContent('高5安▲注意 9注意：新安値が新高値より多い');
    expect(tile('先導株数（価格条件）')).toHaveTextContent('20銘柄TT達成数は旧形式で未収録');
    expect(tile('50日線より上')).toHaveTextContent('43.0%200日線は旧形式で未収録');
  });

  it('keeps the original as-of note for an older long history and index', () => {
    show(trends({ asOf: '2026-10-01', date: '2026-10-02' }), { detail: false });
    expect(screen.getByRole('note')).toHaveTextContent('長期集計は 2026-10-01 時点・分配日は 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）');
    expect(tile('TT達成数')).toHaveTextContent('30銘柄（10/1時点）');
    expect(tile('分配日（25日）')).toHaveTextContent('（10/1時点）');
  });

  it('reports a reader failure with its own sentence instead of unknown values', () => {
    show({ loading: false, error: true, data: undefined, failureReason: new Error('市場推移の基準日が一致しません。') }, { detail: false });
    expect(screen.getByRole('alert')).toHaveTextContent(/^市場推移の基準日が一致しません。数値は表示しません。$/);
    for (const element of tiles()) expect(element).toHaveTextContent('確認できません整合性エラー');
    expect(document.body.textContent).not.toMatch(/未取得|0・0|。）/);
  });

  it('calls an offline phone a network failure, and a failed manifest never 未配信', () => {
    const view = show({ loading: false, error: true, data: undefined, failureReason: new TypeError('Failed to fetch') }, { detail: false });
    expect(screen.getByRole('alert')).toHaveTextContent('市場推移データを取得できません（通信エラー）。');
    expect(tile('TT達成数')).toHaveTextContent('取得できません通信エラー');
    expect(document.body.textContent).not.toMatch(/整合性|Failed/);
    view.unmount();
    show({ loading: false, error: true, data: undefined, failureKind: 'manifest' }, { detail: false });
    expect(screen.getByRole('alert')).toHaveTextContent('市場推移データを取得できません（公開情報を読み込めません）。');
    for (const element of tiles()) expect(element).toHaveTextContent(/取得できません公開情報エラー$/);
    expect(document.body.textContent).not.toMatch(/未配信|含まれていません/);
  });

  it('keeps unknown values unknown when nothing is published, never 0', () => {
    render(<MemoryRouter><MarketCard market={{ state: 'unknown', label: '市場未確認', cap: 0 }} trends={{ data: null }} date="2026-10-02" /></MemoryRouter>);
    expect(screen.getByText('市場未確認')).toBeInTheDocument();
    expect(screen.getByText('市場推移データはこの公開に含まれていません。')).toBeInTheDocument();
    for (const element of tiles()) expect(element).toHaveTextContent('未配信市場推移データなし');
    expect(screen.queryByText(/^0・0$/)).toBeNull();
  });
});
