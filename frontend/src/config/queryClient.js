import { QueryClient } from '@tanstack/react-query';

/** One query policy for the connected app and the static site. */
export const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh
      gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache (was cacheTime in v4)
      placeholderData: (previousData) => previousData, // Use previous data while loading
    },
  },
});
