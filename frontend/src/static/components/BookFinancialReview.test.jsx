import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import BookFinancialReview from './BookFinancialReview';
import { syntheticBookFinancials } from '../../test/fixtures/bookFinancials';
afterEach(cleanup);
it('labels old snapshot measurements as historical and agrees with the current overview expiry',()=>{
 const book=syntheticBookFinancials();
 render(<BookFinancialReview expanded row={{symbol:'TEST',book_financials:book,technical_audit:{as_of_date:book.as_of_date}}} now={Date.parse('2026-10-04T00:00:00Z')}/>);
 expect(screen.getByText(/現在の業績確認：未確認/)).toHaveTextContent('基準日時点の測定記録');
 expect(screen.getByText(/最新期末が現在の確認日から180日超前/)).toHaveTextContent('現在の業績充足として扱いません');
 expect(screen.getByRole('table',{name:'提出日付き四半期業績'})).toBeInTheDocument();
 expect(screen.getByText(/EPS成長加速：充足/)).toBeInTheDocument();
});
