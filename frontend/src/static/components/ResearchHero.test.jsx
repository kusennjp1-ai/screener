import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import ResearchHero from './ResearchHero';
import { readFileSync } from 'node:fs';
import registry from '../../../contracts/financial_instrument_applicability_v1.json';
import { CHANGE_LABELS } from '../candidateHistory';
import { useWorkbenchDetails } from '../useWorkbench';
vi.mock('./PortfolioDecision',()=>({default:()=>null}));
vi.mock('./SetupRadar',()=>({default:()=> <section aria-label="セットアップ・レーダー"/>}));
vi.mock('../useWorkbench',()=>({useWorkbenchDetails:vi.fn(()=>({isLoading:true}))}));
const props={rows:[],ranked:[],date:'2026-09-29',plan:{dailyPositions:[],allocationCap:0,market:{label:'市場未確認'}},workbench:{},availableSymbols:new Set()};
const counts=extra=>({...Object.fromEntries(Object.keys(CHANGE_LABELS).map(key=>[key,0])),...extra});
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();});
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
it('groups daily changes with the portfolio action while retaining the full desktop counts',()=>{
 const workbench={data:{history:{previous_as_of:'2026-09-28'},changes:{minervini:{counts:counts({new:7,returned:2,dropped:3})}}}};
 render(<ResearchHero {...props} workbench={workbench} method="minervini"/>);
 const trigger=screen.getByRole('button',{name:'候補の日次変化'});
 expect(trigger.closest('.hero-actions')).not.toBeNull();
 expect(trigger.querySelector('.changes-desktop')).toHaveTextContent('新たに通過 7 · 再通過 2 · 脱落 3');
 expect(screen.getByRole('link',{name:'業種の追い風を見る →'}).closest('.overview-market')).not.toBeNull();
});
it('shows comparison coverage from summary counts and loads explanations only when opened',()=>{
 const workbench={data:{history:{previous_as_of:'2026-09-28'},changes:{minervini:{counts:counts({incomparable:2430}),item_count:2430}}}};
 const {rerender}=render(<ResearchHero {...props} workbench={workbench} method="minervini"/>);
 const trigger=screen.getByRole('button',{name:'候補の日次変化'});
 expect(trigger.querySelector('.changes-desktop')).toHaveTextContent('変化：全2430銘柄が比較不能');
 expect(trigger).not.toHaveTextContent('新たに通過 0');
 expect(useWorkbenchDetails).not.toHaveBeenCalled();
 rerender(<ResearchHero {...props} workbench={{data:{...workbench.data,changes:{minervini:{counts:counts({new:2,unchanged:10,incomparable:5}),item_count:17}}}}} method="minervini"/>);
 expect(trigger.querySelector('.changes-desktop')).toHaveTextContent('変化：比較不能 5 / 17銘柄');
 expect(useWorkbenchDetails).not.toHaveBeenCalled();
 fireEvent.click(trigger);
 expect(useWorkbenchDetails).toHaveBeenCalledWith(expect.any(Object),true);
 expect(screen.getByRole('dialog',{name:'候補の日次変化'})).toBeInTheDocument();
});
it('does not display zero counts for a missing per-method summary',()=>{
 render(<ResearchHero {...props} workbench={{data:{history:{previous_as_of:'2026-09-28'},changes:{}}}} method="minervini"/>);
 expect(screen.getByRole('button',{name:'候補の日次変化'})).toHaveTextContent('変化：集計未取得');
});
it('separates compact desktop stages while retaining the mobile three-column spacing',()=>{
 const overviewStyles=readFileSync('src/static/components/researchOverview.css','utf8');
 const [desktop,mobile]=overviewStyles.split('@media (max-width:700px)');
 expect(desktop).toMatch(/\.research-overview\.hero-collapsed \.overview-steps \{[^}]*gap:20px/);
 expect(mobile).toMatch(/\.research-overview\.hero-collapsed \.overview-steps \{[^}]*gap:0/);
});
it('keeps both overview actions at 44px without inherited margins and clears the sticky header on focus scroll',()=>{
 const overviewStyles=readFileSync('src/static/components/researchOverview.css','utf8');
 const [desktop]=overviewStyles.split('@media (max-width:700px)');
 expect(desktop).toMatch(/\.research-overview \.hero-actions button \{[^}]*min-height:44px;[^}]*margin:0;[^}]*scroll-margin-top:64px;/);
 expect(desktop).not.toMatch(/\.research-overview \.hero-actions \.changes-trigger \{[^}]*min-height:24px/);
});
it('gives the market link a full touch target and sticky-header focus clearance',()=>{
 const styles=readFileSync('src/static/components/researchOverview.css','utf8');
 expect(styles).toMatch(/\.overview-market a \{[^}]*min-height:44px;[^}]*scroll-margin-top:64px;/);
 expect(styles).toMatch(/@media \(min-width:701px\) \{\s*\.research-hero\.research-overview:not\(\.hero-collapsed\) \{ padding-block:8px 20px;/);
});
it('opens daily changes from the keyboard and restores the trigger after Escape and Close',async()=>{
 const user=userEvent.setup();
 render(<ResearchHero {...props}/>);
 const trigger=screen.getByRole('button',{name:'候補の日次変化'});
 expect(trigger).toHaveAttribute('aria-haspopup','dialog');
 expect(trigger).toHaveAttribute('aria-expanded','false');
 trigger.focus();
 await user.keyboard('{Enter}');
 expect(await screen.findByRole('dialog',{name:'候補の日次変化'})).toBeInTheDocument();
 expect(trigger).toHaveAttribute('aria-expanded','true');
 await user.keyboard('{Escape}');
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'候補の日次変化'})).not.toBeInTheDocument());
 expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(trigger).toHaveFocus();
 await user.keyboard('{Enter}');
 expect(await screen.findByRole('dialog',{name:'候補の日次変化'})).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'候補の変化を閉じる'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'候補の日次変化'})).not.toBeInTheDocument());
 expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(trigger).toHaveFocus();
});

it('keeps the price and financial universes with all verified exclusions in the market summary',()=>{
 const rows=[{symbol:'COMPANY',market:'US',current_price:100,adv_usd:3e7},...registry.records.map(record=>({symbol:record.symbol,company_name:record.name,market:record.market,current_price:100,adv_usd:3e7}))];
 render(<ResearchHero {...props} rows={rows}/>);
 const scope=screen.getByText(/価格・流動性対象 4件/);
 expect(scope).toHaveTextContent('企業財務判定の対象 1件');
 expect(scope).toHaveTextContent('確認済みファンド BITU・SBIT・ETHE は対象外');
 expect(scope).toHaveClass('overview-universe');
 expect(scope).not.toHaveClass('hero-subtitle');
 expect(scope.closest('.overview-market')).not.toBeNull();
 expect(screen.getByRole('link',{name:'業種の追い風を見る →'})).toBeInTheDocument();
});
