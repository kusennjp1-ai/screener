import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import EntrySourceNote from './EntrySourceNote';
import ChartDecisionSummary from './ChartDecisionSummary';
import BookFinancialReview from './BookFinancialReview';
import {entryPlan} from '../researchEngine';
afterEach(cleanup);
it('warns visibly at +4% even while the unchanged model is inside its5% zone',()=>{
 render(<ChartDecisionSummary row={{symbol:'SOURCE',current_price:104,se_pivot_price:100}} method="minervini" date="2026-10-01"/>);
 expect(screen.getByRole('note')).toHaveTextContent('書籍の追随目安外');
 expect(screen.getByRole('note').closest('details')).toBeNull();
 expect(screen.getByText(/アプリ買い上限/)).toHaveTextContent('$105.00');
 expect(screen.getByText(/買いゾーン内（価格位置）/)).toBeInTheDocument();
});
it('keeps source scope on demand and never claims the second book was checked',()=>{
 render(<EntrySourceNote plan={entryPlan({current_price:102,se_pivot_price:100},null,'minervini2')}/>);
 expect(screen.queryByRole('note')).not.toBeInTheDocument();
 expect(screen.getByText(/第2冊の数値指定の根拠にはしていません/)).toBeInTheDocument();
});
it('shows a compact warning without adding a disclosure inside a chart click target',()=>{
 const {container}=render(<EntrySourceNote compact plan={entryPlan({current_price:104,se_pivot_price:100},null,'minervini')}/>);
 expect(screen.getByRole('note')).toHaveTextContent('約2〜3%');expect(container.querySelector('details')).toBeNull();
});
it('keeps quarterly acceleration separate from overall Minervini qualification',()=>{
 render(<BookFinancialReview row={{symbol:'MISSING'}}/>);
 expect(screen.getByText(/4〜8四半期/)).toHaveTextContent('1四半期の減速や連続加速の未充足だけで');
 expect(screen.getByText(/提出日付きの四半期履歴は未取得/)).toBeInTheDocument();
});
