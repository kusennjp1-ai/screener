import { describe,it,expect,vi,afterEach } from 'vitest';
import { fireEvent,render,screen,cleanup,act } from '@testing-library/react';
import { HistoricalBreadth,SectorRankHistory } from './MarketHistoryExplorer';
import { historyWindow } from '../marketLongHistory';
const symbols=['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY'];
const history={as_of_date:'2026-10-23',universe:{symbols:Array.from({length:100},(_,i)=>`S${i}`)},retrieved_at:'2026-10-27',breadth:[{date:'2024-10-23',leaderCount:15,coverage:100,eligibleUniverse:100},{date:'2025-10-23',leaderCount:21,coverage:100,eligibleUniverse:100},{date:'2026-10-23',leaderCount:34,coverage:100,eligibleUniverse:100}],sectorRotation:{frames:['2025-10-23','2026-04-23','2026-10-23'].map((date,i)=>({date,ranks:symbols.map((symbol,j)=>({symbol,rank:j+1,relativeIndex:111-j-i}))}))}};
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('long market history controls',()=>{
 it('uses calendar-month ranges including leap years and removes future records',()=>{
  expect(historyWindow([{date:'2024-02-28'},{date:'2024-02-29'},{date:'2025-02-28'},{date:'2025-03-01'}],12,'2025-02-28').map(p=>p.date)).toEqual(['2024-02-28','2024-02-29','2025-02-28']);
  expect(historyWindow(history.breadth,24,'2026-10-23')).toHaveLength(3);
 });
 it('shows actual two-year history, labels price-only leaders and retains unknowns',()=>{
  render(<HistoricalBreadth history={history}/>);
  fireEvent.click(screen.getByRole('button',{name:'2年'}));
  expect(screen.getByRole('img',{name:/先導株数.*の長期推移/})).toHaveAccessibleName(/2024-10-23から2026-10-23/);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'0'}});
  expect(screen.getByText('15銘柄')).toBeInTheDocument();
  expect(screen.getByText(/過去の決算・財務条件や買い位置を復元した選定数ではありません/)).toBeInTheDocument();
 });
 it('starts paused, plays oldest to newest and scrubbing pauses',()=>{
  vi.useFakeTimers();render(<SectorRankHistory history={history}/>);
  expect(screen.getByRole('button',{name:'▶ 再生'})).toHaveAttribute('aria-pressed','false');
  fireEvent.click(screen.getByRole('button',{name:'▶ 再生'}));
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext','2025-10-23');
  act(()=>vi.advanceTimersByTime(400));
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext','2026-04-23');
  fireEvent.change(screen.getByRole('slider'),{target:{value:'0'}});
  expect(screen.getByRole('button',{name:'▶ 再生'})).toHaveAttribute('aria-pressed','false');
 });
 it('does not invent ranks in incomplete frames',()=>{
  render(<SectorRankHistory history={{...history,sectorRotation:{frames:[{date:'2026-10-23',ranks:[]}]}}}/>);
  expect(screen.getByText('この日の11セクターすべてを確認できません。')).toBeInTheDocument();
 });
 it('uses the same bar length for tied ranks',()=>{
  render(<SectorRankHistory history={{...history,sectorRotation:{frames:[{date:'2026-10-23',ranks:symbols.map(symbol=>({symbol,rank:1,relativeIndex:100}))}]}}}/>);
  expect([...document.querySelectorAll('.sector-rank-track i')].map(node=>node.style.width)).toEqual(Array(11).fill('100%'));
 });
 it('switches two-year industry breadth without replacing a missing industry observation with zero',()=>{
  render(<HistoricalBreadth history={{...history,sectorBreadth:[{sector:'Technology',points:history.breadth.map(row=>({...row,leaderCount:row.date==='2024-10-23'?null:8}))}]}}/>);
  fireEvent.click(screen.getByRole('button',{name:'2年'}));fireEvent.change(screen.getByRole('combobox'),{target:{value:'Technology'}});
  fireEvent.change(screen.getByRole('slider'),{target:{value:'0'}});
  expect(screen.getByText('未確認',{selector:'b'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'4%騰落・10日レシオ'}));expect(screen.getByRole('combobox')).toHaveValue('all');
 });
});
