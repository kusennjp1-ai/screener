import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import ScanResultCards from './ScanResultCards';
import { C, T, TEXT_MIN_PX } from '../designTokens';

const row = (over = {}) => ({
  symbol: 'FTNT',
  company_name: 'FTNT',
  ibd_industry_group: 'Computer Sftwr-Security',
  current_price: 151.35,
  price_change_1d: 0.95,
  rs_rating: 61.54,
  stage: 2,
  passes_template: false,
  vcp_detected: false,
  se_distance_to_pivot_pct: 2.96,
  se_pivot_price: 147,
  tpr_state: 'strong',
  pressure_state: 'buy',
  buy_risk_state: 'low',
  ...over,
});

describe('ScanResultCards', () => {
  it('renders nothing for an empty result set', () => {
    const { container } = renderWithProviders(<ScanResultCards rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('puts the decision-relevant numbers on the card, in Japanese', () => {
    renderWithProviders(<ScanResultCards rows={[row()]} />);
    const card = screen.getByTestId('scan-card-FTNT');
    expect(card).toHaveTextContent('151.35');
    expect(card).toHaveTextContent('+0.9%');
    expect(card).toHaveTextContent('RS 62');
    expect(card).toHaveTextContent('ステージ2');
    expect(card).toHaveTextContent('買いゾーン内 +3.0%');
    // band states are spelled out, never left as backend enums
    expect(card).toHaveTextContent('強い');
    expect(card).toHaveTextContent('買い優勢');
    expect(card).toHaveTextContent('低い');
    ['strong', 'buy', 'low'].forEach((raw) => {
      expect(card).not.toHaveTextContent(new RegExp(`\\b${raw}\\b`));
    });
  });

  it('falls back to the industry group when the company name is just the ticker', () => {
    renderWithProviders(<ScanResultCards rows={[row()]} />);
    // "FTNT FTNT" reads as a rendering bug; show something that adds information.
    expect(screen.getByTestId('scan-card-FTNT')).toHaveTextContent('Computer Sftwr-Security');
  });

  it('refuses to present a stale pivot as a tradeable distance', () => {
    // A real case from the export: MRVL at 266.77 against a pivot of 84.02 —
    // "+217.5% from the pivot" describes a base that no longer exists, but
    // reads as though there were a buy point 217% below.
    renderWithProviders(<ScanResultCards rows={[row({ symbol: 'MRVL', se_distance_to_pivot_pct: 217.5, se_pivot_price: 84.02 })]} />);
    const card = screen.getByTestId('scan-card-MRVL');
    expect(card).toHaveTextContent('有効なベースなし');
    expect(card).not.toHaveTextContent('217.5%（追わない）');
    expect(card).not.toHaveTextContent('買いゾーン');
  });

  it('still names the extended case when the pivot is recent enough to matter', () => {
    renderWithProviders(<ScanResultCards rows={[row({ se_distance_to_pivot_pct: 9.5 })]} />);
    expect(screen.getByTestId('scan-card-FTNT')).toHaveTextContent('ピボットから +9.5%（追わない）');
  });

  it('reserves red for danger — a template miss is the default state, not an alarm', () => {
    const { unmount } = renderWithProviders(<ScanResultCards rows={[row({ passes_template: false })]} />);
    expect(window.getComputedStyle(screen.getByText('テンプレート不合格')).color)
      .toBe('rgb(154, 160, 172)'); // C.grey
    unmount();
    renderWithProviders(<ScanResultCards rows={[row({ passes_template: true })]} />);
    expect(window.getComputedStyle(screen.getByText('テンプレート合格')).color)
      .toBe('rgb(34, 171, 148)'); // C.up
  });

  it('omits a field entirely rather than printing a dash for it', () => {
    renderWithProviders(<ScanResultCards rows={[row({
      rs_rating: null, stage: null, se_distance_to_pivot_pct: null,
      tpr_state: null, pressure_state: null, buy_risk_state: null,
    })]} />);
    const card = screen.getByTestId('scan-card-FTNT');
    expect(card).not.toHaveTextContent('RS');
    expect(card).not.toHaveTextContent('ステージ');
    expect(card).not.toHaveTextContent('ピボット');
    // no placeholder dash stands alone as a value ("Computer Sftwr-Security"
    // legitimately contains a hyphen, so match whole text nodes only).
    const dashes = [...card.querySelectorAll('*')]
      .filter((el) => !el.children.length && ['-', '—', '–'].includes((el.textContent || '').trim()));
    expect(dashes).toEqual([]);
  });

  it('renders no text below the 12px floor and only exported scale steps', () => {
    renderWithProviders(<ScanResultCards rows={[row()]} />);
    const sizes = [];
    const walker = document.createTreeWalker(screen.getByTestId('scan-card-FTNT'), NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      if ((n.textContent || '').trim()) {
        sizes.push(parseFloat(window.getComputedStyle(n.parentElement).fontSize));
      }
      n = walker.nextNode();
    }
    expect(sizes.filter((s) => s < TEXT_MIN_PX)).toEqual([]);
    const steps = new Set(Object.values(T));
    expect(sizes.filter((s) => !steps.has(s))).toEqual([]);
  });

  it('opens the chart only for symbols that have one', () => {
    const onOpenChart = vi.fn();
    renderWithProviders(
      <ScanResultCards
        rows={[row(), row({ symbol: 'AA' })]}
        onOpenChart={onOpenChart}
        isChartEnabled={(s) => s === 'FTNT'}
      />,
    );
    expect(screen.getByTestId('scan-card-FTNT')).toHaveAttribute('role', 'button');
    expect(screen.getByTestId('scan-card-AA')).not.toHaveAttribute('role');
    expect(C.grey).toBeTruthy();
  });
});
