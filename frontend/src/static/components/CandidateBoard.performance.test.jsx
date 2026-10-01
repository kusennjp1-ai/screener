import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import { entryPlan } from '../researchEngine';
vi.mock('../researchEngine',async()=>{const actual=await vi.importActual('../researchEngine');return {...actual,entryPlan:vi.fn(actual.entryPlan)};});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});

it('calculates only visible rank plans, keeps the full sort universe and reuses unchanged row plans',()=>{
 const ranked=Array.from({length:103},(_,index)=>({row:{symbol:`S${index}`,current_price:102,se_pivot_price:100,rs_rating:index,se_volume_vs_50d:1.5},assessment:{qualified:true,passed:9,total:9}}));
 const props={ranked,method:'minervini',onSelect:vi.fn(),onMove:vi.fn()};
 const {rerender}=render(<CandidateBoard {...props}/>);
 expect(entryPlan).toHaveBeenCalledTimes(50);
 expect(screen.getAllByRole('listitem')).toHaveLength(50);
 expect(screen.getByRole('heading',{name:'候補リスト 103件'})).toBeInTheDocument();
 rerender(<CandidateBoard {...props} selectedSymbol="S1"/>);
 expect(entryPlan).toHaveBeenCalledTimes(50);
 fireEvent.click(screen.getByRole('button',{name:'RSで並べ替え'}));
 expect(entryPlan).toHaveBeenCalledTimes(153);
 expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('S102');
 fireEvent.click(screen.getByRole('button',{name:'次の50件'}));
 expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('S52');
 expect(entryPlan).toHaveBeenCalledTimes(153);
});
it('keeps keyboard focus when crossing both directions at a 50-row boundary in a 501-row universe',()=>{
 const ranked=Array.from({length:501},(_,index)=>({row:{symbol:`S${index}`,current_price:102,se_pivot_price:100,rs_rating:90},assessment:{qualified:true,passed:9,total:9}}));
 const onSelect=vi.fn();let nextFrame;
 vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{nextFrame=callback;return 1;}));
 render(<CandidateBoard ranked={ranked} method="minervini" onSelect={onSelect}/>);
 const last=screen.getByRole('button',{name:/^S49 の分析/});last.focus();
 fireEvent.keyDown(last,{key:'ArrowDown'});
 expect(onSelect).toHaveBeenLastCalledWith('S50');
 const first=screen.getByRole('button',{name:/^S50 の分析/});
 expect(last).not.toBeInTheDocument();
 nextFrame();expect(first).toHaveFocus();
 fireEvent.keyDown(first,{key:'ArrowUp'});
 expect(onSelect).toHaveBeenLastCalledWith('S49');
 nextFrame();expect(screen.getByRole('button',{name:/^S49 の分析/})).toHaveFocus();
 expect(screen.getByRole('heading',{name:'候補リスト 501件'})).toBeInTheDocument();
});
