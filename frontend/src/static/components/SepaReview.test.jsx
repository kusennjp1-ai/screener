import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SepaReview from './SepaReview';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';

afterEach(cleanup);

it('withholds unverified raw EPS and sales in the SEPA review', () => {
  render(<SepaReview row={{symbol:'TEST',market:'US',as_of_date:date,eps_growth_yy:999,sales_growth_yy:888}} date={date} now={now}/>);
  const review=screen.getByRole('region',{name:'SEPAの確認範囲'});
  expect(review).toHaveTextContent('EPS前年比 未取得・売上前年比 未取得');
  expect(review).not.toHaveTextContent('999.0%');
  expect(review).not.toHaveTextContent('888.0%');
});

it('uses the current evaluation clock for certified financial values', () => {
  const row=withSyntheticFinancialProof({symbol:'TEST'});
  const {rerender}=render(<SepaReview row={row} date={date} now={now}/>);
  expect(screen.getByRole('region',{name:'SEPAの確認範囲'})).toHaveTextContent('EPS前年比 30.0%・売上前年比 40.0%');
  rerender(<SepaReview row={row} date={date} now={now+8*86400000}/>);
  expect(screen.getByRole('region',{name:'SEPAの確認範囲'})).toHaveTextContent('EPS前年比 未取得・売上前年比 未取得');
});
