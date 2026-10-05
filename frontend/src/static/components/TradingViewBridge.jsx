import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { tradingViewUrl } from '../tradingView';
import { validEvidenceDay } from '../evidenceTime';

// The external chart is a separate source. The legacy signal/risk blocks do
// not establish one coherent entry/stop/target plan that can be exported.
export default function TradingViewBridge({ symbol, market, asOf }) {
  if (!symbol) return null;
  const url = tradingViewUrl(symbol, market);
  const date = validEvidenceDay(asOf) ? asOf : '未確認';

  return (
    <Box data-testid="tradingview-bridge"
      sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 700, letterSpacing: 0.3 }}>
        TRADINGVIEW
      </Typography>
      {url && <Link data-testid="tradingview-open" href={url} target="_blank" rel="noopener noreferrer" underline="none"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44, fontSize: 13, color: 'var(--wait)', fontWeight: 600 }}>
        <OpenInNewIcon sx={{ fontSize: 16 }} />
        TradingViewで外部チャートを開く
      </Link>}
      <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>
        この画面の日次記録の基準日 {date}。外部チャートの価格・配信時刻・遅延はTradingView側で確認できます。
      </Typography>
    </Box>
  );
}
