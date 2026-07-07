/**
 * API client for Positions (trade management: register a buy, the sell
 * engine watches it). Status field on each open position is computed
 * server-side from cached prices — listing never triggers external fetches.
 */
import apiClient from './client';

const BASE_PATH = '/v1/positions';

export const getPositions = async (status = 'open') => {
  const response = await apiClient.get(BASE_PATH, { params: { status } });
  return response.data;
};

export const createPosition = async (position) => {
  const response = await apiClient.post(BASE_PATH, position);
  return response.data;
};

export const updatePosition = async (positionId, updates) => {
  const response = await apiClient.patch(`${BASE_PATH}/${positionId}`, updates);
  return response.data;
};

export const closePosition = async (positionId, closePrice = null) => {
  const response = await apiClient.post(`${BASE_PATH}/${positionId}/close`, {
    close_price: closePrice,
  });
  return response.data;
};

export const deletePosition = async (positionId) => {
  const response = await apiClient.delete(`${BASE_PATH}/${positionId}`);
  return response.data;
};
