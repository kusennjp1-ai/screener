import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InstitutionalRanking from './InstitutionalRanking';
afterEach(cleanup);
it('shows actual observed quarters and disclosure dates, with closed explanations and stock navigation',()=>{
 const select=vi.fn();
 const ranked=[{row:{symbol:'AMD',institutional_evidence:{symbol:'AMD',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[
  {period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},
  {period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'},
 ]}}}];
 const {container}=render(<InstitutionalRanking ranked={ranked} date="2026-10-23" onSelect={select}/>);
 expect(container.querySelector('details')).not.toHaveAttribute('open');
 expect(screen.getByText(/日々の購入額・購入株数は公開データに含まれません/)).toBeInTheDocument();
 fireEvent.click(screen.getByText('機関投資家の保有報告'));
 expect(screen.getByText('100 → 110社')).toBeInTheDocument();
 expect(screen.getByText('提出・公表 2026-07-10〜2026-08-15')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'AMD の保有報告とチャートを確認'}));
 expect(select).toHaveBeenCalledWith('AMD');
});
