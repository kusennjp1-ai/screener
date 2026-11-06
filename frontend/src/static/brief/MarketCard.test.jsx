import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketCard from './MarketCard';
import { MarketDetailCard, RegimeContext } from './MarketScreen';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attempt, breadth, closes, confirmed, days, failed, index, oldSchema, trends, UP } from '../../test/fixtures/marketTrends';
import reference from '../reference/market-regime-reference-v1.json' with { type: 'json' };
import { marketTabStudy } from '../reference/marketTabStudy.js';
import { followThroughDay } from '../followThroughDay';
import { exposureRuleText } from '../portfolioPlan';
import { num, signedPercent } from './marketTabModel';
import { indexState } from '../../../tools/export-market-trends.mjs';

/** Today's card, or with `detail` the market tab's (MarketScreen.jsx, the tab's lazy chunk). */
const Card = ({ detail = false, ...props }) => detail ? <MarketDetailCard {...props} /> : <MarketCard {...props} />;
/** The market tab's study parts as MarketScreen hands them to the card (Today passes none). */
const studyProps = (value, date, ref, wide, { market = null, manifest = null } = {}) => {
  const study = marketTabStudy({ trends: value, reference: ref, date, market, manifest });
  return { study, studyBlock: <RegimeContext context={study.regime} wide={wide} nasdaq={study.nasdaqPosition?.state ? study.nasdaqFigures : null} /> };
};
const show = (value, { date = '2026-10-02', detail = true, market = UP, marketLoading = false, onOpenMetric, ref = reference } = {}) => render(<MemoryRouter><Card market={market} marketLoading={marketLoading} trends={value} date={date} detail={detail} onOpenMetric={onOpenMetric} {...(detail ? studyProps(value, date, ref, true) : {})} /></MemoryRouter>);
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
    expect(screen.getByText(/^分配日・フォロースルーデー・ステージ・TT達成数・RS推計は公開日足からの独自集計で、IBDの公式値ではありません。注意サインの基準も独自判定です。$/)).toBeInTheDocument();
  });

  it('shows each row as a value, its one-month change and a status slot that is empty unless a rule fired', () => {
    show(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { trendTemplateCount: 25, rs90TemplateCount: 10, above200: 80, above200Percent: 40 } : {})) }));
    // The count names its population in the 200-day row's form (MK10).
    expect(tile('TT達成数')).toHaveTextContent(/^TT達成数30銘柄観測200中30\+5 1か月比⌄$/);
    expect(tile('200日線より上')).toHaveTextContent(/^200日線より上45\.0%\+5\.0pt 1か月比⌄$/);
    expect(tile('RS推計90以上のTT達成（独自）')).toHaveTextContent('8銘柄−2 1か月比');
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
    expect(tile('TT達成数')).toHaveTextContent('70銘柄観測200中70・1年で最高');
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
    // Breadth checks carry 〔参考〕 from the study reference and are counted apart with a neutral ○ (MK9); this index
    // series names no method, so its check has no tag. The rules and their thresholds are unchanged.
    expect(signals().querySelector('b')).toHaveTextContent(/^▲ 注意 1件・参考 3件（独自判定）$/);
    expect(signals()).toHaveClass('is-warn');
    expect(within(signals()).getAllByRole('listitem').map(li => li.textContent)).toEqual(['▲S&Pの分配日が25日間で6日', '○新安値（30）が新高値（10）を上回る〔参考〕', '○ステージ4（40%）がステージ2（20%）を上回る〔参考〕', '○ブレイクアウトの成功率が30%に低下〔参考〕']);
    expect(within(signals()).getAllByRole('listitem').map(li => li.className)).toEqual(['', 'is-reference', 'is-reference', 'is-reference']);
    // That the signs never move the guide is said once, in the guide's own disclosure (MK6).
    expect(signals()).not.toHaveTextContent('目安');
    expect(tile('分配日（25日）')).toHaveTextContent(/^▲注意分配日（25日）S&P6日▲注意：5日以上NAS4日⌄$/);
    expect(tile('52週の新高値・新安値')).toHaveTextContent(/^○参考52週の新高値・新安値新高値10新安値30○参考：新高値より多い/);
    expect(tile('52週の新高値・新安値')).not.toHaveClass('is-warn');
    expect(tile('ブレイクアウト成功率')).toHaveTextContent(/^○参考ブレイクアウト成功率30%10件で判定.*参考：40%未満/);
    expect(tile('ステージ構成')).toHaveTextContent('ステージ2 20%参考：ステージ4がステージ2より多い');
    expect(tile('50日線より上').querySelector('.brief-env-status')).toBeEmptyDOMElement();
    expect(group('指数のトレンド')).toHaveTextContent('▲ 注意 1');
    expect(group('市場の参加度')).toHaveTextContent('○ 参考 1');
    expect(group('市場の参加度')).not.toHaveTextContent('▲');
    expect(group('リーダーの健全性')).toHaveTextContent('○ 参考 2');
    expect(group('リーダーの健全性')).not.toHaveTextContent('▲');
  });

  it('summarises the index in four figures and says when its close disagrees with the verdict\'s scan input', () => {
    const sp500 = closes('2026-10-02', 260, 6000, -2);
    show(trends({ sp500 }));
    const stats = screen.getByRole('group', { name: 'S&P 500（長期履歴の^GSPC終値、10/2）' });
    // The 200-day distance is the 50-day cell's second line.
    expect(stats).toHaveTextContent('S&P 5005,482.0010/2終値1年高値から−8.4%50日線比−0.9%200日線比 −3.5%');
    // The verdict says SPY was above its 50-day line at the scan; the long history's ^GSPC close is not.
    expect(screen.getByText('判定の根拠はスキャン時点のSPY、この数値は長期履歴の^GSPC終値（10/2）です。50日線・200日線との位置が一致していません。')).toBeInTheDocument();
    // A confirmed FTD whose record carries no ftd event has no rally-low date: the ◆ only, no ○.
    // 260 closes: the 200-day line starts inside the 130-session window, so the label names its first day.
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線・200日線（\d+\/\d+〜）（2026-05-26〜2026-10-02）。有効な分配日 0日。FTD 8\/7。目盛り 5,482〜5,801$/ })).toBeInTheDocument();
  });

  it('shows one section at a time behind phone tabs that carry each group\'s ▲ count and move by arrow keys', () => {
    function Phone() {
      const [section, setSection] = useState('index');
      return <MemoryRouter><Card market={UP} trends={value} date="2026-10-02" detail switcher section={section} onSection={setSection}
        history={<section aria-label="市場環境の推移">long history</section>} /></MemoryRouter>;
    }
    // Six S&P distribution days fire an index warning; more new lows than highs is a 〔参考〕 sign, never a tab's ▲.
    const value = trends({ rows: breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {})) });
    value.data.indices[0] = index('^GSPC', '2026-10-02', 6, '2026-10-02', confirmed('2026-10-02'));
    render(<Phone />);
    const tablist = screen.getByRole('tablist', { name: '市場タブの表示' });
    const tabs = within(tablist).getAllByRole('tab');
    // No index history of a year, so 乖離 is unjudged: 参加度 carries the neutral 「?」.
    expect(tabs.map(tab => tab.textContent)).toEqual(['指数▲注意1', '参加度?未確認あり', 'リーダー', '推移']);
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    // Only the selected section is shown; the others stay in the document, hidden.
    expect(screen.getByRole('tabpanel', { name: '指数注意1' })).toContainElement(screen.getByRole('heading', { level: 3, name: '指数のトレンド' }));
    expect(screen.queryByRole('heading', { level: 3, name: '市場の参加度' })).toBeNull();
    expect(document.getElementById('brief-panel-breadth')).not.toBeVisible();
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '参加度未確認あり' })).toBeVisible();
    expect(document.getElementById('brief-panel-index')).not.toBeVisible();
    // Arrow keys move the selection and the focus; End and Home jump to the ends.
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: 'End' });
    expect(document.activeElement).toBe(tabs[3]);
    expect(screen.getByRole('region', { name: '市場環境の推移' })).toBeVisible();
    fireEvent.keyDown(tabs[3], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: 'Home' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // The verdict and the warning summary stay above the tabs whatever the section.
    expect(screen.getByTestId('brief-regime')).toBeVisible();
    expect(signals()).toBeVisible();
  });

  it('marks a section tab with a neutral 「?」 when it holds a value or check that is not confirmed', () => {
    const phone = (value, historyUnknown) => render(<MemoryRouter><Card market={UP} trends={value} date="2026-10-02" detail switcher section="index" onSection={() => {}}
      history={<section aria-label="市場環境の推移">long history</section>} historyUnknown={historyUnknown} /></MemoryRouter>);
    const names = () => within(screen.getByRole('tablist', { name: '市場タブの表示' })).getAllByRole('tab').map(tab => tab.textContent);
    // An older long-history schema: participation and leaders show 未収録 rows; the history awaits its update.
    phone(trends({ rows: oldSchema(breadth('2026-10-02')), sp500: closes('2026-10-02') }), '更新待ち');
    expect(names()).toEqual(['指数', '参加度?未確認あり', 'リーダー?未確認あり', '推移?更新待ち']);
    for (const mark of document.querySelectorAll('.brief-switch-gap')) expect(mark.querySelector('[aria-hidden="true"]')).toHaveTextContent('?');
    cleanup();
    // No long history at all: both of its groups are unavailable, never read as clean.
    phone(trends({ history: false }), '未確認');
    expect(names()).toEqual(['指数', '参加度?未確認あり', 'リーダー?未確認あり', '推移?未確認']);
    cleanup();
    // Everything confirmed (a year of index closes well below their high): no marks, labels on one line.
    phone(trends({ sp500: closes('2026-10-02', 260, 6000, -2) }), null);
    expect(names()).toEqual(['指数', '参加度', 'リーダー', '推移']);
    expect(document.querySelector('.brief-switch-marks')).toBeNull();
  });

  it('keeps the three groups side by side without tabs on the desktop, the source line in place and no 注記', () => {
    show(trends({ sp500: closes('2026-10-02') }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['指数のトレンド', '市場の参加度', 'リーダーの健全性']);
    expect(screen.getByText('4つの数値（終値・1年高値から・50日線比・200日線比）は長期履歴の^GSPC終値から計算しています。').closest('details')).toBeNull();
    expect(document.querySelector('.brief-index-source')).toHaveTextContent(/^4つの数値（終値・1年高値から・50日線比・200日線比）は長期履歴の\^GSPC終値から計算しています。$/);
    expect(document.querySelector('.brief-screen-notes')).toBeNull();
  });

  it('moves the plain source line into the 注記 behind the phone tabs', () => {
    render(<MemoryRouter><Card market={UP} trends={trends({ sp500: closes('2026-10-02') })} date="2026-10-02" detail switcher section="index" onSection={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('group', { name: /^S&P 500（長期履歴の\^GSPC終値/ })).toBeInTheDocument();
    expect(document.querySelector('.brief-index-source')).toBeNull();
    expect(document.querySelector('.brief-screen-notes')).toHaveTextContent('S&P 500の終値・1年高値からの位置・50日線比・200日線比は、長期履歴の^GSPC終値から計算しています。');
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

  it('says an older block in the heading\'s stamp slot on a phone, and the rest in the 注記', () => {
    render(<MemoryRouter><Card market={UP} trends={trends({ asOf: '2026-10-01', date: '2026-10-02' })} date="2026-10-02" detail switcher section="index" onSection={() => {}} /></MemoryRouter>);
    const note = screen.getByRole('note');
    expect(note).toHaveClass('brief-stamp');
    expect(note).toHaveTextContent(/^◷ 10\/1引け・10\/2分は再集計待ち$/);
    expect(document.querySelector('.brief-lag')).toBeNull();
    expect(document.querySelector('.brief-screen-notes')).toHaveTextContent('日付が異なる項目には個別に日付を付けています。');
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('判定 10/2');
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
    for (const label of ['TT達成数', '200日線より上', 'ブレイクアウト成功率', 'RS推計90以上のTT達成（独自）', 'リーダーの健全度', 'ステージ構成']) expect(tile(label)).toBeNull();
    expect(screen.getByTestId('brief-missing-breadth')).toHaveTextContent(/^旧形式の長期集計（10\/2）には未収録：200日線より上・TT達成数$/);
    expect(screen.getByTestId('brief-missing-leaders')).toHaveTextContent(/^旧形式の長期集計（10\/2）には未収録：RS推計90以上のTT達成（独自）・ブレイクアウト成功率・リーダーの健全度・ステージ構成$/);
    expect(tile('50日線より上')).toHaveTextContent('43.0%');
    expect(tile('先導株数（価格条件）')).toHaveTextContent('20銘柄');
    expect(signals()).toHaveTextContent('判定していない項目 5件：指数と個別株の乖離・TT達成数の急減・ステージ構成・リーダーの健全度・ブレイクアウト成功率（旧形式の長期集計に未収録）');
    expect(signals().querySelector('details')).toBeNull();
    for (const element of tiles()) expect(element.textContent).not.toMatch(bare);
  });

  it('names the unjudged checks on the phone\'s summary line and folds only their reasons', () => {
    const phone = rows => render(<MemoryRouter><Card market={UP} trends={trends({ rows })} date="2026-10-02" detail switcher section="index" onSection={() => {}} /></MemoryRouter>);
    phone(oldSchema(breadth('2026-10-02')));
    const fold = signals().querySelector('details');
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')).toHaveTextContent(/^判定していない項目 5件：指数と個別株の乖離・TT達成数の急減・ステージ構成・リーダーの健全度・ブレイクアウト成功率$/);
    expect(fold.querySelector('.brief-expander-body')).toHaveTextContent(/^理由：旧形式の長期集計に未収録$/);
    cleanup();
    // Two reasons: each with the checks it applies to.
    phone(breadth('2026-10-02', (i, n) => (i === n - 1 ? { leaderCohort: 4 } : {})));
    const two = signals().querySelector('details');
    expect(two.querySelector('summary')).toHaveTextContent(/^判定していない項目 2件：指数と個別株の乖離・リーダーの健全度$/);
    expect(two.querySelector('.brief-expander-body')).toHaveTextContent(/^理由：指数と個別株の乖離（指数の履歴が1年に満たない）／リーダーの健全度（最新は対象4銘柄（10銘柄未満））$/);
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
    expect(screen.getByText('地合いの判定・各集計・RS推計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。')).toBeInTheDocument();
  });

  it('marks a warning with ▲ and a word on the side that fired, and names a stand-in for an older schema', () => {
    const rows = oldSchema(breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 5, newLows: 9 } : {})));
    const value = trends({ rows, legacy: true });
    value.data.indices[0] = index('^GSPC', '2026-10-02', 5, '2026-10-02', undefined, true);
    show(value, { detail: false });
    expect(tiles().map(element => element.querySelector('small').textContent)).toEqual(['分配日（25日）', '先導株数（価格条件）', '50日線より上', '52週の新高値・新安値']);
    expect(tile('分配日（25日）')).toHaveTextContent('S&P▲注意 5日NAS4日注意：S&Pが5日以上');
    expect(tile('分配日（25日）')).toHaveClass('is-warn');
    // The new-lows rule is one the study could not confirm (〔参考〕 on the market tab): 参考 in the warning's place, never amber.
    expect(tile('52週の新高値・新安値')).toHaveTextContent(/^52週の新高値・新安値高5安9参考：新安値が新高値より多い$/);
    expect(tile('52週の新高値・新安値')).not.toHaveClass('is-warn');
    expect(tile('52週の新高値・新安値').querySelector('.is-warn, .brief-warnmark')).toBeNull();
    expect(tile('先導株数（価格条件）')).toHaveTextContent('20銘柄TT達成数は旧形式で未収録');
    expect(tile('50日線より上')).toHaveTextContent('43.0%200日線は旧形式で未収録');
  });

  it('marks the rules the study could not confirm 参考 with a neutral ○, as the market tab does, in the same sentences', () => {
    // TT達成数 fell 33% in 10 sessions and stage 4 outnumbers stage 2: deterioration notes; the index is near its high
    // while 45% are above the 200-day line: the split alert. Every one is a breadth rule the reference tags 〔参考〕.
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { trendTemplateCount: 20, stage1: 60, stage2: 40, stage3: 20, stage4: 80 } : {}), 260);
    show(trends({ rows, sp500: closes('2026-10-02') }), { detail: false });
    const notes = screen.getByRole('list', { name: '地合いの悪化サイン（独自判定）' });
    expect(within(notes).getAllByRole('listitem').map(li => [li.textContent, li.className])).toEqual([
      ['○ 参考：トレンドテンプレート達成数が10営業日で33%減少（独自判定）', 'is-reference'], ['○ 参考：ステージ4（40%）がステージ2（20%）を上回る（独自判定）', 'is-reference']]);
    expect(notes.textContent).not.toContain('▲');
    const split = screen.getByText(/指数と個別株が乖離しています/);
    expect(split).toHaveClass('brief-alert', 'is-reference');
    expect(split.textContent).toMatch(/^○ 参考：指数は1年高値の水準にありますが、200日線より上の銘柄は45\.0%。指数と個別株が乖離しています（独自判定）。$/);
    // The ○ is a mark only: a screen reader hears 「参考：」 in the ▲'s place.
    for (const node of [...notes.querySelectorAll('li > span:first-child'), split.querySelector('span')]) expect([node.textContent, node.getAttribute('aria-hidden')]).toEqual(['○', 'true']);
    expect(tile('TT達成数')).toHaveTextContent('参考：10日で20%以上減少');
    expect(tile('200日線より上')).toHaveTextContent('参考：指数と個別株の乖離');
    for (const label of ['TT達成数', '200日線より上']) expect(tile(label)).not.toHaveClass('is-warn');
    // The market tab marks the same rules 参考 (its study reference) on its rows: one marker for one rule on both screens.
    cleanup();
    show(trends({ rows, sp500: closes('2026-10-02') }));
    expect(tile('TT達成数').querySelector('.brief-env-status')).toHaveTextContent('○参考');
    expect(tile('200日線より上').querySelector('.brief-env-status')).toHaveTextContent('○参考');
  });

  it('dates an older long history and index on Today in one line', () => {
    show(trends({ asOf: '2026-10-01', date: '2026-10-02' }), { detail: false });
    expect(screen.getByRole('note')).toHaveTextContent(/^市場の集計は10\/1時点（10\/2分は再集計待ち）$/);
    // The note dates every tile of that one session: none repeats it.
    expect(tile('TT達成数')).toHaveTextContent(/^TT達成数30銘柄/);
    expect(document.querySelector('.brief-fact-asof')).toBeNull();
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
    render(<MemoryRouter><Card market={{ state: 'unknown', label: '市場未確認', cap: 0 }} trends={{ data: null }} date="2026-10-02" /></MemoryRouter>);
    expect(screen.getByText('市場未確認')).toBeInTheDocument();
    expect(screen.getByText('市場推移データはこの公開に含まれていません。')).toBeInTheDocument();
    for (const element of tiles()) expect(element).toHaveTextContent('未配信市場推移データなし');
    expect(screen.queryByText(/^0・0$/)).toBeNull();
  });
});

