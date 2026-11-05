import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import VcpCard from './StockVcpCard';

const DATE = '2026-10-02';
const leg = (startDate, endDate, depthPct, bars, intervalRatio) => ({ startDate, endDate, depthPct, bars, high: 100, low: 100 - depthPct, volumeEvidence: { intervalRatio } });
const technical = (legs, extra = {}) => ({ vcp: { legs, measurementsValid: true, depthsContract: true, base: { startDate: legs[0]?.startDate }, ...extra } });
const legs = [leg('2026-06-23', '2026-07-31', 13.1, 28, 0.9), leg('2026-09-17', '2026-10-01', 4.2, 11, null)];
const daily = Array.from({ length: 140 }, (_, i) => new Date(Date.UTC(2026, 3, 1) + i * 86400000)).filter(d => d.getUTCDay() % 6).map(d => ({ date: d.toISOString().slice(0, 10), open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const bars = [...daily.filter(b => b.date <= DATE), { date: DATE, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
afterEach(cleanup);

describe('brief VCP card', () => {
  it('lists each contraction with its T number, depth, length and volume ratio, 出来高 未確認 when unknown', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{ pivot: 110 }} />);
    expect(screen.getByText('VCP 14週 13/4 2T')).toBeInTheDocument();
    expect(screen.getByText(/最大の押し 13% → 最後の押し 4%・収縮 2回.*独自近似です。各収縮を押すとチャートで強調します。/)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: /収縮ごと/ });
    const [first, second] = within(group).getAllByRole('button');
    expect(first).toHaveTextContent('T1−13%28日0.90×');
    expect(second).toHaveTextContent('T2−4%11日未確認');
    expect(second).toHaveAccessibleName('T2：深さ 4.2%、長さ 11日、出来高 未確認。押すとチャートで強調');
  });

  it('counts weeks on the weekly chart', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} interval="week" />);
    const [first] = within(screen.getByRole('group', { name: /収縮ごと/ })).getAllByRole('button');
    expect(first).toHaveTextContent(/T1−13%\d+週0\.90×/);
  });

  it('emphasises the pressed contraction on the chart and clears it on a second press', () => {
    const highlightLeg = vi.fn(), chartRef = { current: { highlightLeg } };
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} chartRef={chartRef} />);
    const [, second] = within(screen.getByRole('group', { name: /収縮ごと/ })).getAllByRole('button');
    fireEvent.click(second);
    expect(highlightLeg).toHaveBeenLastCalledWith(1);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(second);
    expect(highlightLeg).toHaveBeenLastCalledWith(null);
    expect(second).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads VCP 未確認 when nothing is measurable', () => {
    render(<VcpCard technical={technical(legs.slice(0, 1))} bars={bars} judged={null} view={{}} />);
    expect(screen.getByText('VCP 未確認')).toBeInTheDocument();
    expect(screen.getByText('測定できる収縮が2回以上ないため、VCPは未確認です。')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
  });

  it('says the VCP is unknown while the detail loads and why on uncertified bars, never drawing the legs', () => {
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} pending />);
    expect(screen.getByText('VCP 未確認（読み込み中）')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} uncertified={{ reason: '最終日足が分析日と不一致' }} />);
    expect(screen.getByText('日足を分析基準日で検証できないため（最終日足が分析日と不一致）、VCPは未確認です。')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /収縮ごと/ })).toBeNull();
    const dry = screen.getByText('最後の収縮の出来高').nextSibling;
    expect(dry).toHaveTextContent('未確認');
  });

  it('says when the base has been broken out of', () => {
    render(<VcpCard technical={technical(legs, { base: { startDate: legs[0].startDate, endDate: '2026-09-25', brokeOut: true, breakoutDate: '2026-09-28' } })} bars={bars} judged={null} view={{}} />);
    expect(screen.getByText('VCP 13週 13/4 2T・土台の高値を上抜け（9/28）')).toBeInTheDocument();
    expect(screen.getByText(/9\/28に土台の高値を上抜けています。/)).toBeInTheDocument();
  });

  it('shows the Setup Engine base beside the result only when it is current, and says when they differ', () => {
    const row = weeks => ({ setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_base_length_weeks: weeks, se_base_depth_pct: 12.6 });
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={row(14.2)} date={DATE} />);
    expect(screen.getByText('Setup Engine：土台 14週・深さ 13%')).toBeInTheDocument();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={row(30)} date={DATE} />);
    expect(screen.getByText('Setup Engine：土台 30週・深さ 13%（独自近似と異なります）')).toBeInTheDocument();
    cleanup();
    render(<VcpCard technical={technical(legs)} bars={bars} judged={null} view={{}} row={{ ...row(14), setup_recalculation: { status: 'calculated', as_of_date: '2026-09-30' } }} date={DATE} />);
    expect(screen.queryByText(/^Setup Engine：/)).toBeNull();
  });
});
