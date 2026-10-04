import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import * as financialPresentation from '../financialEvidencePresentation';
import { assess } from '../researchEngine';
import { withAuditFixture } from '../testAuditFixture';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

vi.mock('./CandidateCharts',()=>({default:()=>null}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const row=withSyntheticFinancialProof({symbol:'FEED',company_name:'Synthetic feed fixture',current_price:102,se_pivot_price:100});
const props={ranked:[{row,assessment:{qualified:false,passed:5,total:8,unknown:1}}],method:'oneil',date,generation:'feed-fixture',now,onSelect:vi.fn()};

it('shows actual, condition, required role, source and period beside independent selection and daily lanes',()=>{
 render(<CandidateBoard {...props}/>);
 const card=screen.getByRole('article');
 for(const text of ['成長の裏付け','30%','40%','≥ 25%','2026-06-30','提供元あり','取得 2026-10-03','必須','手法の選定','日次 未確認'])expect(card).toHaveTextContent(text);
 expect(card).not.toHaveTextContent('元の計算結果を小数第2位に丸めています');
 expect(card).not.toHaveTextContent('yfinance');
 expect(card.querySelector('.feed-growth').closest('details')).toBeNull();
 expect(screen.getByRole('button',{name:/^FEED の分析/})).not.toHaveTextContent('成長率 未確認');
});

it('never replaces missing, expired or wrong-symbol evidence with raw scalar growth',()=>{
 const {rerender}=render(<CandidateBoard {...props} now={now+8*86400000}/>);
 expect(screen.getByRole('article')).not.toHaveTextContent('30%');
 expect(screen.getByRole('article')).toHaveTextContent('? 未確認');
 const mismatched={...row,financial_current:{...row.financial_current,s:'OTHER'}};
 rerender(<CandidateBoard {...props} ranked={[{...props.ranked[0],row:mismatched}]}/>);
 expect(screen.getByRole('article')).not.toHaveTextContent('30%');
});

it('shows a fresh loss comparison as neutral context while the ordinary growth condition stays unknown',()=>{
 const special=withSyntheticFinancialProof({...row,eps_growth_yy:50});
 special.financial_current.r=special.financial_current.r.slice(0,1)+'f'+special.financial_current.r.slice(2);
 special.financial_current.p[1][6]='l';
 const {rerender}=render(<CandidateBoard {...props} ranked={[{...props.ranked[0],row:special}]}/>);
 const eps=screen.getByRole('article').querySelector('.financial-growth-metric');
 expect(eps).toHaveAttribute('data-state','unknown');
 expect(eps).toHaveTextContent('赤字縮小');
 expect(eps).toHaveTextContent('参考計算：50%');
 expect(eps).not.toHaveTextContent('比較期の絶対値を分母');
 expect(eps).toHaveTextContent('提供元あり · 取得 2026-10-03');
 expect(eps).not.toHaveTextContent('過去');
 expect(eps).not.toHaveTextContent('✓ 通過');
 rerender(<CandidateBoard {...props} now={now+8*86400000} ranked={[{...props.ranked[0],row:special}]}/>);
 expect(screen.getByRole('article')).not.toHaveTextContent('赤字縮小');
 expect(screen.getByRole('article')).not.toHaveTextContent('50%');
});

it('uses one lazy dated SVG and sibling watch/chart actions, falling back when the asset fails',()=>{
 const trace={status:'available',src:'price-traces/fixture/FEED.svg',asOfDate:date,caption:`終値 · 直近63日足 · 2026-07-07〜${date}`};
 const onWatch=vi.fn(),onCompare=vi.fn();
 render(<CandidateBoard {...props} ranked={[{...props.ranked[0],row:{...row,priceTrace:trace}}]} watch={[]} onWatch={onWatch} onCompare={onCompare}/>);
 const traceImage=screen.getByRole('img',{name:/FEED 終値/});
 expect(traceImage).toHaveAttribute('loading','lazy');
 expect(traceImage).toHaveAttribute('width','360');
 expect(traceImage).toHaveAttribute('height','64');
 expect(screen.getByRole('article').querySelector('button button')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'FEED ウォッチに保存'}));
 expect(onWatch).toHaveBeenCalledWith('FEED');
 fireEvent.click(screen.getByRole('button',{name:'FEED のチャートを開く'}));
 expect(onCompare).toHaveBeenCalledWith('FEED');
 fireEvent.error(traceImage);
 expect(screen.queryByRole('img',{name:/FEED 終値/})).not.toBeInTheDocument();
 expect(within(screen.getByRole('article')).getByText('価格推移 未確認')).toBeInTheDocument();
});


