import { screen,fireEvent,within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SectorStrength from './SectorStrength';
const makeGroup=(key,label,value,pass,total,unknown=0)=>({key,label,etf:key==='Energy'?'XLE':'XLK',relative:{63:{value},126:{value:value==null?null:value-15}},momentum21:{value:101},rates:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(m=>[m,{pass,total,unknown,percent:total?pass/total*100:null}])),small:total<10});
const groups=[makeGroup('Unknown','分類不明',null,0,4,4),makeGroup('Technology','情報技術',99,3,10,2),makeGroup('Energy','エネルギー',113,2,20)];
vi.mock('../useWorkbench',()=>({useWorkbench:()=>({data:{sectors:{groups,source:'fixture'}}})}));
it('puts relative strength, missing data and candidate navigation in compact ranked rows',()=>{
 renderWithProviders(<SectorStrength entry={{}}/>);
 expect(screen.getByRole('heading',{name:'追い風はエネルギー。'})).toBeInTheDocument();
 const list=screen.getByRole('list',{name:'相対指数順の業種一覧'});
 const links=within(list).getAllByRole('link');expect(links[0]).toHaveAccessibleName(/1位、エネルギー、相対指数 113.0/);
 expect(links[2]).toHaveAccessibleName(/相対指数 —.*未確認 4/);
 expect(links[1]).toHaveAttribute('href','#/?sector=Technology&view=charts&method=minervini');
 fireEvent.change(screen.getByRole('combobox',{name:'選定方式'}),{target:{value:'oneil'}});
 expect(links[1]).toHaveAttribute('href','#/?sector=Technology&view=charts&method=oneil');
 fireEvent.click(screen.getByRole('button',{name:'表',exact:true}));
 expect(screen.getByRole('table',{name:'業種の相対強度一覧'})).toHaveTextContent('3 / 10 · 未確認2');
});
