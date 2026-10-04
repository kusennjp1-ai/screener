import { screen,fireEvent,within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SectorStrength from './SectorStrength';
import { withAuditFixture } from '../testAuditFixture';
import { FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date } from '../testFinancialFixture';
let currentBundle;
vi.mock('../dataClient',()=>({useStaticManifest:()=>({data:{research_generation:'g1'}})}));
vi.mock('../useResearchBundle',()=>({useResearchBundle:()=>currentBundle}));
beforeEach(()=>{currentBundle={data:{date,rows:[{symbol:'UNVERIFIED',market:'US',current_price:20,adv_usd:3e7,gics_sector:'Unknown'},withAuditFixture({symbol:'TECH',market:'US',current_price:20,adv_usd:3e7,gics_sector:'Technology',rs_rating:90},date)]},evaluatedNow:now};});
const makeGroup=(key,label,value,pass,total,unknown=0)=>({key,label,etf:key==='Energy'?'XLE':'XLK',relative:{63:{value},126:{value:value==null?null:value-15}},momentum21:{value:101},rates:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(m=>[m,{pass,total,unknown,percent:total?pass/total*100:null}])),small:total<10});
const groups=[makeGroup('Unknown','分類不明',null,0,4,4),makeGroup('Technology','情報技術',99,3,10,2),makeGroup('Energy','エネルギー',113,2,20)];
vi.mock('../useWorkbench',()=>({useWorkbench:()=>({data:{sectors:{groups,source:'fixture'}}})}));
it('puts relative strength, missing data and candidate navigation in compact ranked rows',()=>{
 renderWithProviders(<SectorStrength entry={{}}/>);
 expect(screen.getByRole('heading',{name:'追い風はエネルギー。'})).toBeInTheDocument();
 const list=screen.getByRole('list',{name:'相対指数順の業種一覧'});
 const links=within(list).getAllByRole('link');expect(links[0]).toHaveAccessibleName(/1位、エネルギー、相対指数 113.0/);
 expect(links[2]).toHaveAccessibleName(/相対指数 —.*未確認 1/);
 expect(links[1]).toHaveAttribute('href','#/?sector=Technology&view=charts&method=minervini');
 fireEvent.change(screen.getByRole('combobox',{name:'選定方式'}),{target:{value:'oneil'}});
 expect(links[1]).toHaveAttribute('href','#/?sector=Technology&view=charts&method=oneil');
 fireEvent.click(screen.getByRole('button',{name:'表',exact:true}));
 expect(screen.getByRole('table',{name:'業種の相対強度一覧'})).toHaveTextContent('0 / 1 · 未確認1');
});

it('withholds published pass counts while the current financial evaluation expires or reloads',()=>{
 const {rerender}=renderWithProviders(<SectorStrength entry={{}}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'選定方式'}),{target:{value:'oneil'}});
 expect(screen.getByRole('link',{name:/情報技術、相対指数/})).toHaveAccessibleName(/条件通過 0 \/ 1、未確認 1/);
 currentBundle={data:undefined,evaluatedNow:now+8*86400000,evaluating:true};
 rerender(<SectorStrength entry={{}}/>);
 expect(screen.getByRole('link',{name:/情報技術、相対指数/})).toHaveAccessibleName(/現在の条件通過率は未確認/);
 expect(screen.getByRole('status')).toHaveTextContent('現在の財務根拠を再確認');
 expect(screen.queryByRole('img',{name:/通過3、全対象10/})).not.toBeInTheDocument();
});
