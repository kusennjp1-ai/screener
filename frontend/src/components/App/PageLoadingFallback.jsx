import { Box, CircularProgress } from '@mui/material';

export default function PageLoadingFallback() {
  return (
    <Box role="status" aria-label="Loading page" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
      <CircularProgress />
    </Box>
  );
}
