import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import FinancialEvidencePanel from './FinancialEvidencePanel';
import FinancialHistory from './FinancialHistory';
import ChartDecisionSummary from './ChartDecisionSummary';
import CandidateBoard from './CandidateBoard';
import StockMetricsSidebar from '../../components/Scan/StockMetricsSidebar';
import { assess } from '../researchEngine';
import { projectFinancialRow } from '../financialCurrent';
import { buildFinancialEvidencePresentation } from '../financialEvidencePresentation';
import { withAuditFixture } from '../testAuditFixture';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

const row=withSyntheticFinancialProof(withAuditFixture({symbol:'BITU',market:'US',company_name:'ProShares Ultra Bitcoin ETF',current_price:100,se_pivot_price:99,rs_rating:99,adv_usd:30000000,financial_history:{symbol:'BITU',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'fixture',retrieved_at:new Date(now).toISOString(),annual:[{end:'2025-12-31',eps:8}],quarterly:[]}},date));

it('shows fund applicability in the list while retaining its price and technical measurements',()=>{
  render(<CandidateBoard ranked={[{row,assessment:assess(row,'minervini',now)}]} method="minervini" now={now} onSelect={()=>{}}/>);
  expect(screen.getByText('株式手法の対象外（確認済みファンド）')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/BITU の分析を表示/})).toHaveAccessibleName(/対象外/);
  expect(screen.getByRole('button',{name:/BITU の分析を表示/})).toHaveAccessibleName(/RS 99/);
});

it('shows financial target exclusion independently of fresh fund financial numbers',()=>{
  const evidence=buildFinancialEvidencePresentation(row,{method:'oneil',date,now,generation:'test'});
  const {container}=render(<FinancialEvidencePanel evidence={evidence} history={row.financial_history} symbol="BITU" method="oneil" date={date} now={now} generation="test"/>);
  expect(container.querySelectorAll('[data-state="not_applicable"]')).toHaveLength(7);
  expect(container.querySelectorAll('[data-state="pass"], [data-state="fail"]')).toHaveLength(0);
  expect(screen.getAllByText(/NAVやファンドの財務値/, {selector:'.financial-evidence-reason'})).toHaveLength(7);
});

it('keeps saved annual values visibly separate from current corporate growth',()=>{
  render(<FinancialHistory row={projectFinancialRow(row,{now})} date={date} now={now} expanded/>);
  expect(screen.getByRole('note')).toHaveTextContent('企業EPS・売上成長の現在の判定には使用しません');
  expect(screen.getByRole('cell',{name:'8'})).toBeInTheDocument();
});

it('explains exclusion beside standalone chart price and reference metrics',()=>{
  render(<ChartDecisionSummary row={row} date={date} now={now}/>);
  expect(screen.getByText('BITU · $100.00')).toBeInTheDocument();
  expect(screen.getByText('株式手法の対象外（確認済みファンド）')).toBeInTheDocument();
});

it('uses the same guard in a standalone legacy metrics sidebar',()=>{
  render(<StockMetricsSidebar currentFinancialOnly stockData={row} fundamentals={{eps_growth_annual:99}} date={date} now={now}/>);
  expect(screen.getByText(/株式手法の対象外.*価格・テクニカルは参考表示/)).toBeInTheDocument();
  expect(screen.queryByText('+99.0%')).not.toBeInTheDocument();
});
