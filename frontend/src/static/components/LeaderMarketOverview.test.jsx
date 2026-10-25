import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,render,screen,within } from '@testing-library/react';
import ConnectedLeaderMarketOverview, { LeaderMarketOverview } from './LeaderMarketOverview';
const source=vi.hoisted(()=>({value:{},hook:vi.fn()}));
vi.mock('../useResearchBundle',()=>({useResearchBundle:(...args)=>{source.hook(...args);return source.value;}}));
afterEach(cleanup);
const counts={universe:10,selected:3,buyPositions:2,selectionUnknown:4,positionUnknown:1,notApplicable:1,verified:8,above50:4,above50Percent:50};
const summary={available:true,date:'2026-10-23',generation:'fixture-generation',method:'minervini',scope:'対象範囲（テスト専用）',market:{label:'市場は未確認'},totals:counts,sectors:[{key:'Technology',label:'情報技術',...counts}],newHighLow:{newHighs:12,newLows:30,coverage:80,universe:100},excluded:{duplicateSymbols:1,mismatchedRows:2,invalidRows:0}};
it('shows real adapter values, coverage and explicit unknowns without treating them as absent candidates',()=>{
 render(<LeaderMarketOverview summary={summary}/>);
 expect(screen.getByRole('region',{name:'LEADER市場概況'})).toHaveTextContent('確認済み買い位置 2');
 expect(screen.getByRole('article',{name:'50日線上の割合'})).toHaveTextContent('50%');
 expect(screen.getByRole('img',{name:'同日検証済み 8銘柄中、50日線上 4銘柄'}).querySelectorAll('rect')[1]).toHaveAttribute('width','120');
 expect(screen.getByRole('link',{name:/情報技術：確認済み買い位置 2/})).toHaveAttribute('href','#/?sector=Technology&view=charts&method=minervini');
 expect(screen.getByRole('region',{name:'業種別買い位置ヒートマップ'})).toHaveTextContent('未確認 4 / 価格 1');
 expect(screen.getByRole('article',{name:'新高値と新安値'})).toHaveTextContent('80 / 100');
 expect(screen.getByRole('article',{name:'分配日'})).toHaveTextContent('データなし');
 expect(screen.getByRole('region',{name:'買い位置数の推移'})).toHaveTextContent('データなし');
});
it('does not draw a 0% bar when the verification denominator is zero',()=>{
 render(<LeaderMarketOverview summary={{...summary,totals:{...counts,verified:0,above50:0,above50Percent:null},newHighLow:null}}/>);
 const card=screen.getByRole('article',{name:'50日線上の割合'});
 expect(card).toHaveTextContent('データなし');expect(within(card).queryByRole('img')).toBeNull();
 expect(screen.getByRole('article',{name:'新高値と新安値'})).toHaveTextContent('データなし');
});
it('retains observed zero counts separately from unknown selection and position',()=>{
 render(<LeaderMarketOverview summary={{...summary,totals:{...counts,buyPositions:0}}}/>);
 expect(screen.getByRole('region',{name:'LEADER市場概況'})).toHaveTextContent('確認済み買い位置 0');
 expect(screen.getByRole('region',{name:'LEADER市場概況'})).toHaveTextContent('選定未確認 4');
});
it.each([{loading:true},{error:true},{summary:{available:false,reason:'基準日不一致'}}])('withholds previous values when unavailable: %j',state=>{
 const view=render(<LeaderMarketOverview summary={summary}/>);
 view.rerender(<LeaderMarketOverview {...state}/>);
 expect(screen.queryByRole('article',{name:'50日線上の割合'})).toBeNull();
 expect(screen.queryByRole('link',{name:/情報技術：確認済み買い位置/})).toBeNull();
 expect(screen.getByRole('status')).toBeInTheDocument();
});

it('uses the pinned publication and generation, and removes the prior summary during an epoch refresh',()=>{
 const publication={mode:'content-addressed',cacheIdentity:'test-generation'},marketEntry={as_of_date:'2026-10-23',assets:{research:{path:'research.json'}},publication};
 source.value={data:{rows:[]},evaluatedNow:Date.parse('2026-10-24T00:00:00Z'),isLoading:false,isError:false};
 const view=render(<ConnectedLeaderMarketOverview marketEntry={marketEntry} generation="g1"/>);
 expect(source.hook).toHaveBeenLastCalledWith('research.json','2026-10-23','g1',publication);
 expect(screen.getByRole('article',{name:'50日線上の割合'})).toHaveTextContent('データなし');
 source.value={data:undefined,evaluatedNow:Date.parse('2026-10-24T00:00:00Z'),isLoading:true,evaluating:true};
 view.rerender(<ConnectedLeaderMarketOverview marketEntry={marketEntry} generation="g2"/>);
 expect(source.hook).toHaveBeenLastCalledWith('research.json','2026-10-23','g2',publication);
 expect(screen.queryByRole('article',{name:'50日線上の割合'})).toBeNull();
 expect(screen.getByRole('status')).toHaveTextContent('同じ公開版');
});

it('distinguishes known zero, unknown coverage and positive counts visually and accessibly',()=>{
 const sectors=[{...counts,key:'Technology',label:'情報技術',buyPositions:0,selectionUnknown:0,positionUnknown:0},{...counts,key:'Financial',label:'金融',buyPositions:0},{...counts,key:'Energy',label:'エネルギー',buyPositions:2,selectionUnknown:0,positionUnknown:0}];
 render(<LeaderMarketOverview summary={{...summary,sectors}}/>);
 const zero=screen.getByRole('link',{name:/情報技術：確認済み買い位置 0/}),unknown=screen.getByRole('link',{name:/金融：確認済み買い位置 0/}),positive=screen.getByRole('link',{name:/エネルギー：確認済み買い位置 2/});
 expect(zero).toHaveAttribute('data-observation','known-zero');expect(unknown).toHaveAttribute('data-observation','partial');expect(positive).toHaveAttribute('data-observation','observed');
 expect(unknown.querySelector('rect[fill^="url("]')).not.toBeNull();expect(zero.querySelector('rect[fill^="url("]')).toBeNull();
 expect(positive.querySelector('rect[opacity]')).toHaveAttribute('fill','var(--zone)');
 expect(screen.getByLabelText('ヒートマップの凡例')).toHaveTextContent('業種RSではありません');
});
