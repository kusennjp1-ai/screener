import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { assess } from '../researchEngine';
import { withAuditFixture } from '../testAuditFixture';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../test/fixtures/financialCurrent';
import QualificationVerification from './QualificationVerification';
const fetchPayload = vi.hoisted(() => vi.fn());
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: fetchPayload }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount(entry, onVerified) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><QualificationVerification row={{ symbol: 'A', current_price: 100, passes_template: true }} entry={entry} date="2026-09-23" generation="snapshot-1" method="minervini" onVerified={onVerified} /></QueryClientProvider>);
}
it('fetches daily evidence on request and refuses a wrong-symbol payload', async () => {
  fetchPayload.mockResolvedValue({ symbol: 'B', as_of_date: '2026-09-23', bars: [] });
  mount({ path: 'a.json' });
  expect(fetchPayload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '日足を取得して再検証' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('選定条件は未充足または未確認');
  expect(screen.getByRole('alert')).toHaveTextContent('銘柄または分析日が不一致');
});
it('supports retry after an unavailable data source', async () => {
  fetchPayload.mockRejectedValueOnce(Error('offline')).mockResolvedValue({ bars: [] });
  mount({ path: 'a.json' });
  fireEvent.click(screen.getByRole('button', { name: '日足を取得して再検証' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('再検証に失敗');
  fireEvent.click(screen.getByRole('button', { name: '日足を取得して再検証' }));
  expect(await screen.findByText(/選定条件は未充足または未確認/)).toBeInTheDocument();
});
it('disables verification when no independent daily data exists', () => {
  mount(); expect(screen.getByRole('button', { name: '日足を取得して再検証' })).toBeDisabled();
});
it('returns failed evidence to the parent so stale qualifications can be removed', async () => {
  const onVerified = vi.fn();
  fetchPayload.mockResolvedValue({ symbol: 'B', as_of_date: '2026-09-23', bars: [] });
  mount({ path: 'a.json' }, onVerified);
  fireEvent.click(screen.getByRole('button', { name: '日足を取得して再検証' }));
  await screen.findByRole('alert');
  expect(onVerified).toHaveBeenCalledWith('A', expect.objectContaining({ audit: expect.objectContaining({ valid: false }) }), '2026-09-23', 'snapshot-1');
});


it('re-evaluates a cached verification against the current financial clock', () => {
  const row=withSyntheticFinancialProof(withAuditFixture({symbol:'TEST',current_price:100,rs_rating:95},date));
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  client.setQueryData(['independentVerification','TEST','chart.json',date,'g1','oneil'],{audit:row.technical_audit,assessment:{qualified:true,passed:8,total:8,rules:[]}});
  const element=time=><QueryClientProvider client={client}><QualificationVerification includeFinancial={false} row={row} entry={{path:'chart.json'}} date={date} generation="g1" method="oneil" now={time}/></QueryClientProvider>;
  const view=render(element(now));
  const first=assess(row,'oneil',now);
  expect(screen.getByRole('alert')).toHaveTextContent(`（${first.passed}/${first.total}）`);
  const later=now+8*86400000;
  view.rerender(element(later));
  const expired=assess(row,'oneil',later);
  expect(expired.passed).toBeLessThan(first.passed);
  expect(screen.getByRole('alert')).toHaveTextContent(`（${expired.passed}/${expired.total}）`);
  expect(screen.getByRole('alert')).toHaveTextContent('四半期 EPS');
  expect(fetchPayload).not.toHaveBeenCalled();
});
