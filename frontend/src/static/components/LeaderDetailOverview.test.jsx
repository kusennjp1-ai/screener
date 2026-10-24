import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within,fireEvent} from '@testing-library/react';
import {LeaderDetailOverview,LeaderDetailFundamentals} from './LeaderDetailOverview';
import {assess,entryPlan} from '../researchEngine';
import {entryReadiness} from '../entryReadiness';
import {withAuditFixture} from '../testAuditFixture';
import {syntheticBookFinancials} from '../../test/fixtures/bookFinancials';
import {bookFinancialCurrent} from '../bookFinancialCurrent';
afterEach(cleanup);
const date='2026-02-01',now=Date.parse('2026-02-01T22:00:00Z'),method='minervini',market={state:'uptrend',cap:.5,label:'上昇'};
const row=withAuditFixture({symbol:'TEST',current_price:100,se_pivot_price:99,rs_rating:85},date);
function overview(input=row){const readiness=entryReadiness(input,date,market,now,method);return {row:input,date,now,method,readiness,plan:entryPlan(input,null,method)};}
it('uses existing daily states and canonical audited numbers without mutating the row',()=>{
 const input={...row,price_change_1d:-77},before=structuredClone(input),props=overview(input),fn=vi.fn();
 const {container}=render(<LeaderDetailOverview {...props} onConditions={fn}/>);
 expect(container).toHaveTextContent('+2.0%');expect(container).not.toHaveTextContent('77');
 expect(container).toHaveTextContent('1.60×');
 const strip=screen.getByRole('group',{name:`日次条件 ${props.readiness.passed}/7`});
 expect(strip.children).toHaveLength(7);props.readiness.rules.forEach((rule,i)=>expect(strip.children[i]).toHaveAttribute('data-state',rule.state));
 expect(screen.getByRole('group',{name:'5つの関門：既存根拠の分類'}).children).toHaveLength(5);
 fireEvent.click(screen.getByRole('button',{name:/VCP・形状候補/}));expect(fn).toHaveBeenCalledOnce();
 expect(container).toHaveTextContent('VCP欄は形状候補');expect(input).toEqual(before);
});
it('keeps missing daily data and missing RS unknown instead of drawing a zero arc',()=>{
 const props=overview({symbol:'MISSING',current_price:null,rs_rating:null,price_change_1d:77});
 const {container}=render(<LeaderDetailOverview {...props}/>);
 expect(screen.getByRole('img',{name:'RS データなし'}).querySelectorAll('circle')).toHaveLength(1);
 expect(container).not.toHaveTextContent('77');expect(container).toHaveTextContent('データなし');
});
it.each(['minervini','minervini2','oneil','ibd'])('shows exactly eight canonical trend items with integrity separate for %s',selectedMethod=>{
 const {container}=render(<LeaderDetailFundamentals row={row} date={date} now={now} method={selectedMethod}/>);
 const panel=container.querySelector('.leader-detail-trend'),checks=assess(row,selectedMethod==='minervini2'?'minervini2':'minervini',now);
 expect(panel).toHaveTextContent('8/8');expect(panel.querySelectorAll('li')).toHaveLength(8);
 checks.rules.slice(0,8).forEach((rule,i)=>expect(panel.querySelectorAll('li')[i]).toHaveAttribute('data-state',rule.state));
 expect(panel).toHaveTextContent('日足整合性（別項目）');expect(panel).not.toHaveTextContent('9/8');
});
it('rejects trend evidence from another analysis date',()=>{
 const {container}=render(<LeaderDetailFundamentals row={row} date="2026-02-02" now={now} method={method}/>);
 expect(container.querySelector('.leader-detail-trend')).toHaveTextContent('0/8');
 expect([...container.querySelectorAll('.leader-detail-trend li')].every(li=>li.dataset.state==='unknown')).toBe(true);
});
it('keeps Code33 four-quarter verdict but renders only a clearly labeled last-three preview',()=>{
 const input={...row,book_financials:syntheticBookFinancials()},before=structuredClone(input),current=bookFinancialCurrent(input.book_financials,'TEST',date,now,input),fn=vi.fn();
 const {container}=render(<LeaderDetailFundamentals row={input} date={date} now={now} method={method} onEvidence={fn}/>);
 const panel=container.querySelector('.leader-detail-code33');
 expect(panel.querySelector('summary [data-state]')).toHaveAttribute('data-state',current.report.code33);
 expect(panel).toHaveTextContent('4四半期・3回連続改善');
 expect(within(panel).getByRole('table',{name:'直近3四半期の表示（判定は4四半期）'}).querySelectorAll('[role=row]')).toHaveLength(4);
 expect(panel).toHaveTextContent('2025-12-31');expect(panel).not.toHaveTextContent('2025-03-31');
 fireEvent.click(within(panel).getByRole('button',{name:'業績の全根拠を見る'}));expect(fn).toHaveBeenCalledOnce();expect(input).toEqual(before);
});
it('does not promote stale Code33 history to current success',()=>{
 const input={...row,book_financials:syntheticBookFinancials()};
 const {container}=render(<LeaderDetailFundamentals row={input} date={date} now={Date.parse('2026-10-24')} method={method}/>);
 expect(container.querySelector('.leader-detail-code33 summary [data-state]')).toHaveAttribute('data-state','unknown');
 expect(container).toHaveTextContent('現在の業績確認は未確認');
});
it('shows missing financial history without fabricated quarter values',()=>{
 const {container}=render(<LeaderDetailFundamentals row={row} date={date} now={now} method={method}/>);
 expect(container).toHaveTextContent('四半期推移：データなし');expect(screen.queryByRole('table')).toBeNull();
});
it('draws eight separate trend segments from canonical states, not an unconditional 8/8 badge',()=>{
 const input=withAuditFixture({...row,rs_rating:null},date);
 render(<LeaderDetailFundamentals row={input} date={date} now={now} method={method}/>);
 const ring=screen.getByRole('img',{name:'Trend Template 7/8。未確認は達成に数えません'});
 expect(ring.querySelectorAll('circle')).toHaveLength(8);
 expect(ring.querySelectorAll('circle[stroke="var(--zone)"]')).toHaveLength(7);
 expect(ring.querySelectorAll('circle[stroke="var(--line)"]')).toHaveLength(1);
});
it('plots actual Code33 three-period points and exposes exact values in SVG labels',()=>{
 const input={...row,book_financials:syntheticBookFinancials()};
 render(<LeaderDetailFundamentals row={input} date={date} now={now} method={method}/>);
 const graph=screen.getByRole('img',{name:/EPS前年比 2025-06-30 20%/});
 expect(graph.querySelectorAll('circle')).toHaveLength(3);
 expect(graph.querySelector('polyline')).toHaveAttribute('points','8,36 60,26.666666666666668 112,8');
 expect(screen.getByRole('img',{name:/純利益率 2025-06-30 11%/})).toBeInTheDocument();
});
it('routes trend and RS gates to their actual eight-condition evidence rather than the seven daily rules',()=>{
 render(<><LeaderDetailOverview {...overview()}/><LeaderDetailFundamentals row={row} date={date} now={now} method={method}/></>);
 fireEvent.click(screen.getByRole('button',{name:/トレンド：達成/}));
 expect(document.getElementById('leader-trend-template')).toHaveAttribute('open');
 expect(document.getElementById('leader-trend-template').querySelector('summary')).toHaveFocus();
});
it('never presents an applicable 8/8 ring for an excluded fund even when technical measurements pass',()=>{
 const fund=withAuditFixture({...row,symbol:'BITU',market:'US',company_name:'ProShares Ultra Bitcoin ETF'},date);
 const {container}=render(<LeaderDetailFundamentals row={fund} date={date} now={now} method={method}/>);
 const summary=container.querySelector('.leader-detail-trend summary');
 expect(summary).toHaveTextContent('—/8');expect(summary).not.toHaveTextContent('8/8');
 expect(summary).toHaveTextContent('対象外');
 expect(screen.getByRole('img',{name:'Trend Template 対象外または適用未確認。参考内訳は展開して確認'}).querySelectorAll('circle[stroke="var(--zone)"]')).toHaveLength(0);
 expect(container.querySelectorAll('.leader-detail-trend li')).toHaveLength(8);
});
