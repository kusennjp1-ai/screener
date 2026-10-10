import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import BookSourceComparison from './BookSourceComparison';
import { withAuditFixture } from '../testAuditFixture';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../testFinancialFixture';
afterEach(cleanup);
const row=withAuditFixture({symbol:'BOOK',market:'US',current_price:104,rs_rating:90},date);
const input={row,date,now,method:'minervini'};

it('shows four named sources, distinct authority labels and comparison-only scope',()=>{
 const {container}=render(<BookSourceComparison {...input}/>);
 const region=screen.getByRole('region',{name:'4冊の条件と現行判定'});
 for(const title of ['株式トレード 基本と原則','ミネルヴィニの成長株投資法','成長株投資の神','オニールの相場師養成講座']) expect(within(region).getByText(title,{selector:'summary'})).toBeInTheDocument();
 expect(container.querySelectorAll('[data-rule-id]')).toHaveLength(12);
 expect(region).toHaveTextContent('全条件通過数・順位・購入可否を変更しません');
 expect(region).toHaveTextContent('限定された例外');
 expect(region).toHaveTextContent('好ましい特徴');
 expect(region).toHaveTextContent('原典の必須条件');
 expect(region).toHaveTextContent('原典の手法全体の充足ではありません');
 expect(region).toHaveTextContent('印刷ページは未確認');
 expect(region).toHaveTextContent('0.25%／0.5%');
});

it('opens the active edition and supports repeated source disclosure clicks',()=>{
 render(<BookSourceComparison {...input}/>);
 const wizard=screen.getByText('ミネルヴィニの成長株投資法',{selector:'summary'}).closest('details');
 const champion=screen.getByText('株式トレード 基本と原則',{selector:'summary'}).closest('details');
 expect(wizard).toHaveAttribute('open');expect(champion).not.toHaveAttribute('open');
 for(let i=0;i<2;i++){
  fireEvent.click(champion.querySelector('summary'));expect(champion).toHaveAttribute('open');
  fireEvent.click(champion.querySelector('summary'));expect(champion).not.toHaveAttribute('open');
 }
});

it('retains all four Momentum Masters authors and the unavailable 20-day denominator',()=>{
 const {container}=render(<BookSourceComparison {...input}/>);
 for(const name of ['Mark Minervini','David Ryan','Dan Zanger','Mark Ritchie II']) expect(screen.getByRole('region')).toHaveTextContent(name);
 expect(container.querySelector('[data-rule-id="masters-zanger-volume"]')).toHaveAttribute('data-rule-state','unknown');
 expect(container.querySelector('[data-rule-id="masters-zanger-volume"]')).toHaveTextContent('50日比を代入しません');
 expect(container.querySelector('[data-rule-id="masters-ritchie-volume"]')).toHaveAttribute('data-rule-state','review');
});

it('replaces a prior financial pass with unknown at expiry and after a symbol change',()=>{
 const financial=withFinancialProof({...row,sales_growth_yy:30});
 const {container,rerender}=render(<BookSourceComparison {...input} row={financial}/>);
 const sales=()=>container.querySelector('[data-rule-id="oneil-sales"]');
 expect(sales()).toHaveAttribute('data-rule-state','pass');
 expect(sales()).toHaveTextContent('有効期限');
 rerender(<BookSourceComparison {...input} row={financial} now={now+8*86400000}/>);
 expect(sales()).toHaveAttribute('data-rule-state','unknown');
 expect(sales()).not.toHaveTextContent('30.00%');
 rerender(<BookSourceComparison {...input} row={{...financial,symbol:'OTHER'}}/>);
 expect(sales()).toHaveAttribute('data-rule-state','unknown');
 expect(sales()).not.toHaveTextContent('30.00%');
});

it('shows the annual book comparison and strict app result separately',()=>{
 const history={symbol:'BOOK',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-1000).toISOString(),annual:[1,1.2,1.6,2].map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]};
 const {container}=render(<BookSourceComparison {...input} row={{...row,financial_history:history}} method="oneil"/>);
 const annual=container.querySelector('[data-rule-id="oneil-annual"]');
 expect(annual).toHaveAttribute('data-rule-state','pass');
 expect(annual).toHaveTextContent('アプリ閾値との比較（同じ4期で毎年25%以上）：この比較は未充足');
 expect(annual).toHaveTextContent('25.99%');
 expect(annual).toHaveTextContent('2022-12-31');
 expect(annual).toHaveTextContent('直近12か月EPSと最新年度EPSの比較は未評価');
});

it('labels incomplete strict-threshold comparisons without impersonating the actual qualification result',()=>{
 const history={symbol:'BOOK',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-1000).toISOString(),annual:[1,1.2,null,2].map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]};
 const {container}=render(<BookSourceComparison {...input} row={{...row,financial_history:history}} method="oneil"/>);
 const annual=container.querySelector('[data-rule-id="oneil-annual"]');
 expect(annual).toHaveTextContent('アプリ閾値との比較（同じ4期で毎年25%以上）：未確認');
 expect(annual).toHaveTextContent('実際の選定結果は「判定根拠」タブ');
});
