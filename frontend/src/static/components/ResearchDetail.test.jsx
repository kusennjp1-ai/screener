import { useMediaQuery } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render,screen,cleanup,within,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { buildFinancialEvidencePresentation, FINANCIAL_PRESENTATION_SCHEMA } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate, financialFixtureNow } from '../../test/fixtures/financialCurrent';
import { assess } from '../researchEngine';
import { entryReadiness } from '../entryReadiness';
import { withAuditFixture } from '../testAuditFixture';
import ResearchDetail from './ResearchDetail';
import { financialSourceContext, trendTemplateSourceContext } from '../bookSourceContext';
import { nativeAnnualFixture } from '../../test/fixtures/nativeAnnual';
import { withFinancialProof } from '../testFinancialFixture';
vi.mock('@mui/material', async importOriginal => ({...await importOriginal(),useMediaQuery:vi.fn(()=>false)}));
vi.mock('../financialEvidencePresentation', { spy: true });
vi.mock('./ResearchChart',()=>({default:()=> <div data-testid="research-chart"/>}));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(useMediaQuery).mockReturnValue(false); });
const props={method:'minervini',date:'2026-10-01',market:{cap:.5,label:'上昇'},now:Date.parse('2026-10-01T22:00:00Z'),watch:[],detail:{}};
const row={symbol:'MSM',company_name:'MSC Industrial Direct Co Inc',current_price:103.2,se_pivot_price:100};
it('labels missing financial evidence for the five-symbol exception and retains unknown purchase exclusion',()=>{
 const selected={...row,symbol:'NVDA',market:'US',as_of_date:props.date};
 const {container}=render(<ResearchDetail {...props} selected={selected}/>);
 const notice=container.querySelector('.research-symbol-head [data-financial-exclusion]');
 expect(notice).toHaveTextContent('財務未確認・判定対象外');
 expect(notice).toHaveAttribute('data-qualification','excluded');
 fireEvent.click(screen.getByRole('tab',{name:'購入条件'}));
 expect(screen.getByRole('tabpanel')).toHaveTextContent('財務未確認・判定対象外');
 expect(assess(selected,'minervini',props.now).qualified).toBe(false);
});
it.each(['MSM','ADI'])('keeps price-position context and the actual incomplete counts visible before the chart for %s',symbol=>{
 const selected={...row,symbol},readiness=entryReadiness(selected,props.date,props.market,props.now,props.method);
 const {container}=render(<ResearchDetail {...props} selected={selected}/>);
 const header=container.querySelector('.research-symbol-head'),context=within(header).getByLabelText('価格位置と購入条件');
 expect(context).toHaveTextContent('価格位置は購入可否と別です。');
 expect(context).toHaveTextContent(`未達 ${readiness.failed}・未確認 ${readiness.unknown}`);
 expect(context.closest('details')).toBeNull();
 expect(header.nextElementSibling).toBe(screen.getByTestId('research-chart'));
});
it('keeps the actual selected symbol and analysis date in the mobile header across detail tabs and clears it on exit',()=>{
 const host=document.createElement('div');host.id='research-mobile-instrument-context';document.body.append(host);
 const onVerificationToggle=vi.fn(),input={...props,selected:row,onVerificationToggle};
 const view=render(<ResearchDetail {...input}/>);
 const context=within(host).getByRole('group',{name:'表示中の銘柄と分析基準日'});
 expect(context).toHaveTextContent('MSM');expect(context).toHaveTextContent('分析 2026-10-01');
 for(const name of ['財務・機関','購入条件','判定根拠']){
  fireEvent.click(screen.getByRole('tab',{name}));expect(context).toHaveTextContent('MSM');
 }
 view.rerender(<ResearchDetail {...input} selected={{...row,symbol:'OTHER'}} date="2026-10-02"/>);
 expect(context).toHaveTextContent('OTHER');expect(context).toHaveTextContent('分析 2026-10-02');expect(context).not.toHaveTextContent('MSM');
 view.rerender(<ResearchDetail {...input} selected={undefined}/>);expect(host).toBeEmptyDOMElement();
 view.rerender(<ResearchDetail {...input}/>);expect(host).toHaveTextContent('MSM');
 view.unmount();expect(host).toBeEmptyDOMElement();host.remove();
});
it('passes the selected full row to the diagnostic panel without changing selection or purchase results', () => {
 const date='2026-10-02',now=Date.parse('2026-10-04T12:00:00Z');
 vi.useFakeTimers(); vi.setSystemTime(now);
 const selected=withFinancialProof({...row,symbol:'TEST',financial_history:nativeAnnualFixture('CAD',[1,1.2,1.5,2]),eps_growth_yy:30,sales_growth_yy:20},now,date);
 const input={...props,method:'oneil',date,now,selected,version:'diagnostics',onVerificationToggle:vi.fn()};
 const financialEvidence=buildFinancialEvidencePresentation(selected,{...input,generation:input.version});
 const before=structuredClone(selected),checks=assess(selected,'oneil',now),purchase=entryReadiness(selected,date,props.market,now,'oneil');
 const {rerender}=render(<ResearchDetail {...input} financialEvidence={financialEvidence}/>);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 fireEvent.click(screen.getByText('原典との比較（診断のみ）'));
 expect(screen.getByRole('region',{name:'原典の年次EPS条件'})).toHaveTextContent('25.99%');
 expect(assess(selected,'oneil',now)).toEqual(checks);
 expect(entryReadiness(selected,date,props.market,now,'oneil')).toEqual(purchase);
 expect(selected).toEqual(before);
 rerender(<ResearchDetail {...input} selected={{...selected,symbol:'OTHER'}} financialEvidence={financialEvidence}/>);
 expect(screen.getByRole('region',{name:'原典の年次EPS条件'})).toHaveAttribute('data-state','unknown');
 expect(screen.getByRole('region',{name:'原典の年次EPS条件'})).not.toHaveTextContent('25.99%');
});
it('distinguishes selection and purchase evidence dates without inventing a missing source', () => {
 const selected={...row,as_of_date:'2026-09-30',entry_evidence:{as_of_date:'2026-09-29'}};
 render(<ResearchDetail {...props} selected={selected} version="g2"/>);
 const selection=screen.getByRole('group',{name:'選出データの参照情報'});
 expect(selection).toHaveTextContent('選出データの対象日 2026-09-30 ／ 日付の対応 不一致');
 expect(screen.getByRole('tabpanel')).toHaveTextContent('記載がない提供元・対象日は未確認');
 fireEvent.click(screen.getByRole('tab',{name:'購入条件'}));
 expect(screen.getByRole('group',{name:'購入条件の根拠の参照情報'})).toHaveTextContent('購入条件の根拠の対象日 2026-09-29 ／ 日付の対応 不一致');
 expect(screen.getByRole('tabpanel')).toHaveTextContent('分析基準日 2026-10-01・検証基準日 2026-09-29 が不一致');
});