it('reuses visible-page financial presentation through live ticks and rebuilds when the guarded epoch expires',()=>{
 const build=vi.spyOn(financialPresentation,'buildFinancialEvidencePresentation');
 const {rerender}=render(<CandidateBoard {...props} financialEpoch={now}/>);
 expect(build).toHaveBeenCalledTimes(1);
 rerender(<CandidateBoard {...props} selectedSymbol="FEED" now={now+15000} financialEpoch={now}/>);
 expect(build).toHaveBeenCalledTimes(1);
 rerender(<CandidateBoard {...props} now={now+8*86400000} financialEpoch={now+8*86400000}/>);
 expect(build).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('article')).not.toHaveTextContent('30%');
});


it('uses the guarded financial epoch for the one-missing-condition label despite a later ambient clock',()=>{
 const candidate=withSyntheticFinancialProof(withAuditFixture({...row,rs_rating:79,market_above_50dma:true,market_above_200dma:true,
  financial_history:{symbol:'FEED',as_of_date:date,retrieved_at:'2026-10-03T11:00:00Z',status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic reported EPS',annual:[2022,2023,2024,2025].map((year,index)=>({end:`${year}-12-31`,eps:2**index})),quarterly:[]},
  institutional_evidence:{symbol:'FEED',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[{period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},{period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'}]},
 },date));
 const assessment=assess(candidate,'oneil',now);
 expect(assessment).toMatchObject({passed:7,total:8,unknown:0});
 const future=now+8*86400000;
 vi.spyOn(Date,'now').mockReturnValue(future);
 expect(assess(candidate,'oneil').unknown).toBeGreaterThan(1);
 const {rerender}=render(<CandidateBoard {...props} nearOnly financialEpoch={now} ranked={[{row:candidate,assessment}]}/>);
 expect(screen.getByRole('article').querySelector('.feed-missing')).toHaveTextContent('未達：RS ≥ 80');
 expect(screen.getByRole('article').querySelector('[data-metric="eps_growth_yy"]')).toHaveTextContent('30%');
 rerender(<CandidateBoard {...props} nearOnly now={future} financialEpoch={future} ranked={[{row:candidate,assessment:assess(candidate,'oneil',future)}]}/>);
 expect(screen.getByRole('article').querySelector('.feed-missing')).toHaveTextContent('判定資料を再確認');
 expect(screen.getByRole('article').querySelector('[data-metric="eps_growth_yy"]')).not.toHaveTextContent('30%');
});

it('reads core growth evidence before technical status, the price trace and calculation notes',()=>{
 render(<CandidateBoard {...props}/>);
 const card=screen.getByRole('article');
 const growth=card.querySelector('.feed-growth');
 for(const supporting of [card.querySelector('.feed-status-lanes'),card.querySelector('.feed-price-trace')])expect(growth.compareDocumentPosition(supporting)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 for(const metric of card.querySelectorAll('[data-metric]')){
  const condition=metric.querySelector('.financial-growth-condition');
  for(const note of metric.querySelectorAll('.financial-comparison-note'))expect(condition.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metric.querySelector('.financial-growth-period')).toBeVisible();
  expect(metric.querySelector('.financial-growth-source')).toBeVisible();
 }
});
