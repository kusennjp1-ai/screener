import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ResearchFreshnessNotice from './ResearchFreshnessNotice';
afterEach(cleanup);

it('states the actual price date and calendar age without suggesting the publication refreshed prices', () => {
  render(<ResearchFreshnessNotice date="2026-10-02" freshness={{state:'old',days:4}}/>);
  const warning=screen.getByRole('alert',{name:'分析データの鮮度'});
  expect(warning).toHaveTextContent('分析基準日 2026-10-02（米国東部で4暦日前）。');
  expect(warning).toHaveTextContent('更新日時と価格の基準日は別です。');
  expect(warning).toBeVisible();
});

it.each([['unknown',null,'未確認'],['future','2099-12-31','2099-12-31']])('keeps the %s date caution explicit', (state,date,expected) => {
  render(<ResearchFreshnessNotice date={date} freshness={{state,days:null}}/>);
  expect(screen.getByRole('alert')).toHaveTextContent(`分析基準日 ${expected}：未確認、または未来の日付です。`);
  expect(screen.getByRole('alert')).toHaveTextContent('更新日時と価格の基準日は別です。');
});
