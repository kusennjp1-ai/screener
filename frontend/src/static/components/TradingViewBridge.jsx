import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { tradingViewUrl, buildPineScript } from '../tradingView';

// TradingView bridge panel (C89) — hands the user's own TradingView the plan the
// screener computed. Two ToS-clean affordances, no dependency / no scraping:
//   • open the symbol on TradingView (their account, indicators, drawings)
//   • copy a Pine v5 overlay of the pivot / stop / 2R-3R / buy-zone
// Renders nothing if there is no symbol.
export default function TradingViewBridge({ symbol, market, signal, riskPlan, asOf }) {
  const [copied, setCopied] = useState(false);
  if (!symbol) return null;

  const url = tradingViewUrl(symbol, market);
  const pivot = signal?.trigger_price;
  const hasPlan = pivot != null || riskPlan?.stop_loss != null;

  const copyPine = async () => {
    const pine = buildPineScript({
      symbol,
      asOf,
      pivot,
      stop: riskPlan?.stop_loss,
      stopPct: riskPlan?.stop_pct,
      target2r: signal?.target_price_2r,
      target3r: signal?.target_price_3r,
    });
    try {
      await navigator.clipboard.writeText(pine);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) — fall back to a
      // prompt so the user can still copy the script by hand.
       
      window.prompt('Pineスクリプト（コピーしてTradingViewのPineエディタに貼付）', pine);
    }
  };

  return (
    <Box data-testid="tradingview-bridge"
      sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: 11, color: 'text.disabled', fontWeight: 700, letterSpacing: 0.3 }}>
        TRADINGVIEW
      </Typography>
      {url && (
        <Link
          data-testid="tradingview-open"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          underline="none"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 13, color: '#4f8cff', fontWeight: 600 }}
        >
          <OpenInNewIcon sx={{ fontSize: 15 }} />
          TradingViewで開く
        </Link>
      )}
      {hasPlan && (
        <Box
          data-testid="tradingview-copy-pine"
          role="button"
          tabIndex={0}
          onClick={copyPine}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') copyPine(); }}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 13, color: copied ? '#22ab94' : '#4f8cff', fontWeight: 600, cursor: 'pointer' }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
          {copied ? 'コピーしました' : 'Pineオーバーレイをコピー'}
        </Box>
      )}
      <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
        ピボット・ストップ・2R/3R・買いゾーンを自分のTradingViewチャートに重ねて表示（要Pineエディタ貼付）。
      </Typography>
    </Box>
  );
}