it('keeps not-applicable selection and purchase states distinct from unknown', () => {
 const fund=withAuditFixture({...row,symbol:'BITU',market:'US',company_name:'ProShares Ultra Bitcoin ETF'},props.date);
 render(<ResearchDetail {...props} selected={fund} method="oneil"/>);
 const eps=screen.getByText('C：四半期 EPS 前年同期比 ≥ 25%').closest('li');
 expect(eps).toHaveTextContent('対象外');
 expect(eps).not.toHaveTextContent('? 未確認');
 fireEvent.click(screen.getByRole('tab',{name:'購入条件'}));
 const selection=screen.getByText(/— 共通購入モデルへの適合/).closest('li');
 expect(selection).toHaveTextContent('対象外');
 expect(selection).not.toHaveTextContent('未確認');
 const readiness=entryReadiness(fund,props.date,props.market,props.now,'oneil');
 expect(screen.getByLabelText('価格位置と購入条件')).toHaveTextContent(`対象外 ${readiness.notApplicable}`);
 expect(screen.getByRole('heading',{name:new RegExp(`購入条件 ${readiness.passed}/${readiness.total} · 未達 ${readiness.failed} · 未確認 ${readiness.unknown}`)})).toBeInTheDocument();
});
it('moves focus from the purchase shortcut to its selected tab and supports arrow navigation', async () => {
 const onVerificationToggle=vi.fn();
 const {container}=render(<ResearchDetail {...props} selected={row} onVerificationToggle={onVerificationToggle}/>);
 fireEvent.click(container.querySelector('.readiness-chip'));
 const tab=screen.getByRole('tab',{name:'購入条件',exact:true});
 await waitFor(()=>expect(tab).toHaveFocus());
 expect(tab).toHaveAttribute('aria-selected','true');
 fireEvent.keyDown(tab,{key:'ArrowRight'});
 expect(screen.getByRole('tab',{name:'財務・機関'})).toHaveFocus();
 expect(onVerificationToggle).toHaveBeenCalledWith(row.symbol);
 fireEvent.keyDown(screen.getByRole('tab',{name:'財務・機関'}),{key:'Home'});
 expect(screen.getByRole('tab',{name:'判定根拠'})).toHaveFocus();
});
it.each([103.2,112.7])('shows the named pivot-follow source caution beside the company before the inline chart at %s',price=>{
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
it.each([[103,'minervini'],[104,'minervini2'],[104,'oneil']])('preserves the existing source-warning scope at %s for %s',(price,method)=>{
 const {container}=render(<ResearchDetail {...props} method={method} selected={{...row,current_price:price}}/>);
 expect(within(container.querySelector('.research-symbol-head')).queryByRole('note')).not.toBeInTheDocument();
});

it.each(['minervini','minervini2'])('explains the checked source and implementation boundary for %s',method=>{
 render(<ResearchDetail {...props} method={method} selected={row}/>);
 const disclosure=screen.getByText('トレンド条件の出典とアプリの近似').closest('details');
 expect(disclosure).not.toHaveAttribute('open');
 expect(disclosure).toHaveTextContent(trendTemplateSourceContext(method));
 expect(disclosure).toHaveTextContent(method==='minervini'?'PDF 151–152頁':'PDF 221–222頁');
 expect(disclosure).not.toHaveTextContent(/第[12]冊|Kindle表示/);
});
it.each(['oneil','ibd'])('keeps source disclosure scoped away from %s',method=>{
 render(<ResearchDetail {...props} method={method} selected={row}/>);
 expect(screen.queryByText('トレンド条件の出典とアプリの近似')).not.toBeInTheDocument();
});
it('explains the O’Neil source and unchanged app conditions in both evidence tabs',()=>{
 render(<ResearchDetail {...props} method="oneil" selected={row} onVerificationToggle={vi.fn()}/>);
 const source=screen.getByText('オニール財務条件の出典とアプリの範囲').closest('details');
 expect(source).not.toHaveAttribute('open');
 expect(source).toHaveTextContent(financialSourceContext('oneil'));
 expect(screen.getByRole('tabpanel')).toHaveTextContent('A：直近3年の各年 EPS 成長率 ≥ 25%（最小値）');
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 const panel=screen.getByRole('region',{name:'財務の判定根拠'});
 expect(within(panel).getByText('オニール財務条件の出典とアプリの範囲').closest('details')).toHaveTextContent(financialSourceContext('oneil'));
 expect(panel).toHaveTextContent('年率複利や加速とのOR条件へ判定を切り替えたものではありません');
});

it('keeps financial evidence inside the existing financial tab and retains the chart and entry arrangement', () => {
 const onVerificationToggle=vi.fn();
 const {container}=render(<ResearchDetail {...props} onVerificationToggle={onVerificationToggle} selected={{...row,eps_growth_yy:999,roe:999}}/>);
 const header=container.querySelector('.research-symbol-head');
 expect(header.nextElementSibling).toBe(screen.getByTestId('research-chart'));
 expect(screen.getByTestId('research-chart').nextElementSibling).toHaveClass('leader-detail-overview');
 expect(screen.getByTestId('research-chart').nextElementSibling.nextElementSibling).toContainElement(screen.getByText('アプリ設定と書籍の確認範囲'));
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
 expect(screen.getByRole('heading',{name:`選定 ${first.passed}/${first.total} · 未達 ${first.failed} · 未確認 ${first.unknown}`})).toBeInTheDocument();
 const later=financialFixtureNow+8*86400000;
 const expired=assess(current,'oneil',later);
 expect(expired.passed).toBeLessThan(first.passed);
 rerender(<ResearchDetail {...input} now={later}/>);
 expect(screen.getByRole('heading',{name:`選定 ${expired.passed}/${expired.total} · 未達 ${expired.failed} · 未確認 ${expired.unknown}`})).toBeInTheDocument();
});


it('shows both failed and unknown counts while keeping purchase readiness separate from selection', () => {
 const current=withSyntheticFinancialProof({...row,sales_growth_yy:-4});
 const input={...props,selected:current,method:'oneil',date:financialFixtureDate,now:financialFixtureNow,liveStatus:'未接続'};
 const checks=assess(current,input.method,input.now);
 const readiness=entryReadiness(current,input.date,input.market,input.now,input.method);
 expect(checks).toMatchObject({passed:1,total:8,failed:1,unknown:6,qualified:false});
 expect(readiness).toMatchObject({passed:2,total:7,failed:1,unknown:4,ready:false});
 render(<ResearchDetail {...input}/>);
 expect(screen.getByRole('heading',{name:'選定 1/8 · 未達 1 · 未確認 6'})).toBeInTheDocument();
 expect(screen.getByRole('tabpanel')).toHaveTextContent('売上高 前年同期比 ≥ 25%');
 expect(screen.getByRole('tabpanel')).toHaveTextContent('× 未達 · -4%');
 fireEvent.click(screen.getByRole('tab',{name:'購入条件'}));
 expect(screen.getByRole('heading',{name:'購入条件 2/7 · 未達 1 · 未確認 4 · 未接続'})).toBeInTheDocument();
 expect(screen.getByRole('tabpanel')).toHaveTextContent('選択中の手法とは別に、ミネルヴィニとIBD型の両方を確認');
 expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(7);
});

it('builds financial presentation only for the open financial tab and refreshes its clock context', () => {
 const build=vi.mocked(buildFinancialEvidencePresentation);build.mockClear();
 const input={...props,selected:row,version:'lazy-panel',onVerificationToggle:vi.fn()};
 const view=render(<ResearchDetail {...input}/>);
 expect(build).not.toHaveBeenCalled();
 view.rerender(<ResearchDetail {...input} method="oneil"/>);
 expect(build).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(build).toHaveBeenCalledTimes(1);
 expect(build).toHaveBeenLastCalledWith(row,{method:'oneil',date:props.date,generation:'lazy-panel',now:props.now});
 view.rerender(<ResearchDetail {...input} method="oneil" now={props.now+1000}/>);
 expect(build).toHaveBeenCalledTimes(2);
 expect(build).toHaveBeenLastCalledWith(row,{method:'oneil',date:props.date,generation:'lazy-panel',now:props.now+1000});
 fireEvent.click(screen.getByRole('tab',{name:'判定根拠'}));
 expect(build).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(build).toHaveBeenCalledTimes(3);
 const next={...input,selected:{...row,symbol:'NEXT'},date:'2026-10-02',version:'next-generation',method:'ibd',now:props.now+86400000};
 view.rerender(<ResearchDetail {...next}/>);
 expect(build).toHaveBeenCalledTimes(4);
 expect(build).toHaveBeenLastCalledWith(next.selected,{method:next.method,date:next.date,generation:next.version,now:next.now});
 fireEvent.click(screen.getByRole('tab',{name:'判定根拠'}));
 const latest={...next,selected:{...row,symbol:'LATEST'},date:'2026-10-03',version:'latest-generation',method:'minervini2',now:props.now+2*86400000};
 view.rerender(<ResearchDetail {...latest}/>);
 expect(build).toHaveBeenCalledTimes(4);
 fireEvent.click(screen.getByRole('tab',{name:'財務・機関'}));
 expect(build).toHaveBeenCalledTimes(5);
 expect(build).toHaveBeenLastCalledWith(latest.selected,{method:latest.method,date:latest.date,generation:latest.version,now:latest.now});
});
it('opens full Code33 evidence and moves keyboard focus to the book tab',async()=>{
 const onVerificationToggle=vi.fn();
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ResearchDetail {...props} selected={row} onVerificationToggle={onVerificationToggle}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'業績の全根拠を見る'}));
 await waitFor(()=>expect(screen.getByRole('tab',{name:'書籍検証'})).toHaveFocus());
 expect(onVerificationToggle).toHaveBeenCalledWith(row.symbol);
 expect(screen.getByText('業績の連続性と利益の質を確認').closest('details')).toHaveAttribute('open');
});

