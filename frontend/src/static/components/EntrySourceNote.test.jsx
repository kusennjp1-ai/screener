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
it('keeps verified Champion source scope on demand',()=>{
 const {container}=render(<EntrySourceNote plan={entryPlan({current_price:102,se_pivot_price:100},null,'minervini2')}/>);
 expect(screen.queryByRole('note')).not.toBeInTheDocument();
 expect(container.querySelectorAll('details')).toHaveLength(1);
 expect(container.querySelector('summary')).toHaveTextContent('アプリ設定と書籍の確認範囲');
 expect(screen.getByText(/株式トレード 基本と原則/)).toBeInTheDocument();
});
it('omits an empty warning slot when its source details have moved to a shared disclosure',()=>{
 const {container}=render(<EntrySourceNote showDetails={false} plan={entryPlan({current_price:102,se_pivot_price:100},null,'minervini')}/>);
 expect(container).toBeEmptyDOMElement();
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
it('does not reserve comparison-card space for an empty compact source note',()=>{
 const {container}=render(<EntrySourceNote compact plan={entryPlan({current_price:102,se_pivot_price:100},null,'minervini')}/>);
 expect(container).toBeEmptyDOMElement();
});
it.each([false,true])('never describes an extended price as inside the app range (compact: %s)',compact=>{
 render(<EntrySourceNote compact={compact} plan={entryPlan({current_price:112.7,se_pivot_price:100},null,'minervini')}/>);
 const warning=screen.getByRole('note');
 expect(warning).toHaveTextContent('書籍の追随目安外');
 expect(warning).toHaveTextContent('アプリの買い上限と、『ミネルヴィニの成長株投資法』の約2〜3%目安を超えています');
 expect(warning).not.toHaveTextContent('アプリの範囲内');
});
it('keeps a short visible comparison warning with its full meaning available to assistive technology',()=>{
 render(<EntrySourceNote compact plan={entryPlan({current_price:104,se_pivot_price:100},null,'minervini')}/>);
 const warning=screen.getByRole('note');
 expect(warning.querySelector('strong')).toHaveTextContent('△ 書籍の追随目安外');
 expect(warning.querySelector('[aria-hidden="true"]')).toHaveTextContent('約2〜3%超');
 expect(warning.querySelector('.sr-only')).toHaveTextContent('アプリの範囲内ですが、『ミネルヴィニの成長株投資法』の約2〜3%目安を超えています');
});
it('attributes the inline warning to the selected book',async()=>{
 const {EntrySourceBadge}=await import('./EntrySourceNote');
 const {rerender}=render(<EntrySourceBadge plan={entryPlan({current_price:103.2,se_pivot_price:100},null,'minervini')}/>);
 expect(screen.getByRole('note',{name:/書籍の追随目安外：アプリの範囲内ですが/})).toHaveTextContent('△ 書籍目安2〜3%超');
 rerender(<EntrySourceBadge plan={entryPlan({current_price:103,se_pivot_price:100},null,'minervini')}/>);
 expect(screen.queryByRole('note')).not.toBeInTheDocument();
 rerender(<EntrySourceBadge plan={entryPlan({current_price:103.2,se_pivot_price:100},null,'minervini2')}/>);
 expect(screen.getByRole('note')).toHaveAttribute('title',expect.stringContaining('株式トレード 基本と原則'));
});
