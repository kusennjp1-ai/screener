import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import TrendTemplateScorecard from './TrendTemplateScorecard';

const conds = (passedCount) => Array.from({ length: 8 }, (_, i) => ({
  key: `c${i}`, label: `条件${i + 1}`, passed: i < passedCount,
}));

describe('TrendTemplateScorecard', () => {
  it('renders nothing without a trend_template block', () => {
    const { container } = renderWithProviders(<TrendTemplateScorecard trendTemplate={null} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = renderWithProviders(<TrendTemplateScorecard trendTemplate={{ conditions: [] }} />);
    expect(c2.firstChild).toBeNull();
  });

  it('shows the score and every condition label', () => {
    renderWithProviders(
      <TrendTemplateScorecard trendTemplate={{ conditions: conds(8), score: 8, max: 8 }} />,
    );
    expect(screen.getByTestId('trend-template-score')).toHaveTextContent('8/8');
    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByText(`条件${i}`)).toBeInTheDocument();
    }
  });

  it('derives the score from passed conditions when not provided', () => {
    renderWithProviders(
      <TrendTemplateScorecard trendTemplate={{ conditions: conds(5) }} />,
    );
    // 5 of 8 passed, max defaults to length
    expect(screen.getByTestId('trend-template-score')).toHaveTextContent('5/8');
  });
});