// ---- Track B: 過去の傾向, the study tags, the exposure basis, the index position ------------------------------
const DD = reference.methods.distribution, WINDOW = reference.methods.followThroughWindowSessions;
/** An index series of the study's window of sessions ending on its newest point (the exporter's points are its validated bars). */
const sessionsOf = item => { const last = item.points.at(-1); return { ...item, points: [...days(last.date, WINDOW).slice(0, -1).map(date => ({ date, value: last.value, distribution: false, reason: null })), last] }; };
const withMethods = value => { value.data.indices = value.data.indices.map(item => sessionsOf({ ...item, method: DD })); return value; };
const phone = (value, { market = UP, date = '2026-10-02' } = {}) => render(<MemoryRouter><Card market={market} trends={value} date={date} detail switcher section="index" onSection={() => {}} {...studyProps(value, date, reference, false)} /></MemoryRouter>);
const regime = () => document.querySelector('details.brief-regime-ref');
const BANNED = /上がりやすい|下がりやすい|安全|底打ち|オールクリア|今日の確率/;

describe('brief market card: the market-regime study and its honesty rules', () => {
  it('spans 過去の傾向 across the card under the columns, open on the desktop, never in the verdict or the warning summary', () => {
    show(withMethods(trends({ sp500: closes('2026-10-02', 300, 5000, 2) })));
    const fold = regime();
    expect(fold).toHaveAttribute('open');
    // The summary says what the confirmed lines say (MK5), wrapping only between its 「・」 parts.
    expect(fold.querySelector(':scope > summary')).toHaveTextContent(/^過去の傾向：下げが多かった状態 \d+・少なかった状態 \d+（1990〜2026年）$/);
    expect([...fold.querySelectorAll(':scope > summary .brief-frag')].map(part => part.textContent)).toEqual([expect.stringMatching(/^過去の傾向：下げが多かった状態 \d+・$/), expect.stringMatching(/^少なかった状態 \d+（1990〜2026年）$/)]);
    // On the desktop it sits under the three columns, spanning the card (MK5).
    expect(group('指数のトレンド')).not.toContainElement(fold);
    expect(fold.previousElementSibling).toHaveClass('brief-env-groups');
    expect(screen.getByTestId('brief-regime')).not.toContainElement(fold);
    expect(signals().textContent).not.toMatch(/過去の傾向|全期間|21日以内/);
    expect([...fold.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['S&P 500', 'Nasdaq総合']);
    // A steady rise: above both lines and within 5% of the high.
    // A confirmed line says which way its share differs from its comparator.
    expect([...fold.querySelectorAll('li')].map(li => li.textContent).slice(0, 2)).toEqual(['50日線・200日線の上（10/2時点）：21営業日以内に5%以上下げた割合 10%（全期間 16%より少ない）〔S&P・Nasdaqとも〕', '1年高値から5%以内（10/2時点・境界まで5.0%）：11%（5%超の下 29%より少ない）〔S&P・Nasdaqとも〕']);
    // A comparator and each tag are kept whole on a line.
    expect([...fold.querySelector('li').querySelectorAll('.brief-regime-keep')].map(span => span.textContent)).toEqual(['（全期間 16%より少ない）', '〔S&P・Nasdaqとも〕']);
    // The key and the source are a nested 「読み方と出典」 fold, open on the desktop, that says the lines are no forecast.
    const howto = fold.querySelector('details.brief-regime-howto');
    expect(howto).toHaveAttribute('open');
    expect(howto.querySelector('summary')).toHaveTextContent(/^読み方と出典（予測ではありません）$/);
    expect(howto).toHaveTextContent('状態ごとの過去の割合で、組み合わせた確率ではありません。');
    expect(howto).toHaveTextContent('指数の結果で、個別銘柄の値ではありません。出典：market-regime-study-v2（CI run 41844557380）、^GSPC・^IXIC日足 1990-01-02〜2026-11-03');
  });

  it('keeps the fold closed on a phone, at one summary line', () => {
    phone(withMethods(trends({ sp500: closes('2026-10-02', 300, 5000, 2) })));
    expect(regime()).not.toHaveAttribute('open');
    expect(regime().querySelectorAll(':scope > summary')).toHaveLength(1);
    expect(regime().querySelector('li')).not.toBeVisible();
  });

  it('says why the block has no rows when there is no reference, and never invents one', () => {
    show(trends(), { ref: null });
    expect(regime()).toHaveTextContent('過去の傾向（予測ではありません）検証結果の参照データを確認できないため表示しません。');
    expect(regime().querySelectorAll('li')).toHaveLength(0);
    expect(signals().textContent).not.toMatch(/〔/);
  });

  it('tags the fired checks from the reference, keys 〔参考〕 on a phone and explains the tags in full on the desktop', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {}));
    const make = () => { const value = trends({ rows }); value.data.indices = [index('^GSPC', '2026-10-02', 6, '2026-10-02', failed('2026-10-02')), index('^IXIC', '2026-10-02', 5, '2026-10-02', failed('2026-10-02'))].map(item => sessionsOf({ ...item, method: DD })); return value; };
    show(make());
    // Each fired distribution count carries its graded bucket's tag (MK2): 6 and 5 days are the 5–6 bucket.
    expect(within(signals()).getAllByRole('listitem').map(li => li.textContent)).toEqual(['▲S&Pの分配日が25日間で6日〔未確立〕', '▲NASの分配日が25日間で5日〔未確立〕', '▲S&PのFTDが失敗（10/2）〔S&Pのみ〕〔偏り〕', '▲NASのFTDが失敗（10/2）〔未確立〕', '○新安値（30）が新高値（10）を上回る〔参考〕']);
    expect(signals().querySelector('b')).toHaveTextContent(/^▲ 注意 4件・参考 1件（独自判定）$/);
    expect(signals().querySelector('.brief-signals-tags')).toHaveTextContent(/^〔参考〕は、2021〜2026年の参加度データ（現在の銘柄で過去をさかのぼった集計・上場廃止銘柄を含まない）の検証で/);
    // Every tag shown is defined in the sentence.
    for (const tag of ['〔S&Pのみ〕', '〔未確立〕', '〔偏り〕']) expect(signals().querySelector('.brief-signals-tags').textContent).toContain(`${tag}は`);
    cleanup();
    phone(make());
    expect(signals().querySelector('.brief-signals-tags')).toHaveTextContent(/^〔参考〕＝2021〜26年の検証で関係未確認$/);
    expect(document.querySelector('.brief-screen-notes')).toHaveTextContent('注意サインの印：〔参考〕は、2021〜2026年の参加度データ');
    cleanup();
    // No 〔参考〕 tag shown, no legend.
    const value = make(); value.data.long_history.breadth = breadth('2026-10-02');
    phone(value);
    expect(signals().querySelector('.brief-signals-tags')).toBeNull();
  });

  it('prints the exposure guide\'s basis from MARKET_CAPS: one line on the desktop, a fold under the meter on a phone', () => {
    show(trends());
    const verdict = screen.getByTestId('brief-regime');
    expect(verdict.querySelector('p.brief-exposure-basis')).toHaveTextContent(exposureRuleText());
    expect(verdict.querySelector('.brief-exposure-nasdaq')).toHaveTextContent('判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は反発3日目（FTD未確認・独自判定）。');
    // The phone's order on the desktop too: the verdict's basis, the Nasdaq note, then how the guide is set.
    expect([...verdict.querySelectorAll('.brief-verdict-why, .brief-exposure-nasdaq, p.brief-exposure-basis')].map(p => p.className)).toEqual(['brief-verdict-why', 'brief-exposure-nasdaq', 'brief-exposure-basis']);
    cleanup();
    phone(trends());
    const fold = screen.getByTestId('brief-regime').querySelector('details.brief-exposure-basis');
    // The Nasdaq note applies (positive verdict, Nasdaq on a rally attempt): the summary names the fold and its short form.
    expect(fold.querySelector('summary')).toHaveTextContent(/^目安と判定の基準・Nasdaqは反発3日目（判定はSPYのみ）$/);
    expect([...fold.querySelectorAll('p')].map(p => p.textContent)).toEqual(['根拠（10/2スキャン時点）：S&P 500（SPY）が50日線・200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」',
      '判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は反発3日目（FTD未確認・独自判定）。', exposureRuleText()]);
    expect(fold).not.toHaveAttribute('open');
    cleanup();
    // A confirmed Nasdaq, or a verdict that is not positive: no Nasdaq note, the plain summary.
    phone(trends({ follow: [confirmed('2026-10-02'), confirmed('2026-10-02')] }));
    expect(screen.getByTestId('brief-regime').querySelector('details.brief-exposure-basis summary')).toHaveTextContent(/^目安と判定の基準$/);
    cleanup();
    phone(trends(), { market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(screen.getByTestId('brief-regime')).not.toHaveTextContent('Nasdaq');
    expect(screen.getByTestId('brief-regime').querySelector('details.brief-exposure-basis')).toHaveTextContent(exposureRuleText());
  });

  it('opens the 分配日 row on the method and each index\'s active days', () => {
    const value = trends();
    value.data.indices[0] = { ...value.data.indices[0], events: [{ date: '2026-09-14', state: 'active', ageSessions: 19 }, { date: '2026-09-22', state: 'active', ageSessions: 9 }, { date: '2026-09-30', state: 'active', ageSessions: 2 }] };
    show(value);
    fireEvent.click(toggle('分配日（25日）'));
    const panel = document.getElementById(toggle('分配日（25日）').getAttribute('aria-controls'));
    expect([...panel.querySelectorAll('p')].map(p => p.textContent).slice(0, 3)).toEqual(['下の分配日は^GSPC/^IXICの別集計（ストーリング日なし・5日以上で注意）', 'S&P：9/14・9/22・9/30（最も古い日はあと6営業日で失効・後日の高値で早く除外される場合あり）', 'NAS：有効な分配日の日付を確認できません']);
  });

  it('says the breadth groups are today\'s names traced back: under their headers on the desktop, in the 注記 on a phone', () => {
    show(trends());
    for (const name of ['市場の参加度', 'リーダーの健全性']) expect(group(name).querySelector('.brief-env-caveat')).toHaveTextContent('現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）');
    expect(group('指数のトレンド').querySelector('.brief-env-caveat')).toBeNull();
    cleanup();
    phone(trends());
    expect(document.querySelector('.brief-env-caveat')).toBeNull();
    expect(document.querySelector('.brief-screen-notes')).toHaveTextContent('参加度・リーダーの値は、現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）です。');
  });

  it('shows the 200-day line on the market tab\'s chart only, and the Nasdaq row only from a published state', () => {
    show(trends({ sp500: closes('2026-10-02', 300) }));
    expect(document.querySelector('.brief-index .brief-index-ma200')).not.toBeNull();
    expect(document.querySelector('.brief-index-nas')).toBeNull();
    cleanup();
    show(trends({ sp500: closes('2026-10-02', 300) }), { detail: false });
    expect(document.querySelector('.brief-index-ma200')).toBeNull();
    cleanup();
    const value = trends({ sp500: closes('2026-10-02', 300) });
    value.data.indices[1].state = { date: '2026-10-02', close: 18234.56, vs50: 1.24, vs200: null, fromHigh: -2.1, fullYear: true };
    show(value);
    expect(document.querySelector('.brief-index-nas')).toHaveTextContent('Nasdaq総合18,234.5610/2終値・1年高値から −2.1%・50日線比 +1.2%・200日線比 未算出');
    expect(document.querySelector('.brief-regime-nas')).toBeNull();
    cleanup();
    // A phone keeps the screen's budget: the figures are the first line of the Nasdaq block inside 過去の傾向.
    phone(value);
    expect(document.querySelector('.brief-index-nas')).toBeNull();
    const nasdaq = [...regime().querySelectorAll('.brief-regime-index')].at(-1);
    expect(nasdaq.querySelector('h4 + .brief-regime-nas')).toHaveTextContent('18,234.5610/2終値・1年高値から −2.1%・50日線比 +1.2%・200日線比 未算出');
    expect(regime().querySelectorAll('.brief-regime-nas')).toHaveLength(1);
  });

  it('marks the rally low the FTD confirmed, not a later pullback\'s low, from real follow-through output', () => {
    // A decline of 10% to a low, a rally attempt, an FTD on its 4th day, new highs, then a 4% pullback: still confirmed.
    const dates = days('2026-10-02', 120), bars = [];
    let close = 5000;
    dates.forEach((date, i) => {
      const before = close;
      close = i < 60 ? 5000 + i * 1000 / 59 : i < 80 ? 6000 - (i - 59) * 30 : i === 80 ? close * 1.003 : i === 81 ? close * 1.002 : i === 82 ? close * 1.001 : i === 83 ? close * 1.016 : i < 110 ? close * 1.006 : close * 0.996;
      const open = i ? before : close;
      bars.push({ date, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * (i > 79 && i < 84 ? 0.9995 : 0.999), close, volume: i === 83 ? 2e9 : 1e9 });
    });
    const ft = followThroughDay({ symbol: '^GSPC', bars, asOfDate: '2026-10-02' });
    expect(ft).toMatchObject({ state: 'confirmed', ftd: { date: dates[83] } });
    // The record's own low is the pullback's, after the FTD; the FTD event keeps the rally low.
    expect(ft.low.date > ft.ftd.date).toBe(true);
    expect(ft.events.find(e => e.type === 'ftd')).toMatchObject({ date: dates[83], lowDate: dates[79] });
    const value = trends({ sp500: bars.map(bar => ({ date: bar.date, close: bar.close })), follow: [ft, attempt('2026-10-02')] });
    show(value);
    const md = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線/ })).toHaveAttribute('aria-label', expect.stringContaining(`FTD ${md(dates[83])}、反発の安値 ${md(dates[79])}`));
    const low = document.querySelector('.brief-index-mark.is-low'), x = i => 4 + i * 592 / 119;
    expect(low.style.left).toBe(`${(100 * x(79) / 600).toFixed(2)}%`);
  });

  it('says a failed FTD failed on its ◆, draws no ○ without the FTD\'s own low, and puts a label near the top under its ◆', () => {
    show(trends({ sp500: closes('2026-10-02', 300), follow: [failed('2026-10-02'), attempt('2026-10-02')] }));
    const mark = document.querySelector('.brief-index-mark.is-ftd');
    expect(mark).toHaveTextContent('◆FTD 8/7（失敗 10/2）');
    expect(mark).toHaveClass('is-failed');
    expect(document.querySelector('.brief-index-mark.is-low')).toBeNull();
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線/ }).getAttribute('aria-label')).toMatch(/。FTD 8\/7（失敗 10\/2）。目盛り/);
    expect(document.querySelector('.brief-index-legend .is-ftd')).toHaveTextContent('◆ FTD（失敗）');
    cleanup();
    // An FTD on the window's high: the label goes under the ◆, inside the frame.
    const late = { ...confirmed('2026-10-02'), ftd: { ...confirmed('2026-10-02').ftd, date: '2026-10-01' } };
    show(trends({ sp500: closes('2026-10-02', 300), follow: [late, attempt('2026-10-02')] }));
    expect(document.querySelector('.brief-index-mark.is-ftd')).toHaveClass('is-below');
    expect(document.querySelector('.brief-index-mark.is-ftd')).not.toHaveClass('is-failed');
  });

  it('keys exactly the tags 過去の傾向 shows', () => {
    const value = withMethods(trends({ sp500: closes('2026-10-02', 300, 6000, -3) }));
    value.data.indices[1].state = { date: '2026-10-02', close: 18000, vs50: -2, vs200: -1, fromHigh: -9, fullYear: true };
    show(value);
    const shown = new Set([...regime().querySelectorAll('li .brief-regime-keep')].map(span => span.textContent).filter(text => text.startsWith('〔')));
    const key = regime().querySelector('.brief-regime-key').textContent;
    expect(shown.size).toBeGreaterThan(2);
    expect(new Set(key.match(/〔[^〕]+〕(?=＝)/g))).toEqual(shown);
    expect(key).toMatch(/^割合は、その日の終値から21営業日以内に終値で5%以上下げた日の割合です。全期間は、その項目を判定できた全営業日での割合です。/);
    expect(regime().querySelector('.brief-regime-key + .brief-regime-foot')).toHaveTextContent('この欄は下げの割合だけを示し、平均リターンが低かった状態はどちらの指数にもありません。');
  });

  it('keeps the 50-day cell as narrow as a value without 200 closes: a dash, the words read out and the reason in the 注記', () => {
    phone(trends({ sp500: closes('2026-10-02', 150) }));
    const cell = document.querySelector('.brief-index-stats .is-ma');
    expect(cell.querySelector('span:not(.sr-only)')).toHaveTextContent(/^200日線比 —$/);
    expect(cell.querySelector('span:not(.sr-only)')).toHaveAttribute('aria-hidden', 'true');
    expect(cell.querySelector('.sr-only')).toHaveTextContent(/^200日線比 未算出（200日分の終値なし）$/);
    expect(document.querySelector('.brief-screen-notes')).toHaveTextContent('200日線比は、長期履歴に200日分の終値がないため未算出です。');
    cleanup();
    phone(trends({ sp500: closes('2026-10-02', 300) }));
    expect(document.querySelector('.brief-index-stats .is-ma .sr-only')).toBeNull();
    expect(document.querySelector('.brief-screen-notes')).not.toHaveTextContent('200日分の終値がないため');
  });

  it('shows no study part on Today, which never loads the study', () => {
    show(withMethods(trends({ sp500: closes('2026-10-02', 300) })), { detail: false });
    expect(regime()).toBeNull();
    expect(document.body.textContent).not.toMatch(/〔|過去の傾向|21営業日/);
    // Today's modules import none of the study's code or data (the market tab's lazy chunk holds it).
    for (const file of ['src/static/brief/MarketCard.jsx', 'src/static/brief/marketTabModel.js']) expect(readFileSync(resolve(file), 'utf8')).not.toMatch(/from '[^']*(marketTabStudy|marketRegimeReference|market-regime-reference)/);
  });

  it('uses none of the banned words anywhere on the market card or in its sources', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30, stage4: 80 } : {}));
    const variants = [trends(), withMethods(trends({ rows, sp500: closes('2026-10-02', 300, 6000, -3) })), trends({ rows: oldSchema(breadth('2026-10-02')), legacy: true }), trends({ history: false }), trends({ asOf: '2026-10-01', date: '2026-10-02' })];
    for (const value of variants) for (const mode of ['desktop', 'phone', 'today']) {
      if (mode === 'phone') phone(value); else show(value, { detail: mode === 'desktop' });
      for (const details of document.querySelectorAll('details')) details.open = true;
      expect(document.body.textContent).not.toMatch(BANNED);
      cleanup();
    }
    for (const file of ['src/static/brief/MarketCard.jsx', 'src/static/brief/marketTabModel.js', 'src/static/brief/MarketScreen.jsx', 'src/static/brief/MarketSectors.jsx', 'src/static/brief/briefEnvironment.js',
      'src/static/reference/marketRegimeReference.js', 'src/static/reference/marketTabStudy.js', 'src/static/reference/market-regime-reference-v1.json']) expect(`${file}: ${readFileSync(resolve(file), 'utf8')}`).not.toMatch(BANNED);
    expect(exposureRuleText()).not.toMatch(BANNED);
  });
});

