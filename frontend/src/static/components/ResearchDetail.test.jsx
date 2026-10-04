import { render,screen,cleanup,within,fireEvent } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { buildFinancialEvidencePresentation, FINANCIAL_PRESENTATION_SCHEMA } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate, financialFixtureNow } from '../../test/fixtures/financialCurrent';
import { assess } from '../researchEngine';
import ResearchDetail from './ResearchDetail';
vi.mock('./ResearchChart',()=>({default:()=> <div data-testid="research-chart"/>}));
afterEach(cleanup);
const props={method:'minervini',date:'2026-10-01',market:{cap:.5,label:'上昇'},now:Date.parse('2026-10-01T22:00:00Z'),watch:[],detail:{}};
const row={symbol:'MSM',company_name:'MSC Industrial Direct Co Inc',current_price:103.2,se_pivot_price:100};
it.each([103.2,112.7])('shows the first-book caution beside the company before the inline chart at %s',price=>{
 const {container}=render(<ResearchDetail {...props} selected={{...row,current_price:price}}/>);
 const header=container.querySelector('.research-symbol-head');
 const warning=within(header).getByRole('note',{name:/書籍の追随目安外/});
 expect(warning).toHaveTextContent('△ 書籍目安2〜3%超');
 expect(warning.closest('.symbol-context')).not.toBeNull();
 expect(within(header).getByText(row.company_name)).toHaveAttribute('title',row.company_name);
 expect(header.nextElementSibling).toBe(screen.getByTestId('research-chart'));
 // The full disclosure remains in the entry card after the chart.
 expect(screen.getByText('アプリ設定と書籍の確認範囲')).toBeInTheDocument();
 if(price>105)expect(warning).not.toHaveAttribute('aria-label',expect.stringContaining('アプリの範囲内'));
});
it.each([[103,'minervini'],[104,'minervini2'],[104,'oneil']])('does not add a first-book header warning at %s for %s',(price,method)=>{
 const {container}=render(<ResearchDetail {...props} method={method} selected={{...row,current_price:price}}/>);
 expect(within(container.querySelector('.research-symbol-head')).queryByRole('note')).not.toBeInTheDocument();
});

it.each(['minervini','minervini2'])('explains the checked source and implementation boundary for %s',method=>{
 render(<ResearchDetail {...props} method={method} selected={row}/>);
 const disclosure=screen.getByText('トレンド条件の出典とアプリの近似').closest('details');
 expect(disclosure).not.toHaveAttribute('open');
 expect(disclosure).toHaveTextContent(method==='minervini'?'近似判定8件と独自の日足品質確認1件':'第2冊の25%指定は未確認');
});
it.each(['oneil','ibd'])('keeps source disclosure scoped away from %s',method=>{
 render(<ResearchDetail {...props} method={method} selected={row}/>);
 expect(screen.queryByText('トレンド条件の出典とアプリの近似')).not.toBeInTheDocument();
});

it('keeps financial evidence inside the existing financial tab and retains the chart and entry arrangement', () => {
 const onVerificationToggle=vi.fn();
 const {container}=render(<ResearchDetail {...props} onVerificationToggle={onVerificationToggle} selected={{...row,eps_growth_yy:999,roe:999}}/>);
 const header=container.querySelector('.research-symbol-head');
 expect(header.nextElementSibling).toBe(screen.getByTestId('research-chart'));
 expect(screen.getByTestId('research-chart').nextElementSibling).toContainElement(screen.getByText('アプリ設定と書籍の確認範囲'));
 expect(screen.queryByRole('region',{name:'財務の判定根拠'})).not.toBeInTheDocument();
 expect(screen.getAllByRole('tab').map(tab=>tab.textContent)).toEqual(['判定根拠','購入条件','財務・機関','書籍検証','メモ']);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(onVerificationToggle).toHaveBeenCalledWith(row.symbol);
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('未配信');
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent('999');
 expect(screen.getByText('取得した財務履歴 — 年次EPS・四半期業績').closest('details')).not.toHaveAttribute('open');
});

it('renders only the supplied bound evidence and rejects it after changing symbols', () => {
 const financialEvidence={schema:FINANCIAL_PRESENTATION_SCHEMA,symbol:row.symbol,as_of_date:props.date,generation:'fixture',method:'minervini',
  evaluated_at:'2026-10-01T22:00:00Z',valid_until:'2026-10-08T21:00:00Z',metrics:{eps_growth_yy:{value:30,unit:'percent_points',availability:'current',
   source:'Bound provider',basis:'selected-quarter-yoy',period_end:'2026-06-30',comparable_period_end:'2025-06-30',observed_at:'2026-10-01T21:00:00Z',valid_until:'2026-10-08T21:00:00Z'}}};
 const input={...props,version:'fixture',onVerificationToggle:vi.fn(),financialEvidence};
 const {rerender}=render(<ResearchDetail {...input} selected={row}/>);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('30%');
 rerender(<ResearchDetail {...input} selected={{...row,symbol:'OTHER'}}/>);
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).not.toHaveTextContent('30%');
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('配信版の対応を確認できません');
});

it('hides previous-generation evidence during detail loading and failure', () => {
 const current=withSyntheticFinancialProof({...row});
 const input={...props,selected:current,method:'oneil',date:financialFixtureDate,now:financialFixtureNow,version:'g1',onVerificationToggle:vi.fn()};
 const financialEvidence=buildFinancialEvidencePresentation(current,{method:input.method,date:input.date,generation:'g1',now:input.now});
 const {rerender}=render(<ResearchDetail {...input} financialEvidence={financialEvidence}/>);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('30%');
 const pending={...input,version:'g2',selected:{...current,research_detail_path:'new-detail.json'}};
 rerender(<ResearchDetail {...pending} detail={{isLoading:true}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
 expect(screen.queryByRole('region',{name:'財務の判定根拠'})).not.toBeInTheDocument();
 rerender(<ResearchDetail {...pending} detail={{isError:true,refetch:vi.fn()}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('合格とは扱いません');
 expect(screen.queryByRole('region',{name:'財務の判定根拠'})).not.toBeInTheDocument();
});

it('re-evaluates the existing selection count when current financial evidence expires', () => {
 const current=withSyntheticFinancialProof({...row});
 const input={...props,selected:current,method:'oneil',date:financialFixtureDate,now:financialFixtureNow};
 const first=assess(current,'oneil',financialFixtureNow);
 const {rerender}=render(<ResearchDetail {...input}/>);
 expect(screen.getByRole('heading',{name:`選定 ${first.passed}/${first.total} · 未確認 ${first.unknown}`})).toBeInTheDocument();
 const later=financialFixtureNow+8*86400000;
 const expired=assess(current,'oneil',later);
 expect(expired.passed).toBeLessThan(first.passed);
 rerender(<ResearchDetail {...input} now={later}/>);
 expect(screen.getByRole('heading',{name:`選定 ${expired.passed}/${expired.total} · 未確認 ${expired.unknown}`})).toBeInTheDocument();
});
