import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';

vi.mock('./CandidateCharts',()=>({default:()=>null}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const ranked=Array.from({length:103},(_,index)=>({row:{symbol:`S${index}`,current_price:102,se_pivot_price:100,rs_rating:index},assessment:{qualified:true,passed:9,total:9}}));
const props={ranked,method:'minervini',onSelect:vi.fn()};
const sizeSelect=()=>screen.getByRole('combobox',{name:'1ページの銘柄数'});
const pageSelect=()=>screen.getByRole('combobox',{name:'候補のページ'});
const symbols=()=>screen.queryAllByRole('listitem').map(item=>item.dataset.feedSymbol);

it.each([undefined,20,50,'50','20','100','050','50.0',0,-1,NaN,null])('sanitizes size %s and mounts only its visible cards',feedSize=>{
 const size=feedSize===50||feedSize==='50'?50:20;
 render(<CandidateBoard {...props} feedSize={feedSize}/>);
 expect(sizeSelect()).toHaveValue(String(size));
 expect(symbols()).toEqual(ranked.slice(0,size).map(item=>item.row.symbol));
 expect(screen.getByRole('status')).toHaveTextContent(`全103銘柄中1–${size}`);
 expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize','103');
 expect(screen.getAllByRole('listitem').at(-1)).toHaveAttribute('aria-posinset',String(size));
});

it.each([20,50])('visits the entire 103-symbol universe once at size %s and jumps back without changing selection',feedSize=>{
 const onSelect=vi.fn();
 render(<CandidateBoard {...props} feedSize={feedSize} onSelect={onSelect} selectedSymbol="S0"/>);
 const visited=[];
 for(let start=0;start<ranked.length;start+=feedSize){
  const expected=ranked.slice(start,start+feedSize).map(item=>item.row.symbol);
  expect(symbols()).toEqual(expected);visited.push(...symbols());
  expect(screen.getByRole('status')).toHaveTextContent(`全103銘柄中${start+1}–${Math.min(start+feedSize,103)}`);
  expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-posinset',String(start+1));
  if(start+feedSize<103)fireEvent.click(screen.getByRole('button',{name:`次の${feedSize}件`}));
 }
 expect(visited).toEqual(ranked.map(item=>item.row.symbol));
 expect(screen.getByRole('button',{name:`次の${feedSize}件`})).toBeDisabled();
 fireEvent.change(pageSelect(),{target:{value:'0'}});
 expect(screen.getByRole('button',{name:/^S0 の分析/})).toHaveFocus();
 expect(screen.getByRole('button',{name:/^S0 の分析/})).toHaveAttribute('aria-current','true');
 expect(screen.getByRole('button',{name:`前の${feedSize}件`})).toBeDisabled();
 expect(onSelect).not.toHaveBeenCalled();
});

it('maps both size changes to the selected symbol even when it is off the browsed page',()=>{
 const onSelect=vi.fn(),onFeedSizeChange=vi.fn();
 render(<CandidateBoard {...props} selectedSymbol="S77" onSelect={onSelect} onFeedSizeChange={onFeedSizeChange}/>);
 expect(symbols()).not.toContain('S77');
 fireEvent.change(sizeSelect(),{target:{value:'50'}});
 expect(pageSelect()).toHaveValue('1');
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中51–100');
 expect(screen.getByRole('button',{name:/^S77 の分析/})).toHaveFocus();
 expect(screen.getByRole('button',{name:/^S77 の分析/})).toHaveAttribute('aria-current','true');
 fireEvent.change(sizeSelect(),{target:{value:'20'}});
 expect(pageSelect()).toHaveValue('3');
 expect(screen.getByRole('status')).toHaveTextContent('全103銘柄中61–80');
 expect(screen.getByRole('button',{name:/^S77 の分析/})).toHaveFocus();
 expect(onFeedSizeChange.mock.calls).toEqual([[50],[20]]);
 expect(onSelect).not.toHaveBeenCalled();
});

it('keeps a rejected controlled size request on its current page without arming later focus',()=>{
 let nextFrame;
 vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{nextFrame=callback;return 1;}));
 const onFeedSizeChange=vi.fn(),onHighlight=vi.fn();
 const {rerender}=render(<CandidateBoard {...props} feedSize={20} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange} onHighlight={onHighlight}/>);
 sizeSelect().focus();fireEvent.change(sizeSelect(),{target:{value:'50'}});
 expect(onFeedSizeChange).toHaveBeenCalledExactlyOnceWith(50);
 expect(pageSelect()).toHaveValue('0');
 expect(sizeSelect()).toHaveValue('20');
 expect(symbols()).toEqual(ranked.slice(0,20).map(item=>item.row.symbol));
 expect(sizeSelect()).toHaveFocus();
 rerender(<CandidateBoard {...props} feedSize={20} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange} onHighlight={onHighlight}/>);
 expect(pageSelect()).toHaveValue('0');
 const last=screen.getByRole('button',{name:/^S19 の分析/});
 last.focus();fireEvent.keyDown(last,{key:'ArrowDown'});nextFrame();
 expect(screen.getByRole('button',{name:/^S20 の分析/})).toHaveFocus();
 expect(pageSelect()).toHaveValue('1');
 expect(onHighlight).toHaveBeenLastCalledWith('S20');
});

