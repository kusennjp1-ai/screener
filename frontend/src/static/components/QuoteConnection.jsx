import { useState } from 'react';
import { Button, TextField, Typography } from '@mui/material';
export default function QuoteConnection({connected,status,onConnect,onDisconnect,quote}) {
  const [draft,setDraft]=useState('');
  return <details className="research-disclosure"><summary>場中価格を接続する{connected ? ` — ${status}` : ''}</summary>
    <Typography sx={{fontSize:13,my:1}}>Finnhubの自分用APIキーで接続します。キーと配信価格はこのタブ内だけで扱い、サイトの公開データや保存ファイルには含めません。再読込で接続を解除します。</Typography>
    {connected ? <Button onClick={onDisconnect}>接続を解除</Button> : <form onSubmit={event=>{event.preventDefault();if(draft.trim()){onConnect(draft.trim());setDraft('');}}}>
      <TextField label="Finnhub APIキー" type="password" value={draft} onChange={e=>setDraft(e.target.value)} autoComplete="off" size="small" fullWidth />
      <Button type="submit" disabled={!draft.trim()}>価格配信に接続</Button>
      <Button component="a" href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">APIキーを取得</Button>
    </form>}
    {connected && <Typography role="status" sx={{fontSize:13}}>{status}{quote ? `・最終受信価格 $${quote.price} / 約定時刻 ${quote.as_of}` : ''}</Typography>}
    <Typography sx={{fontSize:12,my:1}}>配信範囲は契約によります。全米統合気配や出来高の確認ではありません。90秒を超えた価格は発注判断の計算に使いません。休場中は最新約定が古くなります。TradingView契約は外部価格APIの利用権限ではありません。</Typography>
  </details>;
}
