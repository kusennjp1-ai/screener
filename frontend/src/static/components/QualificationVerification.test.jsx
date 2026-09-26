import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
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
