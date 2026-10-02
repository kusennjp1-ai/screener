import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import ResearchHero from './ResearchHero';
vi.mock('./PortfolioDecision',()=>({default:()=>null}));
vi.mock('./SetupRadar',()=>({default:()=> <section aria-label="セットアップ・レーダー"/>}));
const props={rows:[],ranked:[],date:'2026-09-29',plan:{dailyPositions:[],allocationCap:0,market:{label:'市場未確認'}},workbench:{},availableSymbols:new Set()};
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('persists the compact hero choice across mounts and restores its content',()=>{
 const first=render(<ResearchHero {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'概況をたたむ'}));
 expect(localStorage.getItem('research-hero-collapsed')).toBe('true');
 expect(screen.queryByRole('region',{name:'セットアップ・レーダー'})).not.toBeInTheDocument();
 first.unmount();render(<ResearchHero {...props}/>);
 expect(screen.getByRole('button',{name:'概況を展開'})).toHaveAttribute('aria-expanded','false');
 fireEvent.click(screen.getByRole('button',{name:'概況を展開'}));
 expect(screen.getByRole('region',{name:'セットアップ・レーダー'})).toBeInTheDocument();
 expect(localStorage.getItem('research-hero-collapsed')).toBe('false');
});
it('keeps collapse usable when storage reads and writes are denied',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
 render(<ResearchHero {...props}/>);
 expect(screen.getByRole('region',{name:'セットアップ・レーダー'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'概況をたたむ'}));
 expect(screen.getByRole('button',{name:'概況を展開'})).toHaveAttribute('aria-expanded','false');
 fireEvent.click(screen.getByRole('button',{name:'概況を展開'}));
 expect(screen.getByRole('region',{name:'セットアップ・レーダー'})).toBeInTheDocument();
});
it('labels the fixed Minervini overview and never mistakes capped portfolio positions for universe counts',()=>{
 const ranked=Array.from({length:8},(_,i)=>({row:{symbol:`S${i}`,current_price:102,se_pivot_price:100,technical_audit:{valid:true}},assessment:{qualified:i<6}}));
 const plan={...props.plan,dailyPositions:[{symbol:'S0'},{symbol:'S1'}]};
 render(<ResearchHero {...props} ranked={ranked} plan={plan} method="oneil"/>);
 expect(screen.getByRole('heading',{level:1})).toHaveTextContent('選定候補は 6 銘柄。');
 expect(screen.getByText(/終値 · ミネルヴィニ概況/)).toBeInTheDocument();
 expect(screen.getByLabelText('選定から購入検討までの3段階')).toHaveTextContent('銘柄選定');
 expect(screen.getByLabelText('選定から購入検討までの3段階')).toHaveTextContent('買い位置');
 expect(screen.getByText('個別に確認')).toBeInTheDocument();
 expect(screen.queryByText('2銘柄が条件通過。')).not.toBeInTheDocument();
});
it('does not report a real candidate count while the publication is loading',()=>{
 render(<ResearchHero {...props} loading/>);
 expect(screen.getByRole('heading',{level:1})).toHaveTextContent('データを読み込み中。');
 expect(screen.getByText('日足検証 —')).toBeInTheDocument();
});