// ---- Round 2 (market track): the switch, the judge side's cause, one disclosure, the scale and year-line labels -------
describe('brief market card: round 2', () => {
  const nasCloses = (n = 280) => days('2026-10-02', n).map((date, i) => ({ date, close: 16000 + i * 10 - (i > n - 20 ? (i - n + 20) * 60 : 0) }));
  // The exporter's own position on the same closes (indexState, its producer), so the figures describe the line drawn.
  const withCloses = (n = 280) => { const value = trends({ sp500: closes('2026-10-02', 300) }); const nas = nasCloses(n); value.data.indices[1] = { ...value.data.indices[1], closes: nas, state: indexState(nas, '2026-10-02') }; return value; };
  const switcher = () => screen.queryByRole('group', { name: '表示する指数' });
  const md = day => day.slice(5).split('-').map(Number).join('/');

  it('switches the 指数 panel between the S&P 500 and the Nasdaq, one index at a time, only with the Nasdaq\'s closes', () => {
    show(withCloses());
    const buttons = within(switcher()).getAllByRole('button');
    expect(buttons.map(button => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([['S&P 500', 'true'], ['Nasdaq総合', 'false']]);
    expect(screen.getByRole('group', { name: /^S&P 500（長期履歴の\^GSPC終値、10\/2）$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線・200日線/ })).toBeInTheDocument();
    // The Nasdaq's figures live in the switch now, never as a row beside the S&P's.
    expect(document.querySelector('.brief-index-nas')).toBeNull();
    fireEvent.click(buttons[1]);
    expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    const stats = screen.getByRole('group', { name: 'Nasdaq総合（^IXICの日足、10/2）' });
    const state = withCloses().data.indices[1].state;
    expect(stats).toHaveTextContent(`Nasdaq総合${num(state.close, 2)}10/2終値1年高値から${signedPercent(state.fromHigh)}50日線比${signedPercent(state.vs50)}200日線比 ${signedPercent(state.vs200)}`);
    expect(screen.queryByRole('group', { name: /^S&P 500（/ })).toBeNull();
    // Its own line, its 200-day line (280 closes: it starts inside the 130-session window, on the 200th close, and the
    // legend and the label name that day), its own distribution days and its own rally low (its record's ○).
    const from200 = md(nasCloses()[199].date);
    const chart = screen.getByRole('img', { name: new RegExp(`^Nasdaq総合 の終値と50日線・200日線（${from200}〜）（2026-05-26〜2026-10-02）。有効な分配日 0日。反発の安値 9/29。目盛り [\\d,]+〜[\\d,]+$`) });
    expect(chart.querySelector('.brief-index-ma200')).not.toBeNull();
    expect(document.querySelector('.brief-index-legend .is-close')).toHaveTextContent(/^Nasdaq総合 終値（5\/26〜10\/2）$/);
    expect(document.querySelector('.brief-index-legend .is-ma')).toHaveTextContent(/^50日線$/);
    expect(document.querySelector('.brief-index-legend .is-ma200')).toHaveTextContent(`200日線（${from200}〜）`);
    expect(document.querySelector('.brief-index-source')).toHaveTextContent('Nasdaq総合の4つの数値と線は、分配日と同じ^IXICの日足（公開データ）から計算しています。');
    // An S&P disagreement is about the S&P's figures: it is not said under the Nasdaq's.
    expect(document.querySelector('.brief-index-source.is-conflict')).toBeNull();
    cleanup();
    sessionStorage.clear();
    // Too few closes for the chart, or an older publication: no switch, the S&P as before.
    for (const value of [withCloses(59), trends({ sp500: closes('2026-10-02', 300) })]) {
      show(value);
      expect(switcher()).toBeNull();
      expect(screen.getByRole('img', { name: /^S&P 500 の終値/ })).toBeInTheDocument();
      cleanup();
    }
  });

  it('says the published Nasdaq position\'s missing distances as 未算出, never 0', () => {
    // 150 closes: the exporter's position has its 50-day distance, but no 200-day one and no full year.
    const value = withCloses(150);
    expect(value.data.indices[1].state).toMatchObject({ vs200: null, fromHigh: null, fullYear: false });
    show(value);
    fireEvent.click(within(switcher()).getByRole('button', { name: 'Nasdaq総合' }));
    const stats = screen.getByRole('group', { name: /^Nasdaq総合（/ });
    expect(stats).toHaveTextContent('期間内高値から—未算出');
    expect(stats).toHaveTextContent('200日線比 —200日線比 未算出（200日分の終値なし）');
    expect(stats.textContent).not.toMatch(/[−+]0\.0%/);
  });

  it('says why an FTD-upgraded uptrend keeps the guide at 0%: inside 目安と判定の基準 on a phone, in place on the desktop', () => {
    const market = { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'confirmed_uptrend', ftdUpgraded: true };
    const manifest = { as_of_date: '2026-10-02', markets: { US: { as_of_date: '2026-10-02', market_context: { as_of_date: '2026-10-02', regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: '2026-09-18', ftd_days_since: 10, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' } } } };
    // The regime's FTD is SPY's (9/18); the tab's own ^GSPC record of the day confirmed one on 8/7: each is attributed.
    const LINE = '局面判定はSPYのFTD（9/18）による上昇トレンド。^GSPCの日足ではFTD 8/7。この目安はSPYが50日線の下のため0%（独自判定）';
    render(<MemoryRouter><Card market={market} trends={trends()} date="2026-10-02" detail switcher section="index" onSection={() => {}} {...studyProps(trends(), '2026-10-02', reference, false, { market, manifest })} /></MemoryRouter>);
    const fold = screen.getByTestId('brief-regime').querySelector('details.brief-exposure-basis');
    expect([...fold.querySelectorAll('p')].map(p => p.textContent)).toEqual(['根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下', LINE, exposureRuleText()]);
    expect(fold).not.toHaveAttribute('open');
    // The label, the meter and the cap are unchanged.
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('50日線割れ（弱含み・独自判定）');
    expect(screen.getByTestId('brief-regime').querySelector('.brief-exposure b')).toHaveTextContent(/^0%$/);
    cleanup();
    render(<MemoryRouter><Card market={market} trends={trends()} date="2026-10-02" detail {...studyProps(trends(), '2026-10-02', reference, true, { market, manifest })} /></MemoryRouter>);
    expect([...screen.getByTestId('brief-regime').querySelectorAll('.brief-verdict-why')].map(p => p.textContent)).toEqual(['根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下', LINE]);
    cleanup();
    // Today's card never shows it (Today never loads the study that reads the manifest).
    render(<MemoryRouter><Card market={market} trends={trends()} date="2026-10-02" /></MemoryRouter>);
    expect(document.body).not.toHaveTextContent('局面判定は');
  });

  it('puts a phone\'s switch beside the 指数 heading, in the marks\' slot, and drops the names the pressed button already says', () => {
    sessionStorage.clear();
    phone(withCloses());
    const group = screen.getByRole('group', { name: '表示する指数' });
    const head = document.querySelector('.brief-env-group.is-index > .brief-env-head');
    expect(head).toHaveClass('has-control');
    expect(group.parentElement).toBe(head);
    // Short labels on the 44px targets, each read out whole (its visible label inside its name).
    expect(within(group).getAllByRole('button').map(b => [b.textContent, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])).toEqual([['S&P', 'S&P 500', 'true'], ['NAS', 'Nasdaq総合（NAS）', 'false']]);
    // The question keeps its line while the group has no marks or date of its own.
    expect(head.querySelector('.brief-env-title > span')).toHaveTextContent('上昇トレンドは続いているか');
    // The figures' first label reads 終値 and the legend has no name of its own; the labels keep the full names.
    const stats = screen.getByRole('group', { name: /^S&P 500（長期履歴の\^GSPC終値、10\/2）$/ });
    expect(stats.querySelector(':scope > div:first-child small')).toHaveTextContent(/^終値$/);
    expect(stats.querySelector(':scope > div:first-child span')).toHaveTextContent(/^10\/2$/);
    expect(document.querySelector('.brief-index-legend .is-close')).toBeNull();
    expect(screen.getByRole('img', { name: /^S&P 500 の終値と50日線・200日線/ })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: /Nasdaq総合/ }));
    expect(screen.getByRole('group', { name: 'Nasdaq総合（^IXICの日足、10/2）' }).querySelector(':scope > div:first-child small')).toHaveTextContent(/^終値$/);
    expect(screen.getByRole('img', { name: /^Nasdaq総合 の終値と/ })).toBeInTheDocument();
    cleanup();
    sessionStorage.clear();
    // A group with marks or a date of its own: they take the question's line under the heading, the date still names the group.
    const older = withCloses();
    older.data.indices[0] = index('^GSPC', '2026-10-02', 6, '2026-10-02', confirmed('2026-10-02'));
    phone(older);
    const marked = document.querySelector('.brief-env-group.is-index > .brief-env-head');
    expect(marked.querySelector('.brief-env-title > .brief-env-meta.is-inline')).toHaveTextContent('▲ 注意 1');
    expect(marked.querySelector('.brief-env-title > span:not(.brief-env-meta)')).toBeNull();
    expect(marked.querySelector(':scope > .brief-env-meta')).toBeNull();
    cleanup();
    sessionStorage.clear();
    // Without the Nasdaq's closes: no switch, the head, the figures and the legend as before.
    phone(trends({ sp500: closes('2026-10-02', 300) }));
    expect(switcher()).toBeNull();
    expect(document.querySelector('.brief-env-group.is-index > .brief-env-head')).not.toHaveClass('has-control');
    expect(screen.getByRole('group', { name: /^S&P 500（/ }).querySelector(':scope > div:first-child small')).toHaveTextContent(/^S&P 500$/);
    expect(document.querySelector('.brief-index-legend .is-close')).toHaveTextContent(/^S&P 500 終値/);
  });

  it('never reads 注意 0件 or 注意サインなし from 参考 checks alone: with the index checks unjudged the warnings are 判定不可', () => {
    // The index series are unavailable while the long history is valid: only the breadth and leader checks are judged, and
    // under the committed reference every one of them is 〔参考〕, so none can raise a warning.
    const unavailable = value => { value.data.indices = value.data.indices.map(item => ({ ...item, available: false, points: [], latest: null, lastObserved: null, followThrough: { available: false, method: item.followThrough?.method ?? null, reason: 'OHLCV欠測' } })); return value; };
    show(unavailable(trends()));
    expect(signals().querySelector(':scope > b')).toHaveTextContent(/^注意サインを判定できません（独自判定）$/);
    expect(signals()).toHaveTextContent('判定していない項目');
    cleanup();
    show(unavailable(trends({ rows: breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {})) })));
    expect(signals().querySelector(':scope > b')).toHaveTextContent(/^注意 判定不可・参考 1件（独自判定）$/);
    expect(signals().textContent).not.toMatch(/注意 0件|注意サインなし/);
    cleanup();
    // With an index check judged, the same 参考 sign reads beside a real 0件.
    show(trends({ rows: breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {})) }));
    expect(signals().querySelector(':scope > b')).toHaveTextContent(/^注意 0件・参考 1件（独自判定）$/);
  });

  it('says why the switch is missing when the reader withdrew the Nasdaq\'s closes, and whom TT達成数 counts only beside its value', () => {
    const value = trends({ sp500: closes('2026-10-02', 300) });
    value.data.indices[1] = { ...value.data.indices[1], closes_error: '指数の終値の形式を確認できません。' };
    phone(value);
    expect(switcher()).toBeNull();
    const notes = () => document.querySelector('.brief-screen-notes')?.textContent || '';
    for (const summary of document.querySelectorAll('.brief-screen-notes summary')) fireEvent.click(summary);
    expect(notes()).toContain('Nasdaq総合の終値は形式を確認できないため、指数の切替を表示しません。');
    // Said once on the screen, in the 注記, beside a TT達成数 row that shows a value; never in the opened row as well.
    const population = () => (document.body.textContent.match(/TT達成数は長期集計の値で/g) || []).length;
    expect(population()).toBe(1);
    // The row sits in the (hidden) 参加度 panel of this fixed-section harness: opened in place.
    fireEvent.click(tile('TT達成数').querySelector('.brief-env-toggle'));
    expect(tile('TT達成数').querySelector('.brief-env-detail')).toHaveTextContent('観測');
    expect(population()).toBe(1);
    cleanup();
    // An older long-history schema (先導株数 stands in for TT達成数) or no long history: the sentence is not said at all.
    for (const other of [trends({ rows: oldSchema(breadth('2026-10-02')) }), trends({ history: false })]) {
      phone(other);
      for (const summary of document.querySelectorAll('.brief-screen-notes summary')) fireEvent.click(summary);
      expect(population()).toBe(0);
      expect(document.body.textContent).not.toContain('指数の切替を表示しません');
      cleanup();
    }
  });

  it('notes an expired Nasdaq rally attempt as a correction in the guide\'s fold, while the verdict is positive', () => {
    const value = trends();
    value.data.indices[1] = { ...value.data.indices[1], followThrough: { ...attempt('2026-10-02'), state: 'attempt_expired' } };
    phone(value);
    expect(screen.getByTestId('brief-regime').querySelector('details.brief-exposure-basis > summary')).toHaveTextContent(/^目安と判定の基準・Nasdaqは調整中（判定はSPYのみ）$/);
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('Nasdaq総合は調整中・15日以内のFTDなし（独自判定）。');
    cleanup();
    // Under a 0% guide the note is not said (the verdict reads SPY only, and it is not positive).
    phone(value, { market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(screen.getByTestId('brief-regime')).not.toHaveTextContent('Nasdaq');
  });

  it('says the disclosure that signs never move the guide exactly once on the market tab, with warnings and the study', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {}));
    const value = trends({ rows });
    value.data.indices[0] = index('^GSPC', '2026-10-02', 6, '2026-10-02', confirmed('2026-10-02'));
    const count = () => (document.body.textContent.match(/目安を変え/g) || []).length;
    show(value);
    expect(count()).toBe(1);
    expect(screen.getByTestId('brief-regime')).toHaveTextContent('注意サインも指数の過去の傾向も目安を変えません。');
    cleanup();
    phone(value);
    for (const summary of document.querySelectorAll('summary')) fireEvent.click(summary);
    expect(count()).toBe(1);
  });

  it('labels each opened year line by its index and its scale, at the caption\'s own words', () => {
    const value = trends();
    for (const item of value.data.indices) item.points = days('2026-10-02', 260).map((date, i) => ({ date, value: i % 4, distribution: false, reason: null }));
    value.data.indices[0].events = []; value.data.indices[1].events = [];
    show(value);
    fireEvent.click(toggle('分配日（25日）'));
    const captions = [...document.querySelectorAll('.brief-env-detail .brief-yearline p')].map(p => p.textContent);
    expect(captions).toEqual(['S&P　1年の最低 0日・最高 3日', 'NAS　1年の最低 0日・最高 3日']);
    cleanup();
    // A row with one line keeps its caption without a name.
    show(trends({ rows: breadth('2026-10-02', (i, n) => ({ trendTemplateCount: 20 + (i % 40), ...(i === n - 1 ? { trendTemplateCount: 70 } : {}) }), 260) }));
    fireEvent.click(toggle('TT達成数'));
    expect(document.querySelector('.brief-env-detail .brief-yearline p')).toHaveTextContent(/^1年の最低 20・最高 70$/);
  });

  it('writes a negative scale label with U+2212, never the ASCII hyphen', () => {
    show(trends({ sp500: days('2026-10-02', 130).map((date, i) => ({ date, close: -200 + i })) }));
    const labels = [...document.querySelectorAll('.brief-index-scale')].map(node => node.textContent);
    expect(labels).toEqual(['−71', '−200']);
    expect(labels.join('')).not.toMatch(/-\d/);
  });
});
