import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ResearchFreshnessNotice from './ResearchFreshnessNotice';

afterEach(cleanup);
it('keeps publication and price age distinct in one visible warning and retains both full explanations',()=>{
 render(<ResearchFreshnessNotice stale freshness={{state:'old',days:9}} date="2026-10-02" generatedAt="2026-10-03T12:00:00Z"/>);
 const alert=screen.getByRole('alert'),summary=alert.querySelector('summary');
 expect(screen.getAllByRole('alert')).toHaveLength(1);
 expect(summary).toHaveTextContent('公開 2026-10-03 12:00 UTC · 要再確認');
 expect(summary).toHaveTextContent('価格 2026-10-02（9暦日前）');
 expect(summary.closest('details')).not.toHaveAttribute('open');
 fireEvent.click(summary);
 expect(summary.closest('details')).toHaveAttribute('open');
 expect(within(alert).getByText(/公開データの鮮度を確認してください/)).toBeVisible();
 expect(within(alert).getByText(/更新日時と価格の基準日は別です/)).toBeVisible();
 expect(within(alert).getByText(/財務の提供元・取得時刻は各指標/)).toBeVisible();
});
it.each([['future','2026-10-08（未来日・要確認）'],['unknown','基準日未確認']])('retains the %s price warning even when the publication is current',(state,label)=>{
 render(<ResearchFreshnessNotice stale={false} freshness={{state}} date="2026-10-08" generatedAt="2026-10-03T12:00:00Z"/>);
 const summary=screen.getByRole('alert').querySelector('summary');
 expect(summary).toHaveTextContent(label);
 expect(summary).not.toHaveTextContent('要再確認');
 expect(screen.getByRole('alert')).toHaveTextContent('分析基準日が未確認、または未来の日付です。');
});
it('does not produce a freshness warning when both supplied checks are current',()=>{
 render(<ResearchFreshnessNotice stale={false} freshness={{state:'recent',days:0}} date="2026-10-03" generatedAt="2026-10-03T12:00:00Z"/>);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('identifies a missing publication timestamp independently of a known price date',()=>{
 render(<ResearchFreshnessNotice stale freshness={{state:'recent',days:0}} date="2026-10-03"/>);
 const summary=screen.getByRole('alert').querySelector('summary');
 expect(summary).toHaveTextContent('公開 時刻未確認 · 要再確認');
 expect(summary).toHaveTextContent('価格 2026-10-03');
});
