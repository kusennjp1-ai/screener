import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { fullSeRow } from '../test/fixtures/setupEngineFixtures';
import ResultsTable from '../components/Scan/ResultsTable';
import { entryReadiness } from '../static/entryReadiness';
import { assess } from '../static/researchEngine';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../static/testFinancialFixture';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index, start: index * 32, end: (index + 1) * 32, size: 32, key: index,
    })),
    getTotalSize: () => count * 32,
  }),
}));
vi.mock('../components/Scan/RSSparkline', () => ({ default: () => null }));
vi.mock('../components/Scan/PriceSparkline', () => ({ default: () => null }));
vi.mock('../components/common/AddToWatchlistMenu', () => ({ default: () => null }));

const greenRow = {
  ...fullSeRow,
  symbol: 'REVIEW', market: 'US', currency: 'USD',
  pressure_state: 'buy', pressure_value: 1,
  buy_risk_state: 'low', buy_risk_atr: 1.2,
  tpr_state: 'strong', tpr_score: 7, tpr_max: 7,
  entry_evidence: { as_of_date: date, earnings: null },
};

describe('scan indicator glossary in incomplete purchase context', () => {
  it.each([7, 8])('identifies the legacy TPR approximation with a %s-point score scale', async (maximum) => {
    renderWithProviders(<ResultsTable
      results={[{ ...greenRow, tpr_score: maximum, tpr_max: maximum }]} total={1} page={1} perPage={25}
      sortBy="composite_score" sortOrder="desc" showActions={false}
    />);
    expect(screen.getByRole('img', { name: `トレンド評価: 強い (${maximum}/${maximum})` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'トレンド評価 の説明' }));
    const help = await screen.findByTestId('metric-info-popover');
    expect(help).toHaveTextContent('アプリ独自のトレンド近似バンド');
    expect(help).toHaveTextContent('色は価格・移動平均などの7条件');
    expect(help).toHaveTextContent('指数データが揃う場合だけRSラインの代理条件');
    expect(help).toHaveTextContent('Researchのトレンドテンプレート8条件＋価格整合性とは別の計算');
    expect(help).not.toHaveTextContent('ミネルヴィニのトレンドテンプレート7条件');
  });

  it.each(['unknown earnings', 'failed financial growth'])('keeps green band help observational with %s', async (context) => {
    const row = context === 'failed financial growth'
      ? withFinancialProof({ ...greenRow, eps_growth_yy: 10 }, now, date)
      : greenRow;
    const readiness = entryReadiness(row, date, { cap: .5, label: '上昇' }, now);
    expect(readiness.ready).toBe(false);
    expect(readiness.rules.find(rule => rule.id === 'earnings').state).toBe('unknown');
    if (context === 'failed financial growth') {
      expect(assess(row, 'ibd', now).rules.find(rule => rule.label.includes('四半期 EPS')).state).toBe('fail');
    }
    renderWithProviders(<ResultsTable
      results={[row]} total={1} page={1} perPage={25}
      sortBy="composite_score" sortOrder="desc" showActions={false}
    />);
    expect(screen.getByRole('img', { name: '需給: 買い優勢 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '買いリスク: 低い (1.2 ATR)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '需給 の説明' }));
    let help = await screen.findByTestId('metric-info-popover');
    expect(help).toHaveTextContent('観測時点の価格変化と出来高');
    expect(help).toHaveTextContent('決算予定・財務条件・データ鮮度は別に確認');
    expect(help).not.toHaveTextContent(/新規買いが安全|緑の期間のみ新規買い|今この価格/);

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'リスク の説明' }));
    help = await screen.findByTestId('metric-info-popover');
    expect(help).toHaveTextContent('50日線からのATR乖離');
    expect(help).toHaveTextContent('購入条件の通過を示すものではありません');
    expect(help).not.toHaveTextContent(/買って良い位置|新規買いが安全|今この価格/);
  });
});
