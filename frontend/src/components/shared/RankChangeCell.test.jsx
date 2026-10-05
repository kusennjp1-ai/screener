import { renderWithProviders } from '../../test/renderWithProviders';
import RankChangeCell from './RankChangeCell';

it.each([[null, '-'], [undefined, '-'], [0, '0'], [2, '+2'], [-3, '−3'], [-1.25, '−1.25']])('preserves rank delta %j with the correct sign and unknown placeholder', (value, expected) => {
  const { container } = renderWithProviders(<RankChangeCell value={value} />);
  expect(container.textContent).toBe(expected);
});
