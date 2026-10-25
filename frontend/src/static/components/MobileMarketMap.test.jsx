import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import MobileMarketMap from './MobileMarketMap';
afterEach(cleanup);
it('aggregates only measured ratings and distinguishes qualification from the universe', () => {
 const select=vi.fn(), sector=vi.fn();
 render(<MemoryRouter><MobileMarketMap ranked={[
  {row:{symbol:'AAA',gics_sector:'Technology',rs_rating:90},assessment:{qualified:true}},
  {row:{symbol:'BBB',gics_sector:'Technology',rs_rating:null},assessment:{qualified:false}},
  {row:{symbol:'CCC',gics_sector:'Healthcare',rs_rating:0},assessment:{qualified:false}},
 ]} onSelect={select} onSector={sector} /></MemoryRouter>);
 const tile=screen.getByRole('button',{name:/情報技術/});
 expect(tile).toHaveTextContent('1 / 2 銘柄');
 expect(tile).toHaveTextContent('RS中央値 90');
 expect(screen.getByRole('button',{name:/ヘルスケア/})).toHaveTextContent('RS中央値 0');
 fireEvent.click(tile);expect(sector).toHaveBeenCalledWith('Technology');
 fireEvent.click(screen.getByRole('button',{name:'AAA のチャートを確認'}));expect(select).toHaveBeenCalledWith('AAA');
});
it('keeps missing ratings unknown and filters candidate navigation to the selected industry', () => {
 render(<MemoryRouter><MobileMarketMap ranked={[
  {row:{symbol:'UNKNOWN',gics_sector:null},assessment:{}},
  {row:{symbol:'HEALTH',gics_sector:'Healthcare',rs_rating:82.345},assessment:{}},
 ]} sector="Healthcare" onSelect={()=>{}} onSector={()=>{}} /></MemoryRouter>);
 expect(screen.getByRole('button',{name:/分類不明/})).toHaveTextContent('RS中央値 未確認');
 expect(screen.queryByRole('button',{name:'UNKNOWN のチャートを確認'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'HEALTH のチャートを確認'})).toHaveTextContent('RS 82');
});
