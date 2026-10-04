import { render,screen,cleanup,within,fireEvent } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildFinancialEvidencePresentation } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate, financialFixtureNow } from '../../test/fixtures/financialCurrent';
import ResearchDetail from './ResearchDetail';
import { FINANCIAL_PRESENTATION_SCHEMA } from '../financialEvidencePresentation';
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
 expect(header.compareDocumentPosition(screen.getByRole('region',{name:'財務の確認状況'})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getByRole('region',{name:'財務の確認状況'}).compareDocumentPosition(screen.getByTestId('research-chart')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 // Price-level/source disclosure is visible before the selected chart.
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
 const {container}=render(<ResearchDetail {...props} method={method} selected={row}/>);
 expect(screen.queryByText('トレンド条件の出典とアプリの近似')).not.toBeInTheDocument();
 expect(container.querySelector('.research-symbol-head .detail-method')).toHaveTextContent(method==='oneil'?'オニール':'IBD型');
});

it.each(['minervini','minervini2'])('makes the scope of all nine technical checks visible for %s with the compact financial summary above the chart', method => {
 const {container}=render(<ResearchDetail {...props} method={method} selected={row}/>);
 const note=screen.getByRole('note',{name:'財務と選定の確認範囲'});
 expect(note).toHaveTextContent('トレンド8条件と日足品質1条件');
 expect(note).toHaveTextContent('9/9でもSEPAの総合確認は未完了');
 expect(note.closest('details')).toBeNull();
 expect(container.querySelector('.financial-evidence-summary').compareDocumentPosition(screen.getByTestId('research-chart')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getByText('直近3年の年次 EPS').closest('details')).toBeNull();
});

it('opens financial history directly from the scope link, without reading raw scalars into the new panel', () => {
 const onVerificationToggle=vi.fn();
 render(<ResearchDetail {...props} onVerificationToggle={onVerificationToggle} selected={{...row,eps_growth_yy:999,roe:999}}/>);
 fireEvent.click(screen.getByRole('button',{name:'財務の根拠を見る →'}));
 expect(screen.getByRole('tab',{name:'財務・機関'})).toHaveAttribute('aria-selected','true');
 expect(onVerificationToggle).toHaveBeenCalledWith(row.symbol);
 expect(screen.getByRole('heading',{name:'取得した財務履歴 — 年次EPS・四半期業績'}).closest('details')).toBeNull();
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('未配信');
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent('999');
});

it('renders only the explicitly supplied projection and rejects it after changing symbols', () => {
 const financialEvidence={schema:FINANCIAL_PRESENTATION_SCHEMA,symbol:row.symbol,as_of_date:props.date,generation:'fixture',method:'minervini',
  evaluated_at:'2026-10-01T22:00:00Z',valid_until:'2026-10-08T21:00:00Z',metrics:{eps_growth_yy:{value:30,unit:'percent_points',availability:'current',
   source:'Bound provider',basis:'selected-quarter-yoy',period_end:'2026-06-30',comparable_period_end:'2025-06-30',observed_at:'2026-10-01T21:00:00Z',valid_until:'2026-10-08T21:00:00Z'}}};
 const {rerender}=render(<ResearchDetail {...props} version="fixture" selected={row} financialEvidence={financialEvidence}/>);
 fireEvent.click(screen.getByRole('button',{name:'財務の根拠を見る →'}));
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('30%');
 rerender(<ResearchDetail {...props} version="fixture" selected={{...row,symbol:'OTHER'}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).not.toHaveTextContent('30%');
 expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('配信版の対応を確認できません');
});


it.each(['oneil','ibd','minervini'])('opens the matching financial and book evidence in one action for %s', method => {
 const current = withSyntheticFinancialProof({ ...row });
 const input = { ...props, selected: current, method, version:'synthetic', date:financialFixtureDate, now:financialFixtureNow };
 const evidence = buildFinancialEvidencePresentation(current,{method,date:input.date,generation:input.version,now:input.now});
 const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><ResearchDetail {...input} financialEvidence={evidence}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:/^EPS前年比 30%/}));
 const panel=screen.getByRole('region',{name:'財務の判定根拠'});
 expect(panel.querySelector('#financial-evidence-eps_growth_yy')).toHaveTextContent('30%');
 expect(panel.querySelector('#financial-evidence-eps_growth_yy')).toHaveTextContent('yfinance');
 fireEvent.click(screen.getByRole('button',{name:/^業績の連続性/}));
 expect(screen.getByRole('tab',{name:'書籍検証'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByText('業績の連続性と利益の質を確認').closest('details')).toHaveAttribute('open');
 expect(screen.getByRole('tabpanel')).toHaveTextContent('提出日付きの四半期履歴は未取得');
});

it('hides previous same-date generation evidence immediately during loading and failure', () => {
 const current = withSyntheticFinancialProof({ ...row });
 const input = { ...props, selected:current, method:'oneil', date:financialFixtureDate, now:financialFixtureNow, version:'g1' };
 const financialEvidence = buildFinancialEvidencePresentation(current,{method:input.method,date:input.date,generation:'g1',now:input.now});
 const {rerender}=render(<ResearchDetail {...input} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('region',{name:'財務の確認状況'})).toHaveTextContent('30%');
 const pending = {...input,version:'g2',selected:{...current,research_detail_path:'new-detail.json'}};
 rerender(<ResearchDetail {...pending} detail={{isLoading:true}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('region',{name:'財務の確認状況'})).not.toHaveTextContent('30%');
 fireEvent.click(screen.getByRole('button',{name:/^EPS前年比/}));
 expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
 rerender(<ResearchDetail {...pending} detail={{isError:true,refetch:()=>{}}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('region',{name:'財務の確認状況'})).not.toHaveTextContent('30%');
 expect(screen.getByRole('alert')).toHaveTextContent('合格とは扱いません');
});
