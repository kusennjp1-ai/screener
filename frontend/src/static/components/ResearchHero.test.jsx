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
