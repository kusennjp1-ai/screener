import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import { entryPlan } from '../researchEngine';
vi.mock('../researchEngine',async()=>{const actual=await vi.importActual('../researchEngine');return {...actual,entryPlan:vi.fn(actual.entryPlan)};});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});

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

it.each([[true,0],[true,.578125],[false,0]])('explicit pagination focuses the first row without selecting it, with mobile=%s and fractional offset=%s',(mobile,fraction)=>{
 const ranked=Array.from({length:101},(_,index)=>({row:{symbol:`S${index}`,current_price:102,se_pivot_price:100,rs_rating:90},assessment:{qualified:true,passed:9,total:9}}));
 const onSelect=vi.fn(),scrollTo=vi.fn();
 vi.stubGlobal('scrollTo',scrollTo);vi.stubGlobal('scrollY',1000);vi.stubGlobal('innerHeight',900);
 vi.stubGlobal('innerWidth',mobile?390:1440);
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){
  if(this.classList.contains('leader-header'))return {top:0,bottom:mobile?48:56,height:mobile?48:56};
  if(this.classList.contains('candidate-row'))return {top:mobile?-100:500,bottom:mobile?-30:551,height:mobile?70:51};
  if(this.classList.contains('candidate-board-heading'))return {top:mobile?-136+fraction:464,bottom:mobile?-100:500,height:36};
  return {top:0,bottom:0,height:0};
 });
 const {container}=render(<><header className="leader-header"/><CandidateBoard ranked={ranked} method="minervini" onSelect={onSelect}/></>);
 const scroll=container.querySelector('.candidate-scroll');scroll.scrollTop=1500;
 fireEvent.click(screen.getByRole('button',{name:'次の50件'}));
 expect(screen.getByRole('button',{name:/^S50 の分析/})).toHaveFocus();
 expect(scroll.scrollTop).toBe(0);expect(onSelect).not.toHaveBeenCalled();
 if(mobile)expect(scrollTo).toHaveBeenLastCalledWith({top:816,behavior:'instant'});
 else expect(scrollTo).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'次の50件'}));
 expect(screen.getAllByRole('listitem')).toHaveLength(1);
 expect(screen.getByRole('button',{name:/^S100 の分析/})).toHaveFocus();
 fireEvent.click(screen.getByRole('button',{name:'前の50件'}));
 expect(screen.getAllByRole('listitem')).toHaveLength(50);
 expect(screen.getByRole('button',{name:/^S50 の分析/})).toHaveFocus();
 expect(onSelect).not.toHaveBeenCalled();
});