it.each(['VCP・形状候補','出来高','市場'])('keeps the %s gate control reference present before tab mounting and focuses selected conditions', async label => {
 const {container}=render(<ResearchDetail {...props} selected={row}/>);
 expect(document.getElementById('detail-panel-conditions')).toBeNull();
 const gate=screen.getByRole('button',{name:new RegExp(`^${label}：`)});
 const target=document.getElementById(gate.getAttribute('aria-controls'));
 expect(target).not.toBeNull();
 expect(target).toHaveAttribute('role','tablist');
 expect(target).toContainElement(screen.getByRole('tab',{name:'購入条件',exact:true}));
 fireEvent.click(gate);
 const tab=screen.getByRole('tab',{name:'購入条件',exact:true});
 await waitFor(()=>expect(tab).toHaveFocus());
 expect(tab).toHaveAttribute('aria-selected','true');
 expect(document.getElementById('detail-panel-conditions')).toBe(screen.getByRole('tabpanel'));
 for(const button of container.querySelectorAll('.leader-five-gates button[aria-controls]'))expect(document.getElementById(button.getAttribute('aria-controls'))).not.toBeNull();
});

it('keeps one overview in matching responsive DOM order without losing selected detail state',()=>{
 const input={...props,selected:row};
 const view=render(<ResearchDetail {...input}/>);
 const overview=()=>view.container.querySelector('.leader-detail-overview');
 const chart=()=>screen.getByTestId('research-chart');
 expect(chart().nextElementSibling).toBe(overview());
 expect(view.container.querySelector('.research-symbol-head')).toHaveTextContent('購入条件');
 expect(view.container.querySelector('.research-symbol-head')).toHaveTextContent('未達');
 fireEvent.click(screen.getByRole('tab',{name:'メモ'}));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'responsive evidence note'}});
 for(const [step,narrow] of [true,false,true,false].entries()){
  vi.mocked(useMediaQuery).mockReturnValue(narrow);view.rerender(<ResearchDetail {...input} now={props.now+step+1}/>);
  expect(view.container.querySelectorAll('.leader-detail-overview')).toHaveLength(1);
  expect(view.container.querySelectorAll('#leader-trend-template')).toHaveLength(1);
  expect(view.container.querySelectorAll('#research-detail-tabs')).toHaveLength(1);
  if(narrow){
   expect(overview().closest('.research-symbol-head')).not.toBeNull();
   expect(view.container.querySelector('.symbol-qualification-context')).toHaveTextContent('価格位置は購入可否と別です。');
   expect(view.container.querySelector('.symbol-qualification-context')).not.toHaveTextContent('未達');
   expect(overview().querySelector('.leader-detail-verdict')).toHaveTextContent(/未達.*未確認/);
  }
  else expect(chart().nextElementSibling).toBe(overview());
  expect(screen.getByRole('tab',{name:'メモ'})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('textbox')).toHaveValue('responsive evidence note');
  expect(overview()).toHaveTextContent('出来高比');expect(overview()).toHaveTextContent('前日比（日次）');
  expect(overview().querySelectorAll('.leader-condition-strip [data-state]')).toHaveLength(7);
 }
});
