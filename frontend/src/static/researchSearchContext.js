import { createContext, useContext, useState } from 'react';

export const ResearchSearchContext = createContext(null);

export function useResearchSearch(initialValue = '') {
  const shared = useContext(ResearchSearchContext);
  // Keep independently mounted research pages usable; the application always
  // uses the provider's single value for the header, drawer, filters and CSV.
  const local = useState(initialValue);
  return shared || local;
}
