import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InstitutionalEvidence from './InstitutionalEvidence';

const date = '2026-10-09';
const evidence = () => ({
  symbol: 'SYNTH', status: 'available', unit: '13f_reporting_manager_cik',
  publication_cutoff: '2026-08-31', retrieved_at: '2026-09-01T01:00:00Z',
  source_url: 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets',
  scope: '合成の13F報告運用会社数。',
  observations: [
    { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
    { period: '2026-06-30', manager_count: 100, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
  ],
});
const display = (data, asOf = date) => render(<InstitutionalEvidence row={{ symbol: 'SYNTH', institutional_evidence: data }} date={asOf} />);
const finalCount = () => within(screen.getByRole('table')).getAllByRole('row').at(-1).children[1];

describe('institutional holder history display', () => {
  it.each([null, undefined, '', '0', '100', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('keeps invalid reported-manager count %s unknown without crashing', count => {
    const data = evidence();
    data.observations[1].manager_count = count;
    display(data);
    expect(finalCount()).toHaveTextContent(/^未確認$/);
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 未確認');
    expect(within(screen.getByRole('table')).getByText('100社', { exact: true })).toBeInTheDocument();
  });
  it('retains equal positive counts and a real zero delta with quarterly scope', () => {
    display(evidence());
    expect(screen.getAllByText('100社', { exact: true })).toHaveLength(2);
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 0社');
    expect(screen.getByText(/四半期/)).toHaveTextContent('実際の購入者数');
  });
  it('keeps positive reported counts but rejects non-calendar-quarter periods without normalizing dates', () => {
    const data = evidence();
    data.observations[0].period = '2026-03-30';
    data.observations[1].period = '2026-06-29';
    data.observations[1].manager_count = 110;
    display(data);
    expect(screen.getByText('100社', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('110社', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2026-03-30', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2026-06-29', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('2026-03-31', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('2026-06-30', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('比較可能な保有機関数の履歴が未取得')).toBeInTheDocument();
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 未確認');
    expect(screen.getByText(/前期比/)).not.toHaveTextContent('前期比 +10社');
  });
  it('keeps old counts on their reporting periods while the comparison stays unknown', () => {
    display(evidence(), '2027-02-01');
    expect(screen.getAllByText('100社', { exact: true })).toHaveLength(2);
    expect(screen.getByText('2026-06-30', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 未確認');
    expect(screen.getByText(/^取得 2026/)).toBeInTheDocument();
    expect(screen.getByText(/^取得 2026/).closest('details')).not.toHaveAttribute('open');
  });
  it.each([null, undefined, [], 'invalid'].map(input => ({ input })))('renders missing or malformed evidence $input as unavailable', ({ input }) => {
    display(input);
    expect(screen.getByText('比較可能な保有機関数の履歴が未取得')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it.each([null, 'invalid', {}, []].map(input => ({ input })))('does not call the comparator with a malformed observation $input', ({ input }) => {
    const data = evidence();
    data.observations[1] = input;
    display(data);
    expect(finalCount()).toHaveTextContent(/^未確認$/);
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 未確認');
  });
  it('does not render evidence for another security', () => {
    display({ ...evidence(), symbol: 'OTHER' });
    expect(screen.getByText('比較可能な保有機関数の履歴が未取得')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('keeps a non-array observations payload unavailable', () => {
    display({ ...evidence(), observations: {} });
    expect(screen.getByText(/前期比/)).toHaveTextContent('前期比 未確認');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
