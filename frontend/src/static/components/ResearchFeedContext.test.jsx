import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchFeedContext, { ResearchFeedNavigation } from './ResearchFeedContext';
import { researchFeedContext } from '../researchFeedContext';

afterEach(cleanup);
const items = [
  { row: { symbol: 'PASS', gics_sector: 'Financial Services' }, assessment: { qualified: true, failed: 0, unknown: 0 } },
  { row: { symbol: 'FAIL', gics_sector: 'Financial' }, assessment: { qualified: false, failed: 1, unknown: 2 } },
  { row: { symbol: 'UNKNOWN', gics_sector: 'Technology' }, assessment: { qualified: false, failed: 0, unknown: 2 } },
  { row: { symbol: 'MISSING' }, assessment: null },
];
it('counts the supplied canonical cohort without promoting missing conditions or inventing an industry score', () => {
  const before = JSON.stringify(items), result = researchFeedContext(items);
  expect(result).toMatchObject({ total: 4, passed: 1, failed: 1, unknown: 2 });
  expect(result.groups.find(group => group.key === 'Financial')).toMatchObject({ total: 2, passed: 1, unknown: 0 });
  expect(result.groups.find(group => group.key === 'Unknown')).toMatchObject({ label: '分類未確認', total: 1, unknown: 1 });
  expect(result.groups.every(group => !Object.hasOwn(group, 'score'))).toBe(true);
  expect(JSON.stringify(items)).toBe(before);
  expect(researchFeedContext(items.slice(2))).toMatchObject({ total: 2, passed: 0, failed: 0, unknown: 2 });
});
it('keeps unavailable event comparison distinct from zero events and offers a real sector filter', () => {
  const onSector = vi.fn();
  render(<MemoryRouter><ResearchFeedContext ranked={items} methodName="オニール" date="2026-10-02" onSector={onSector}/></MemoryRouter>);
  expect(screen.getByLabelText('現在の検索対象')).toHaveTextContent('オニール');
  expect(screen.getByLabelText('イベント比較の確認状況')).toHaveTextContent('新規発生の件数は未確認');
  expect(screen.getByLabelText('イベント比較の確認状況')).not.toHaveTextContent(/0件|新規発生 0/);
  fireEvent.click(screen.getByRole('button', { name: '金融：通過 1 / 対象 2銘柄・少数標本。業種で絞り込む' }));
  expect(onSector).toHaveBeenCalledWith('Financial');
  expect(screen.getByRole('link', { name: '市場全体の業種を見る →' })).toHaveAttribute('href', '/breadth?tab=sectors');
});
it('states empty and loading cohorts honestly', () => {
  const { rerender } = render(<MemoryRouter><ResearchFeedContext ranked={[]} methodName="IBD型" loading onSector={vi.fn()}/></MemoryRouter>);
  expect(screen.getByLabelText('現在の検索対象')).toHaveTextContent('—');
  expect(screen.getByLabelText('業種別の選定内訳')).toHaveTextContent('対象を確認中');
  rerender(<MemoryRouter><ResearchFeedContext ranked={[]} methodName="IBD型" date="2026-10-02" onSector={vi.fn()}/></MemoryRouter>);
  expect(screen.getByLabelText('業種別の選定内訳')).toHaveTextContent('表示対象がありません');
});
it('keeps local feed and watch actions separate from market/comparison routes', () => {
  const onBrowse = vi.fn(), onWatchFilter = vi.fn();
  render(<MemoryRouter><ResearchFeedNavigation detailOpen onlyWatch onBrowse={onBrowse} onWatchFilter={onWatchFilter}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'フィードへ戻る' }));
  fireEvent.click(screen.getByRole('button', { name: 'ウォッチ' }));
  expect(onBrowse).toHaveBeenCalledOnce();expect(onWatchFilter).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'ウォッチ' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('link', { name: 'チャート比較' })).toHaveAttribute('href', '/compare');
});
