import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import { entryPlan } from '../researchEngine';
vi.mock('../researchEngine',async()=>{const actual=await vi.importActual('../researchEngine');return {...actual,entryPlan:vi.fn(actual.entryPlan)};});
afterEach(()=>{cleanup();vi.clearAllMocks();});

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
