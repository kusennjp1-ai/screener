import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useColorModePreference, { COLOR_MODE_STORAGE_KEY } from './useColorModePreference';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps an explicit light choice when the app mounts again', () => {
  const first = renderHook(() => useColorModePreference());
  expect(first.result.current[0]).toBe('dark');
  act(() => first.result.current[1]('light'));
  first.unmount();
  const next = renderHook(() => useColorModePreference());
  expect(next.result.current[0]).toBe('light');
  act(() => next.result.current[1]('dark'));
  expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
});
it('rejects an invalid stored value and keeps the existing dark default', () => {
  localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'invalid-theme');
  expect(renderHook(() => useColorModePreference()).result.current[0]).toBe('dark');
});
it('allows switching even when preference storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const { result } = renderHook(() => useColorModePreference());
  expect(result.current[0]).toBe('dark');
  act(() => result.current[1]('light'));
  expect(result.current[0]).toBe('light');
});
