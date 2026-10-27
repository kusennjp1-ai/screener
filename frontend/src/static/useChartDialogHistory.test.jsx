import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import useChartDialogHistory from './useChartDialogHistory';

afterEach(cleanup);
function Dialog({ onClose }) {
  const close = useChartDialogHistory(true, onClose);
  return <div role="dialog"><button onClick={close}>戻る</button></div>;
}
function App() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>拡大</button>{open && <Dialog onClose={() => setOpen(false)}/>}</>;
}
it('adds one history entry in StrictMode and preserves route/state through browser back and repeated reopen', async () => {
  const state = { page: 'stock', symbol: 'EPSN' };
  history.replaceState(state, '', '#/?symbol=EPSN');
  render(<StrictMode><App/></StrictMode>);
  const length = history.length, url = location.href;
  fireEvent.click(screen.getByText('拡大'));
  await waitFor(() => expect(history.state.__screenerChartDialog).toBeTruthy());
  expect(history.length).toBe(length + 1);expect(location.href).toBe(url);
  history.back();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(history.state).toEqual(state);expect(location.href).toBe(url);
  // Forward can revisit the closed dialog's same-URL entry. Reopening must
  // reuse that entry, not add another marker and make Back appear ineffective.
  history.forward();
  await waitFor(() => expect(history.state.__screenerChartDialog).toBeTruthy());
  expect(screen.queryByRole('dialog')).toBeNull();
  const forwardLength = history.length;
  fireEvent.click(screen.getByText('拡大'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  await Promise.resolve();
  expect(history.length).toBe(forwardLength);
  fireEvent.click(screen.getByText('戻る'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(history.state).toEqual(state);
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByText('拡大'));
    await waitFor(() => expect(history.state.__screenerChartDialog).toBeTruthy());
    fireEvent.click(screen.getByText('戻る'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(history.state).toEqual(state);expect(location.href).toBe(url);
  }
});
