import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CandidateBoard from './CandidateBoard';
import FinancialEvidenceSummary from './FinancialEvidenceSummary';
import ResearchDecisionStatus from './ResearchDecisionStatus';
import { assess, entryPlan } from '../researchEngine';
import { entryReadiness } from '../entryReadiness';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../financialEvidencePresentation';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

vi.mock('./CandidateCharts',()=>({default:()=>null}));
afterEach(cleanup);
const market={cap:.5,label:'市場確認'};
const row=withSyntheticFinancialProof({symbol:'STATUS',current_price:102,se_pivot_price:100});
const generation='decision-fixture';

it.each(['minervini','minervini2','oneil','ibd'])('keeps canonical %s counts, annual state and price meaning aligned across card and detail',method=>{
 const assessment=assess(row,method,now);
 const readiness=entryReadiness(row,date,market,now,method);
 const plan=entryPlan(row,null,method);
 const evidence=buildFinancialEvidencePresentation(row,{method,date,generation,now});
 const annual=financialEvidencePresentation({evidence,symbol:row.symbol,method,date,generation,now}).rows.find(metric=>metric.id==='annual_eps_growth_3y');
 render(<><CandidateBoard ranked={[{row,assessment}]} {...{method,date,generation,now,market}} onSelect={()=>{}}/><div data-testid="selected"><FinancialEvidenceSummary {...{evidence,method,date,generation,now}} symbol={row.symbol} decision={{assessment,readiness,plan}} onNavigate={()=>{}}/></div></>);
 const card=screen.getByRole('article');
 const detail=screen.getByTestId('selected');
 const cardDecision=card.querySelector('.research-decision-status');
 const detailDecision=detail.querySelector('.research-decision-status');
 for(const [check,label,source] of [['selection','選定条件',assessment],['daily','日次確認',readiness]]){
  const selector=`[data-check="${check}"]`;
  const compact=cardDecision.querySelector(selector),full=detailDecision.querySelector(selector);
  expect(compact.dataset.state).toBe(full.dataset.state);
  for(const node of [compact,full]){
   expect(node).toHaveTextContent(`${label} ${source.passed}/${source.total}`);
   expect(node).toHaveTextContent(`未達 ${source.failed} · 未確認 ${source.unknown}`);
  }
 }
 const compactPrice=cardDecision.querySelector('[data-check="price"]'),fullPrice=detailDecision.querySelector('[data-check="price"]');
 expect(compactPrice).toHaveTextContent('価格位置');
 expect(compactPrice.querySelector('strong').textContent).toBe(fullPrice.querySelector('strong').textContent);
 expect(cardDecision.querySelector('.feed-price-model')).toHaveTextContent(`価格位置 · アプリ 0〜+${plan.zone}%`);
 expect(cardDecision.querySelector('[data-check="selection"]')).toHaveTextContent(`選定条件 ${assessment.passed}/${assessment.total}`);
 expect(cardDecision.querySelector('[data-check="selection"]')).toHaveTextContent(`未達 ${assessment.failed} · 未確認 ${assessment.unknown}`);
 expect(cardDecision.querySelector('[data-check="daily"]')).toHaveTextContent(`日次確認 ${readiness.passed}/${readiness.total}`);
 expect(cardDecision.querySelector('[data-check="daily"]')).toHaveTextContent(`未達 ${readiness.failed} · 未確認 ${readiness.unknown}`);
 expect(cardDecision.compareDocumentPosition(card.querySelector('.feed-growth'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(detailDecision.compareDocumentPosition(detail.querySelector('.financial-evidence-summary'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 if(annual.required){
  expect(cardDecision.querySelector('.decision-annual')).toHaveAttribute('data-state',annual.state);
  expect(cardDecision.querySelector('.decision-annual')).toHaveTextContent('必須 年次EPS 未確認');
  expect(detailDecision.querySelector('.decision-annual').textContent).toBe(cardDecision.querySelector('.decision-annual').textContent);
  expect(card.querySelector('.feed-next-check')).toHaveTextContent('年次EPS：未確認');
 }else{
  expect(cardDecision.querySelector('.decision-annual')).toBeNull();
  expect(detailDecision.querySelector('.decision-annual')).toBeNull();
  expect(card.querySelector('.feed-next-check')).not.toHaveTextContent('年次EPS');
 }
});

it.each([[1,2,4,8,'pass','通過'],[1,1,1,1,'fail','未達']])('shows the canonical required annual result for reported history %s',(...args)=>{
 const expectedState=args[4],label=args[5];
 const current={...row,financial_history:{symbol:row.symbol,as_of_date:date,retrieved_at:'2026-10-03T11:00:00Z',status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic reported EPS',annual:[2022,2023,2024,2025].map((year,index)=>({end:`${year}-12-31`,eps:args[index]})),quarterly:[]}};
 const method='oneil';
 const evidence=buildFinancialEvidencePresentation(current,{method,date,generation,now});
 const annual=financialEvidencePresentation({evidence,history:current.financial_history,symbol:row.symbol,method,date,generation,now}).rows.find(metric=>metric.id==='annual_eps_growth_3y');
 expect(annual.state).toBe(expectedState);
 render(<CandidateBoard ranked={[{row:current,assessment:assess(current,method,now)}]} {...{method,date,generation,now,market}} onSelect={()=>{}}/>);
 expect(screen.getByRole('article').querySelector('.decision-annual')).toHaveTextContent(`必須 年次EPS ${label}`);
});

it('shows complete counts and does not turn absent daily context into zero unresolved checks',()=>{
 const assessment={passed:9,total:9,failed:0,unknown:0,qualified:true};
 const plan=entryPlan(row,null,'minervini');
 const {rerender}=render(<ResearchDecisionStatus {...{assessment,plan}} readiness={{passed:7,total:7,ready:true,rules:[]}}/>);
 expect(screen.getByText('日次確認 7/7').parentElement).toHaveTextContent('未達 0 · 未確認 0');
 expect(screen.getByText('日次確認 7/7').parentElement).toHaveAttribute('data-state','pass');
 rerender(<ResearchDecisionStatus {...{assessment,plan}}/>);
 expect(screen.getByText('日次確認 未確認').parentElement).toHaveTextContent('未達 — · 未確認 —');
 expect(screen.getByText('日次確認 未確認').parentElement).toHaveAttribute('data-state','unknown');
});

it('keeps the existing book/app warning beside a conditional app zone without inventing an annual gate',()=>{
 const current={...row,current_price:104};
 const method='minervini';
 render(<CandidateBoard ranked={[{row:current,assessment:assess(current,method,now)}]} {...{method,date,generation,now,market}} onSelect={()=>{}}/>);
 const card=screen.getByRole('article');
 const decision=card.querySelector('.research-decision-status');
 expect(decision.querySelector('[data-check="price"]')).toHaveTextContent('現在の状態 · 価格位置● 買いゾーン内ピボット比 +4.0%');
 expect(decision.querySelector('.feed-price-model')).toHaveTextContent('価格位置 · アプリ 0〜+5%');
 expect(screen.getByRole('note',{name:/書籍の追随目安外/})).toHaveTextContent('△ 書籍目安2〜3%超');
 expect(decision.querySelector('.decision-annual')).toBeNull();
 expect(decision.compareDocumentPosition(card.querySelector('.feed-growth'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
