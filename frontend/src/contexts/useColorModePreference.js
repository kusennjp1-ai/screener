import { useEffect, useState } from 'react';

export const COLOR_MODE_STORAGE_KEY = 'screener:color-mode';
const readMode = () => {
  try {
    const saved = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  } catch { return 'dark'; }
};

export default function useColorModePreference() {
  const [mode, setMode] = useState(readMode);
  useEffect(() => {
    try { localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode); }
    catch { /* Private/storage-blocked contexts still support the current view. */ }
  }, [mode]);
  return [mode, setMode];
}
