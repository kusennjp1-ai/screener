import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateFeedCard from './CandidateFeedCard';
import { assess, entryPlan } from '../researchEngine';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

afterEach(cleanup);
const row = withSyntheticFinancialProof({ symbol: 'FEED', company_name: 'Synthetic feed fixture', current_price: 102, se_pivot_price: 100 });
const growth = financialEvidencePresentation({ evidence: buildFinancialEvidencePresentation(row, { method: 'oneil', date, generation: 'feed-fixture', now }), symbol: row.symbol, date, generation: 'feed-fixture', method: 'oneil', now });
const assessment = assess(row, 'oneil', now);
const item = {
 row, assessment, plan: entryPlan(row, null, 'oneil'), volume: null,
 growth: growth.rows.slice(0, 2), annual: growth.rows.find(metric => metric.id === 'annual_eps_growth_3y'),
 selectionRules: assessment.rules,
 readiness: { ready: false, passed: 1, total: 3, failed: 1, unknown: 1, rules: [
  { id: 'selection', label: '共通購入モデルへの適合', state: 'pass' },
  { id: 'volume', label: '出来高', state: 'fail', detail: 'Long evidence belongs in the detail view' },
  { id: 'date', label: '最新の取引日', state: 'unknown' },
 ] },
};
const props = { item, date, onSelect: vi.fn(), onCompare: vi.fn(), onWatch: vi.fn(), onMove: vi.fn() };

it('presents a dated current state and the required annual gap before the actual growth conditions', () => {
 render(<CandidateFeedCard {...props}/>);
 const card = screen.getByRole('article');
 expect(card).toHaveAttribute('data-state-date', date);
 expect(card).toHaveTextContent(`${date} 終値時点`);
 expect(card).toHaveTextContent('現在の状態');
 expect(card).not.toHaveTextContent(/新規|新着|ブレイク当日|ステージ2|Code33/);
 const annual = card.querySelector('.decision-annual');
 expect(annual).toHaveTextContent('必須 年次EPS 未確認');
 expect(annual).toHaveAttribute('data-state', 'unknown');
 const metrics = card.querySelector('.feed-growth');
 expect(annual.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(metrics.closest('details')).toBeNull();
 for (const text of ['30%', '40%', '≥ 25%', '必須', '2026-06-30', '提供元あり', '取得 2026-10-03']) expect(metrics).toHaveTextContent(text);
});

it('visualizes the exact named condition counts without turning unknowns into failed or passed conditions', () => {
 render(<CandidateFeedCard {...props}/>);
 const card = screen.getByRole('article');
 const selection = card.querySelector('[data-check="selection"]');
 const daily = card.querySelector('[data-check="daily"]');
 expect(selection).toHaveTextContent(`選定条件 ${assessment.passed}/${assessment.total}`);
 for (const state of ['pass', 'fail', 'unknown']) {
  const count = state === 'pass' ? assessment.passed : state === 'fail' ? assessment.failed : assessment.unknown;
  expect(selection.querySelectorAll(`.feed-condition-strip [data-state="${state}"]`)).toHaveLength(count);
  expect(daily.querySelectorAll(`.feed-condition-strip [data-state="${state}"]`)).toHaveLength(1);
 }
 expect(daily).toHaveTextContent('日次確認 1/3');
 expect(daily).toHaveTextContent('未達 1 · 未確認 1');
 expect(card.querySelector('[data-check="price"]')).toHaveAttribute('data-state', 'pass');
 expect(daily).toHaveAttribute('data-state', 'fail');
});

it('offers one next blocker with every other named selected-method and daily blocker in a keyboard disclosure', () => {
 render(<CandidateFeedCard {...props}/>);
 const card = screen.getByRole('article');
 expect(card.querySelector('.feed-next-check')).toHaveTextContent('次に確認年次EPS：未確認');
 const disclosure = card.querySelector('.feed-other-checks');
 expect(disclosure).not.toHaveAttribute('open');
 expect(disclosure.querySelector('summary')).toHaveTextContent(`未達・未確認の内訳 ${assessment.failed + assessment.unknown + 2}条件`);
 const dailyDate = disclosure.querySelector('[data-rule-id="date"]');
 expect(dailyDate).toHaveTextContent('最新の取引日：未確認');
 expect(dailyDate).not.toBeVisible();
 const summary = disclosure.querySelector('summary');
 summary.focus();
 expect(summary).toHaveFocus();
 fireEvent.click(summary);
 expect(disclosure).toHaveAttribute('open');
 expect(dailyDate).toBeVisible();
 for (const rule of assessment.rules.filter(rule => rule.state !== 'pass')) expect(disclosure).toHaveTextContent(rule.label);
 expect(disclosure).toHaveTextContent('出来高：未達');
 expect(card).not.toHaveTextContent('Long evidence belongs in the detail view');
 expect(screen.getByRole('button', { name: /^FEED の分析/ })).toHaveAccessibleName(/最新の取引日：未確認/);
});

it('keeps the supplied dated SVG intact, shows measured chart context, and places sibling actions in the footer', () => {
 const trace = { status: 'available', src: 'price-traces/fixture/FEED.svg', asOfDate: date, caption: `終値 · 直近63日足 · 2026-07-07〜${date}` };
 const onSelect = vi.fn(), onWatch = vi.fn(), onCompare = vi.fn();
 const { rerender } = render(<CandidateFeedCard {...props} item={{ ...item, volume: 1.39, row: { ...row, priceTrace: trace } }} onSelect={onSelect} onWatch={onWatch} onCompare={onCompare}/>);
 const card = screen.getByRole('article'), chart = within(card).getByRole('img');
 expect(chart).toHaveAttribute('src', expect.stringContaining(trace.src));
 expect(chart).toHaveAttribute('loading', 'lazy');
 expect(card.querySelector('.feed-price-trace svg')).toBeNull();
 expect(card.querySelector('.feed-observed-metrics')).toHaveTextContent('日次出来高 1.39×');
 expect(card.querySelector('.feed-observed-metrics')).toHaveTextContent('ピボット $100.00');
 const footer = card.querySelector('footer');
 fireEvent.click(within(footer).getByRole('button', { name: 'FEED の財務・日次根拠を見る' }));
 fireEvent.click(within(footer).getByRole('button', { name: 'FEED のチャートを開く' }));
 fireEvent.click(within(footer).getByRole('button', { name: 'FEED ウォッチに保存' }));
 expect(onSelect).toHaveBeenCalledExactlyOnceWith('FEED');
 expect(onCompare).toHaveBeenCalledExactlyOnceWith('FEED');
 expect(onWatch).toHaveBeenCalledExactlyOnceWith('FEED');
 expect(card.querySelector('button button')).toBeNull();
 rerender(<CandidateFeedCard {...props} item={{ ...item, row: { ...row, priceTrace: { ...trace, asOfDate: '2026-01-01' } } }}/>);
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
 expect(card).toHaveTextContent('価格推移 未確認');
});
