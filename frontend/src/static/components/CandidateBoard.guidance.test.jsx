import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import { entryReadiness } from '../entryReadiness';
import { withAuditFixture } from '../testAuditFixture';
vi.mock('../entryReadiness',()=>({entryReadiness:vi.fn()}));
vi.mock('./CandidateCharts',()=>({default:()=> <div>比較チャート</div>}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const ranked=Array.from({length:103},(_,index)=>({row:{symbol:`S${index}`,company_name:`Company ${index}`,current_price:102,se_pivot_price:100,rs_rating:90,se_volume_vs_50d:1.5},assessment:{qualified:true,passed:9,total:9}}));
const market={cap:.5,label:'上昇'};
const props={ranked,method:'minervini',date:'2026-09-29',market,now:Date.parse('2026-09-30T10:00:00Z'),onSelect:vi.fn()};
const waiting={ready:false,passed:5,total:7,rules:[{id:'selection',state:'pass',label:'共通選定条件'},{id:'volume',state:'fail',label:'出来高',detail:'50日平均比が基準未満'},{id:'earnings',state:'unknown',label:'決算予定',detail:'予定日が未取得'}]};
it('adds daily readiness only for the visible 50 and reuses it when selection changes',()=>{
 entryReadiness.mockReturnValue(waiting);
 const {rerender}=render(<CandidateBoard {...props}/>);
 expect(entryReadiness).toHaveBeenCalledTimes(50);
 expect(entryReadiness).toHaveBeenLastCalledWith(ranked[49].row,props.date,market,props.now,'minervini');
 rerender(<CandidateBoard {...props} selectedSymbol="S1"/>);
 expect(entryReadiness).toHaveBeenCalledTimes(50);
 fireEvent.click(screen.getByRole('button',{name:'次の50件'}));
 expect(entryReadiness).toHaveBeenCalledTimes(100);
 fireEvent.click(screen.getByRole('button',{name:'次の50件'}));
 expect(entryReadiness).toHaveBeenCalledTimes(103);
});
it('shows price location and daily purchase status separately, with the next failed check in the accessible name',()=>{
 entryReadiness.mockReturnValue(waiting);
 render(<CandidateBoard {...props} ranked={ranked.slice(0,1)}/>);
 const row=screen.getByRole('button',{name:/S0 の分析を表示/});
 expect(row).toHaveAccessibleName(/買いゾーン内/);
 expect(row).toHaveAccessibleName(/選定 9\/9。日次 5\/7。出来高：未達/);
 expect(row).toHaveTextContent('● 買いゾーン内');
 expect(row).toHaveTextContent('日次 5/7');
 expect(row).not.toHaveTextContent('✓');
 fireEvent.click(row);expect(props.onSelect).toHaveBeenLastCalledWith('S0');
});
it('keeps the trading-day blocker accessible when financial selection is also unknown',()=>{
 entryReadiness.mockReturnValue({ready:false,passed:3,total:7,rules:[
  {id:'selection',label:'選定条件',state:'unknown',detail:'財務根拠が未確認'},
  {id:'latest',label:'最新の取引日',state:'unknown',detail:'最新取引日を確認できません'},
  {id:'earnings',label:'決算予定',state:'unknown',detail:'決算日が未確認'},
 ]});
 render(<CandidateBoard {...props} ranked={ranked.slice(0,1)}/>);
 const row=screen.getByRole('button',{name:/S0 の分析を表示/});
 expect(row).toHaveAccessibleName(/選定条件：未確認/);
 expect(row).toHaveAccessibleName(/最新の取引日：未確認/);
 expect(row).toHaveAccessibleName(/決算予定：未確認/);
 expect(row).not.toHaveTextContent('✓');
});
it('marks daily readiness only when all common checks pass and updates when time changes',()=>{
 entryReadiness.mockReturnValueOnce({ready:true,passed:7,total:7,rules:[]}).mockReturnValue(waiting);
 const {rerender}=render(<CandidateBoard {...props} ranked={ranked.slice(0,1)}/>);
 expect(screen.getByText('日次 7/7 ✓')).toHaveAttribute('data-ready','true');
 expect(screen.getByRole('button',{name:/S0 の分析を表示/})).toHaveAccessibleName(/発注前に最新価格とリスクを確認/);
 rerender(<CandidateBoard {...props} ranked={ranked.slice(0,1)} now={props.now+1000}/>);
 expect(screen.getByText('日次 5/7')).not.toHaveAttribute('data-ready');
});
it('keeps missing context unconfirmed rather than passing and does no list readiness work in chart mode',()=>{
 const {rerender}=render(<CandidateBoard {...props} date={undefined} ranked={ranked.slice(0,1)}/>);
 expect(screen.getByText('日次 未確認')).toBeInTheDocument();
 expect(entryReadiness).not.toHaveBeenCalled();
 rerender(<CandidateBoard {...props} view="charts"/>);
 expect(screen.getByText('比較チャート')).toBeInTheDocument();
 expect(entryReadiness).not.toHaveBeenCalled();
});
it('offers focusable progressive explanations without hiding sorting controls',async()=>{
 entryReadiness.mockReturnValue(waiting);
 const user=userEvent.setup();
 const {container}=render(<CandidateBoard {...props} ranked={ranked.slice(0,1)}/>);
 const disclosure=screen.getByText('一覧の見方');
 const details=disclosure.closest('details');
 expect(details).not.toHaveAttribute('open');
 disclosure.focus();expect(disclosure).toHaveFocus();await user.click(disclosure);
 expect(details).toHaveAttribute('open');
 expect(screen.getByText(/RSはRSIとは異なります/)).toBeVisible();
 expect(screen.getByText(/買いゾーン内でも、未達・未確認/)).toBeVisible();
 await user.click(disclosure);
 expect(details).not.toHaveAttribute('open');
 expect(container.querySelectorAll('.candidate-row')).toHaveLength(1);
 expect(screen.getByRole('combobox',{name:'候補の並び順'})).toBeInTheDocument();
});
it('displays and sorts the audited daily volume without falling back to a conflicting legacy copy',()=>{
 entryReadiness.mockReturnValue(waiting);
 const items=['A','B','UNKNOWN'].map((symbol,index)=>{
  const row=withAuditFixture({symbol,current_price:102,se_pivot_price:100,se_volume_vs_50d:3-index,entry_evidence:{volumeRatio:9}},props.date);
  row.technical_audit.values.volumeRatio=[1.39,1.4,null][index];
  return {row,assessment:{qualified:true,passed:9,total:9}};
 });
 const {container}=render(<CandidateBoard {...props} ranked={items}/>);
 expect(screen.getByRole('button',{name:/^A の分析/})).toHaveAccessibleName(/出来高 1.39×/);
 expect(screen.getByRole('button',{name:/^UNKNOWN の分析/})).toHaveAccessibleName(/出来高 —/);
 fireEvent.change(screen.getByRole('combobox',{name:'候補の並び順'}),{target:{value:'volume'}});
 expect([...container.querySelectorAll('.candidate-row')].map(row=>row.querySelector('.candidate-name strong').textContent)).toEqual(['B','A','UNKNOWN']);
});
