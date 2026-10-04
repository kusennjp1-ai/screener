import { useLocation } from 'react-router-dom';
import PageLoadBoundary from './PageLoadBoundary';

export default function RoutePageLoadBoundary({ children }) {
  const location = useLocation();
  // Native hash changes can reuse the default history key. Include the URL so
  // direct hash navigation can also recover from a failed route chunk.
  const resetKey = `${location.key}:${location.pathname}${location.search}${location.hash}`;
  return <PageLoadBoundary resetKey={resetKey}>{children}</PageLoadBoundary>;
}
