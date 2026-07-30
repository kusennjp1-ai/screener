import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BuyChecklist from './BuyChecklist';
import { renderWithProviders } from '../../test/renderWithProviders';

const buyContext = {
  available: true,
  bands: { pressure_state: 'buy', buy_risk_state: 'low', tpr_state: 'transition' },
  signal: {
    active: true,
    label: 'Buy Point',
    trigger_price: 149.67,
    barrels: { trend: false, pressure: true, breakout: false },
  },
};

const stockData = {
  rs_rating: 61.5, eps_rating: 84, passes_template: true, code33: null,
};

describe('BuyChecklist', () => {
  it('renders nothing when the buy context is unavailable', () => {
    const { container } = renderWithProviders(
      <BuyChecklist buyContext={{ available: false }} stockData={stockData} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('mirrors the engine barrels and the fundamental legs', () => {
    renderWithProviders(<BuyChecklist buyContext={buyContext} stockData={stockData} />);
    expect(screen.getByTestId('buy-checklist')).toBeInTheDocument();
    // Barrels straight from the signal engine.
    expect(screen.getByTestId('buy-check-tpr')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('buy-check-pressure')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-pivot')).toHaveAttribute('data-met', 'false');
    // Fundamentals from the scan row: template pass, RS 61.5 < 70, EPS 84 >= 80.
    expect(screen.getByTestId('buy-check-trend_template')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-rs_rating')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('buy-check-eps_rating')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('buy-check-code33')).toHaveAttribute('data-met', 'unknown');
    // The active signal headline with its trigger.
    // the stage is translated, never printed as the raw backend string
    expect(screen.getByText('買い点 @ 149.67')).toBeInTheDocument();
    expect(screen.queryByText(/Buy Point/)).not.toBeInTheDocument();
    // The rule is printed, not implied.
    expect(screen.getByText(/3バレル全点灯＝トリプルバレル買い/)).toBeInTheDocument();
  });

  it('lights Code 33 from buy-context (live) over the scan row', () => {
    renderWithProviders(
      <BuyChecklist buyContext={{ ...buyContext, code33: true }} stockData={stockData} />,
    );
    expect(screen.getByTestId('buy-check-code33')).toHaveAttribute('data-met', 'true');
  });

  it('shows the lit-barrel count when the signal is inactive', () => {
    renderWithProviders(
      <BuyChecklist
        buyContext={{ ...buyContext, signal: { active: false, barrels: { trend: true, pressure: true, breakout: false } } }}
        stockData={stockData}
      />,
    );
    expect(screen.getByText('未点灯（2/3 バレル）')).toBeInTheDocument();
  });
});

describe('Trend Template row agrees with the 8/8 scorecard', () => {
  const bands = { tpr_state: 'strong', pressure_state: 'buy', buy_risk_state: 'low' };
  const ctx = { available: true, bands, signal: { barrels: {} } };

  it('reads the chart payload, not the scan row, so one screen cannot contradict itself', () => {
    // The scan row says the template failed; the chart payload (the same object
    // TrendTemplateScorecard renders as 8/8) says every condition passed.
    const trendTemplate = {
      score: 8,
      max: 8,
      conditions: Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, label: `c${i}`, passed: true })),
    };
    renderWithProviders(
      <BuyChecklist
        buyContext={ctx}
        stockData={{ passes_template: false, ma_alignment: false }}
        trendTemplate={trendTemplate}
      />,
    );
    expect(screen.getByText('8/8')).toBeInTheDocument();
    expect(screen.queryByText('fail')).not.toBeInTheDocument();
  });

  it('shows the real count when the template is only partly met', () => {
    const trendTemplate = {
      score: 6,
      max: 8,
      conditions: Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, label: `c${i}`, passed: i < 6 })),
    };
    renderWithProviders(
      <BuyChecklist buyContext={ctx} stockData={{ passes_template: true }} trendTemplate={trendTemplate} />,
    );
    expect(screen.getByText('6/8')).toBeInTheDocument();
  });

  it('falls back to the scan row when no breakdown shipped', () => {
    renderWithProviders(
      <BuyChecklist buyContext={ctx} stockData={{ passes_template: true }} trendTemplate={null} />,
    );
    expect(screen.getByText('合格')).toBeInTheDocument();
  });
  it('never prints a raw backend enum in the value column', () => {
    // The states arrive as English enums (buy / low / transition). Printed
    // verbatim they read as verdicts to someone who does not know the scale —
    // "low" beside a FAILED breakout row looks like good news.
    renderWithProviders(
      <BuyChecklist buyContext={buyContext} stockData={stockData} trendTemplate={null} />,
    );
    expect(screen.getByText('買い優勢')).toBeInTheDocument();   // pressure: buy
    expect(screen.getByText('低い')).toBeInTheDocument();       // buy_risk: low
    expect(screen.getByText('移行中')).toBeInTheDocument();     // tpr: transition
    ['buy', 'low', 'transition'].forEach((raw) => {
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
    });
  });

  it('translates every staged signal label the engine can emit', () => {
    // markets360/signals.py emits four distinct stages; each must survive
    // translation as a DIFFERENT word, because the stage is the decision.
    const stages = {
      'SEPA Buy Point': 'SEPA買い点',
      'Buy Point': '買い点',
      'Buy Ready': '買い準備',
      'Buy Alert': '買い接近',
    };
    Object.entries(stages).forEach(([raw, ja]) => {
      const ctxStage = { ...buyContext, signal: { ...buyContext.signal, label: raw, trigger_price: null } };
      const { unmount } = renderWithProviders(
        <BuyChecklist buyContext={ctxStage} stockData={stockData} trendTemplate={null} />,
      );
      expect(screen.getByText(ja)).toBeInTheDocument();
      unmount();
    });
    expect(new Set(Object.values(stages)).size).toBe(4);
  });
});