it('waits for a delayed controlled size acceptance before mapping or focusing the selected symbol',()=>{
 const onFeedSizeChange=vi.fn();
 const {rerender,container}=render(<CandidateBoard {...props} feedSize={20} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange}/>);
 const scroll=container.querySelector('.candidate-scroll');scroll.scrollTop=417;
 sizeSelect().focus();fireEvent.change(sizeSelect(),{target:{value:'50'}});
 expect(pageSelect()).toHaveValue('0');expect(sizeSelect()).toHaveFocus();
 expect(scroll.scrollTop).toBe(417);
 rerender(<CandidateBoard {...props} feedSize={50} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange}/>);
 expect(pageSelect()).toHaveValue('1');
 expect(symbols()).toHaveLength(50);
 expect(screen.getByRole('button',{name:/^S77 の分析/})).toHaveFocus();
 expect(screen.getByRole('button',{name:/^S77 の分析/})).toHaveAttribute('aria-current','true');
});

it('does not steal focus after the reader moves away from a delayed size request',()=>{
 const onFeedSizeChange=vi.fn();
 const {rerender}=render(<CandidateBoard {...props} feedSize={20} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange}/>);
 sizeSelect().focus();fireEvent.change(sizeSelect(),{target:{value:'50'}});
 const sort=screen.getByRole('combobox',{name:'候補の並び順'});sort.focus();
 rerender(<CandidateBoard {...props} feedSize={50} selectedSymbol="S77" onFeedSizeChange={onFeedSizeChange}/>);
 expect(pageSelect()).toHaveValue('1');
 expect(sort).toHaveFocus();
 expect(screen.getByRole('button',{name:/^S77 の分析/})).not.toHaveFocus();
});

it('retains the current first symbol when the selection is outside the filtered set',()=>{
 const {rerender}=render(<CandidateBoard {...props} selectedSymbol="OTHER"/>);
 fireEvent.change(pageSelect(),{target:{value:'3'}});
 fireEvent.change(sizeSelect(),{target:{value:'50'}});
 expect(symbols()).toContain('S60');
 expect(pageSelect()).toHaveValue('1');
 expect(screen.getByRole('button',{name:/^S50 の分析/})).toHaveFocus();
 rerender(<CandidateBoard {...props} selectedSymbol="OTHER" feedSize={20}/>);
 expect(pageSelect()).toHaveValue('2');
 expect(symbols()).toContain('S50');
});

it('clamps the page and range when filtering shrinks the universe or leaves no matches',()=>{
 const {rerender}=render(<CandidateBoard {...props}/>);
 fireEvent.change(pageSelect(),{target:{value:'5'}});
 rerender(<CandidateBoard {...props} ranked={ranked.slice(0,21)}/>);
 expect(symbols()).toEqual(['S20']);
 expect(screen.getByRole('status')).toHaveTextContent('全21銘柄中21–21');
 rerender(<CandidateBoard {...props} ranked={[]}/>);
 expect(symbols()).toEqual([]);
 expect(screen.getByRole('status')).toHaveTextContent('全0銘柄中0–0');
 expect(pageSelect()).toBeDisabled();
 expect(screen.getByRole('button',{name:'前の20件'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'次の20件'})).toBeDisabled();
 fireEvent.change(sizeSelect(),{target:{value:'50'}});
 expect(screen.getByRole('status')).toHaveTextContent('全0銘柄中0–0');
 rerender(<CandidateBoard {...props} ranked={ranked.slice(0,2)}/>);
 expect(symbols()).toEqual(['S0','S1']);
 expect(screen.getByRole('status')).toHaveTextContent('全2銘柄中1–2');
});

it.each([20,50])('keeps arrow navigation within the complete ordering across size %s boundaries',feedSize=>{
 let nextFrame;
 vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{nextFrame=callback;return 1;}));
 const onHighlight=vi.fn(),onSelect=vi.fn();
 render(<CandidateBoard {...props} feedSize={feedSize} onHighlight={onHighlight} onSelect={onSelect}/>);
 const last=screen.getByRole('button',{name:new RegExp(`^S${feedSize-1} の分析`)});
 last.focus();fireEvent.keyDown(last,{key:'ArrowDown'});nextFrame();
 const next=screen.getByRole('button',{name:new RegExp(`^S${feedSize} の分析`)});
 expect(next).toHaveFocus();expect(onHighlight).toHaveBeenLastCalledWith(`S${feedSize}`);
 fireEvent.keyDown(next,{key:'ArrowUp'});nextFrame();
 expect(screen.getByRole('button',{name:new RegExp(`^S${feedSize-1} の分析`)})).toHaveFocus();
 expect(onHighlight).toHaveBeenLastCalledWith(`S${feedSize-1}`);
 expect(onSelect).not.toHaveBeenCalled();
});
