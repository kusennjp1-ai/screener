import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import StaticLayout from './StaticLayout';
import { NAV_HEIGHT } from './designTokens';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('./dataClient', () => ({
  useStaticManifest: () => ({ data: { markets: { US: { display_name: 'United States' } } } }),
  getStaticSupportedMarkets: () => ['US'],
  resolveStaticMarketEntry: () => ({ market: 'US' }),
}));

vi.mock('./StaticMarketContext', () => ({
  useStaticMarket: () => ({ selectedMarket: 'US', setSelectedMarket: vi.fn() }),
}));

function renderLayout() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/']}>
      <StaticLayout>
        <div>本文</div>
      </StaticLayout>
    </MemoryRouter>,
  );
}

describe('StaticLayout sticky nav', () => {
  it('renders every nav item on a single non-wrapping strip', () => {
    renderLayout();
    const strip = screen.getByTestId('static-nav-tabs');
    ['デイリー', 'スキャン', '騰落', '業種グループ'].forEach((label) => {
      expect(within(strip).getByRole('link', { name: label })).toBeInTheDocument();
    });
    expect(strip).toHaveStyle({ flexWrap: 'nowrap', overflowX: 'auto' });
  });

  it('pins the toolbar to a single 44px line', () => {
    renderLayout();
    const toolbar = document.querySelector('.MuiToolbar-root');
    expect(toolbar).toHaveStyle({
      height: `${NAV_HEIGHT}px`,
      minHeight: `${NAV_HEIGHT}px`,
      flexWrap: 'nowrap',
    });
  });

  it('drops the back/forward chevrons that competed with the tabs', () => {
    renderLayout();
    expect(screen.queryByLabelText('前のページに戻る')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('次のページに進む')).not.toBeInTheDocument();
  });

  it('keeps the theme toggle outside the horizontal scroller', () => {
    renderLayout();
    const strip = screen.getByTestId('static-nav-tabs');
    const toggle = screen.getByLabelText('ライトモードに切り替え');
    expect(toggle).toBeInTheDocument();
    expect(strip.contains(toggle)).toBe(false);
  });

  it('renders its children', () => {
    renderLayout();
    expect(screen.getByText('本文')).toBeInTheDocument();
  });
});
