import apiClient from '../../../api/client';

// Standalone Markets 360 payload (quote, ratings, band states, chart overlays,
// buy-signal card, quarterly strip). Path is /api-prefix-free per the client
// convention (baseURL already carries /api).
const BASE_PATH = '/v1/markets360';

export const markets360Keys = {
  all: ['markets360'],
  symbol: (symbol, period) => ['markets360', symbol, period],
};

export async function fetchMarkets360(symbol, period = '1y') {
  const { data } = await apiClient.get(`${BASE_PATH}/${encodeURIComponent(symbol)}`, {
    params: { period },
  });
  return data;
}

// Reuse the existing universe search for the symbol picker.
export async function searchSymbols(query, limit = 8) {
  if (!query || !query.trim()) return [];
  const { data } = await apiClient.get('/v1/stocks/search', {
    params: { q: query.trim(), limit },
  });
  return Array.isArray(data) ? data : [];
}
