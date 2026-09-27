import {render,screen} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import ChartDecisionSummary from './ChartDecisionSummary';
describe('chart decision summary',()=>{
  it('handles missing date and evidence without inventing a passed condition',()=>{
    render(<ChartDecisionSummary row={{symbol:'EMPTY'}} />);
    expect(screen.getByText(/未達・未確認/)).toBeInTheDocument();
    expect(screen.queryByText(/日次の購入条件を確認済み/)).not.toBeInTheDocument();
  });
  it('uses the same 3 percent method limit and canonical pivot as the order view',()=>{
    render(<ChartDecisionSummary row={{symbol:'TEST',current_price:102,se_pivot_price:100}} method="minervini2" date="2026-09-25" />);
    expect(screen.getByText('$103.00')).toBeInTheDocument();
    expect(screen.getByText(/（3%）/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-25 日次終値/)).toBeInTheDocument();
  });
});
