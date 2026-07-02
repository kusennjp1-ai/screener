import { Box, Typography } from '@mui/material';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

// The trend-invalidation warning card — renders the backend's 50-DMA
// breakdown exit signal (Minervini's primary sell tell). Informational only;
// the backend never auto-liquidates and neither does this card.
export default function ExitSignalCard({ exitSignal }) {
  if (!exitSignal || !exitSignal.breakdown_detected) return null;
  const price = exitSignal.breakdown_price;
  const volX = exitSignal.volume_multiple;
  const action = exitSignal.recommended_action;

  return (
    <Box sx={{
      position: 'absolute', right: 16, top: 56, zIndex: 5, width: 280,
      bgcolor: 'rgba(22,13,13,0.96)', border: '1px solid #f23645', borderRadius: 1.5,
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)', p: 1.5,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <TrendingDownIcon sx={{ color: '#f23645', fontSize: 20 }} />
        <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>50-DMA Breakdown</Typography>
      </Box>
      {exitSignal.breakdown_date && (
        <Typography sx={{ color: '#9aa0aa', fontSize: 12 }}>{exitSignal.breakdown_date}</Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, pt: 1, borderTop: '1px solid #2f2326' }}>
        {price != null && (
          <Typography sx={{ color: '#d1d4dc', fontSize: 13 }}>
            close <b>{Number(price).toFixed(2)}</b>
          </Typography>
        )}
        {volX != null && (
          <Typography sx={{ color: '#f2a33c', fontSize: 13 }}>
            vol <b>{Number(volX).toFixed(1)}×</b> avg
          </Typography>
        )}
      </Box>
      {action && action !== 'none' && (
        <Typography sx={{ color: '#f23645', fontSize: 12, mt: 0.75, fontWeight: 700 }}>
          {action.replace(/_/g, ' ')}
        </Typography>
      )}
    </Box>
  );
}
