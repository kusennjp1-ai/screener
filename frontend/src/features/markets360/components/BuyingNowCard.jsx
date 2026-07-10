import { Box, Button, Typography } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import AddIcon from '@mui/icons-material/Add';
import GlossaryLabel from '../../../components/common/GlossaryLabel';

// The "Buying Now!" signal card — mirrors the MM360 popover: headline, the
// behavioral-analytic label, timestamp + author, and the protective stop.
// `onRegister` (optional) adds the one-click bridge to the Positions journal:
// buy the signal -> register the position -> the sell engine watches it.
export default function BuyingNowCard({ signal, author, onRegister }) {
  if (!signal || !signal.active) return null;
  const ts = signal.as_of ? new Date(signal.as_of) : null;
  const when = ts
    ? ts.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <Box sx={{
      position: 'absolute', right: 16, bottom: 16, zIndex: 5, width: 280,
      bgcolor: 'rgba(13,16,22,0.96)', border: '1px solid #3a6df0', borderRadius: 1.5,
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)', p: 1.5,
    }}>
      {signal.label && (
        <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 13, mb: 0.75, lineHeight: 1.3 }}>
          {signal.label}
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <BoltIcon sx={{ color: '#3aa0ff', fontSize: 20 }} />
        <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{signal.headline || 'Buying Now!'}</Typography>
      </Box>
      {when && <Typography sx={{ color: '#9aa0aa', fontSize: 12 }}>{when}</Typography>}
      <Typography sx={{ color: '#9aa0aa', fontSize: 12 }}>By {signal.author || author || 'Mark Minervini'}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, pt: 1, borderTop: '1px solid #23262f' }}>
        {signal.trigger_price != null && (
          <GlossaryLabel term="entry">
            <Typography component="span" sx={{ color: '#d1d4dc', fontSize: 13 }}>
              entry <b>{signal.trigger_price.toFixed(2)}</b>
            </Typography>
          </GlossaryLabel>
        )}
        {signal.stop != null && (
          <GlossaryLabel term="stop">
            <Typography component="span" sx={{ color: '#f23645', fontSize: 13 }}>
              stop @ <b>{signal.stop.toFixed(2)}</b>
              {signal.risk_pct != null && <span style={{ color: '#787b86' }}> (−{signal.risk_pct}%)</span>}
            </Typography>
          </GlossaryLabel>
        )}
      </Box>
      {onRegister && signal.trigger_price != null && (
        <Button
          fullWidth size="small" variant="outlined" startIcon={<AddIcon />}
          onClick={onRegister} data-testid="register-from-signal"
          sx={{ mt: 1, minHeight: 44, color: '#3aa0ff', borderColor: '#3a6df0' }}
        >
          Register Position（ポジション登録）
        </Button>
      )}
    </Box>
  );
}
