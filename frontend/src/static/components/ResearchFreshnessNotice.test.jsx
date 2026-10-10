import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
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

const stalePublication = { publicationStale:true, generatedAt:'2026-10-04T04:49:09Z', checkedAt:Date.parse('2026-10-10T12:00:00Z') };

it('renders nothing when both clocks are current', () => {
  render(<ResearchFreshnessNotice date="2026-10-09" freshness={{state:'recent',days:1}}/>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['recent','old','unknown','future'])('keeps one publication warning with a %s price date and explicit source-clock meaning', state => {
  const date=state==='unknown'?null:state==='future'?'2099-12-31':'2026-10-02';
  render(<ResearchFreshnessNotice date={date} freshness={{state,days:8}} {...stalePublication}/>);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const summary=document.querySelector('summary');
  expect(summary).toBeVisible();
  expect(summary).toHaveTextContent(`分析基準日 ${date || '未確認'}`);
  expect(summary).toHaveTextContent('公開データ要確認');
  expect(summary).toHaveTextContent('詳細');
  const warning=screen.getByRole('alert');
  expect(warning).toHaveTextContent('公開データの鮮度を確認してください。選定とチャートは日次データです。');
  expect(warning).toHaveTextContent('更新日時と価格の基準日は別です。');
  expect(warning).toHaveTextContent('公開生成時刻をもとに鮮度を再確認してください。');
  expect(warning).toHaveTextContent('2026-10-04T04:49:09.000Z');
  expect(warning).toHaveTextContent('2026-10-10T12:00:00.000Z');
  expect(warning).toHaveTextContent('公開・確認時刻は、価格や財務資料の取得時刻を更新しません。');
  expect(warning).toHaveTextContent('財務資料の期限切れ・未確認は合格に数えません。');
});

it('uses a native disclosure that opens and closes without losing the warning', async () => {
  const user=userEvent.setup();
  render(<ResearchFreshnessNotice date="2026-10-02" freshness={{state:'old',days:8}} {...stalePublication}/>);
  const summary=document.querySelector('summary'), details=summary.parentElement;
  expect(summary).toBe(details.firstElementChild);
  // Native summary keyboard activation is covered by Playwright, not jsdom.
  expect(details).not.toHaveAttribute('open');
  await user.click(summary);expect(details).toHaveAttribute('open');
  expect(screen.getByText('公開生成時刻（UTC）')).toBeVisible();
  await user.click(summary);expect(details).not.toHaveAttribute('open');
  expect(summary).toBeVisible();
});

it('does not invent a timestamp for missing or invalid publication and check clocks', () => {
  render(<ResearchFreshnessNotice date={null} freshness={{state:'unknown',days:null}} publicationStale generatedAt="invalid" checkedAt={NaN}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('公開生成時刻を確認できません。');
  expect(screen.getByRole('alert')).not.toHaveTextContent('96時間を超過');
  expect(document.querySelectorAll('time')).toHaveLength(0);
});

it('displays legacy exporter timestamps as UTC without changing the supplied stale decision', () => {
  render(<ResearchFreshnessNotice date="2026-10-02" freshness={{state:'old',days:8}} {...stalePublication} generatedAt="2026-10-04T04:49:09"/>);
  const publication=document.querySelector('time');
  expect(publication).toHaveAttribute('datetime','2026-10-04T04:49:09.000Z');
  expect(publication).toHaveTextContent('2026-10-04T04:49:09.000Z');
});

it('replaces publication evidence when the generation changes and preserves an old price date', () => {
  const props={date:'2026-10-02',freshness:{state:'old',days:8}};
  const view=render(<ResearchFreshnessNotice {...props} {...stalePublication}/>);
  view.rerender(<ResearchFreshnessNotice {...props} publicationStale={false} generatedAt="2026-10-10T12:00:00Z" checkedAt={stalePublication.checkedAt}/>);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('分析基準日 2026-10-02（米国東部で8暦日前）。');
  expect(screen.getByRole('alert')).not.toHaveTextContent('公開データ要確認');
  expect(screen.getByRole('alert')).not.toHaveTextContent('2026-10-04T04:49:09');
});

it('keeps disclosure evidence in flow with full-width keyboard and mobile targets', () => {
  const css=readFileSync('src/static/components/researchFreshness.css','utf8');
  expect(css).toMatch(/summary \{[^}]*min-height:26px/);
  expect(css).toMatch(/@media \(max-width:700px\) \{\s*\.research-freshness-combined summary \{ min-height:44px/);
  expect(css).toMatch(/@media \(pointer:coarse\) \{\s*\.research-freshness-combined summary \{ min-height:44px/);
  expect(css).toMatch(/summary:focus-visible \{ outline:2px/);
  expect(css).not.toMatch(/(?:overflow:\s*hidden|text-overflow:\s*ellipsis|line-clamp|position:\s*absolute)/);
});
