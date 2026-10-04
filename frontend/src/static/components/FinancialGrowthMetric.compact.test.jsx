import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import FinancialEvidenceSummary, { FinancialGrowthMetric } from './FinancialEvidenceSummary';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

vi.mock('./CandidateCharts',()=>({default:()=>null}));
afterEach(cleanup);
const row=withSyntheticFinancialProof({symbol:'COMPACT',company_name:'Synthetic compact fixture',current_price:102,se_pivot_price:100});
const context={method:'oneil',date,generation:'compact-fixture',now,symbol:row.symbol};
const evidence=buildFinancialEvidencePresentation(row,context);
const metrics=financialEvidencePresentation({...context,evidence}).rows.slice(0,2);

it('summarizes literal source metadata independently of financial condition status',()=>{
 const {rerender}=render(<FinancialGrowthMetric row={metrics[0]} compact/>);
 for(const state of ['pass','fail','unknown','reference']){
  rerender(<FinancialGrowthMetric row={{...metrics[0],state}} compact/>);
  expect(screen.getByText('提供元あり · 取得 2026-10-03')).toBeInTheDocument();
 }
 rerender(<FinancialGrowthMetric row={{...metrics[0],source:'提供元 未確認',observedAt:'取得時刻 未確認',state:'pass'}} compact/>);
 expect(screen.getByText('提供元 未確認 · 取得日 未確認')).toBeInTheDocument();
 rerender(<FinancialGrowthMetric row={{...metrics[0],source:'提供元 未確認'}} compact/>);
 expect(screen.getByText('提供元 未確認 · 取得 2026-10-03')).toBeInTheDocument();
});

it('keeps the same actual, role, condition and period while removing full supporting paragraphs from compact DOM',()=>{
 const negative={...metrics[0],actual:'−24.75%',state:'fail',comparisonLabel:'黒字減益'};
 render(<><section aria-label="feed"><FinancialGrowthMetric row={negative} compact/></section><section aria-label="detail"><FinancialGrowthMetric row={negative}/></section></>);
 const feed=screen.getByRole('region',{name:'feed'}),detail=screen.getByRole('region',{name:'detail'});
 for(const selector of ['.financial-summary-result','.financial-evidence-role','.financial-growth-condition','.financial-growth-period'])expect(feed.querySelector(selector).textContent).toBe(detail.querySelector(selector).textContent);
 expect(feed).toHaveTextContent('−24.75%');
 expect(feed).not.toHaveTextContent(negative.source);
 expect(feed).not.toHaveTextContent(negative.calculationNote);
 expect(feed.querySelector('.financial-comparison-note')).toBeNull();
 expect(detail).toHaveTextContent(negative.source);
 expect(detail).toHaveTextContent(negative.calculationNote);
 expect(detail).toHaveTextContent(negative.metric);
 expect(detail).toHaveTextContent(negative.basis);
});

it('preserves a neutral comparison actual and reference number while leaving the full explanation in detail',()=>{
 const special={...metrics[0],actual:'赤字拡大',referenceActual:'−50%（比較期の絶対値を分母とした参考値）',state:'unknown',comparisonLabel:'赤字拡大'};
 const {rerender}=render(<FinancialGrowthMetric row={special} compact/>);
 expect(screen.getByText('赤字拡大')).toBeInTheDocument();
 expect(screen.getByText('? 未確認')).toBeInTheDocument();
 expect(screen.getByText('参考計算：−50%')).toBeInTheDocument();
 expect(screen.getByText('提供元あり · 取得 2026-10-03')).toBeInTheDocument();
 expect(screen.queryByText(/比較期の絶対値を分母/)).not.toBeInTheDocument();
 rerender(<FinancialGrowthMetric row={special}/>);
 expect(screen.getByText(`参考計算：${special.referenceActual}`)).toBeInTheDocument();
 expect(screen.getByText(special.calculationNote)).toBeInTheDocument();
});

it('opens full source, acquisition, basis and rounding evidence with one real card action',()=>{
 function Flow(){
  const [selected,setSelected]=useState(false);
  return <><CandidateBoard ranked={[{row,assessment:{qualified:false,passed:5,total:8,unknown:1}}]} {...context} onSelect={()=>setSelected(true)}/>{selected&&<FinancialEvidenceSummary {...context} evidence={evidence} onNavigate={()=>{}}/>}</>;
 }
 render(<Flow/>);
 expect(screen.queryByRole('region',{name:'財務の確認状況'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'COMPACT の財務・日次根拠を見る'}));
 const detail=screen.getByRole('region',{name:'財務の確認状況'});
 for(const metric of metrics){
  const node=detail.querySelector(`[data-metric="${metric.id}"]`);
  expect(node).toHaveTextContent(metric.source);
  expect(node).toHaveTextContent('取得 2026-10-03 11:00 UTC');
  expect(node).toHaveTextContent(metric.metric);
  expect(node).toHaveTextContent(metric.basis);
  expect(node).toHaveTextContent(metric.calculationNote);
  expect(within(node).getByRole('button')).toHaveStyle({minHeight:'44px'});
 }
});
