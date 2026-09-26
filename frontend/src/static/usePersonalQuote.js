import { useEffect, useMemo, useState } from 'react';
import { newerQuote, normalizeFinnhubQuote, normalizeFinnhubTrade } from './personalQuote';

// The key and quotes stay in this tab's memory; never localStorage, exports or a public backend.
export function usePersonalQuote(symbol, apiKey) {
  const [state, setState] = useState({symbol:null,quote:null,status:'未接続'});
  const session = useMemo(() => ({connected:Boolean(apiKey)}), [apiKey]);
  useEffect(() => {
    if (!apiKey || !symbol) return;
    let closed = false, socket, timer, reconnect, retries = 0;
    const controller = new AbortController();
    const update = (quote, status) => { if (!closed) setState(old => ({session,symbol,quote:newerQuote(old.symbol === symbol && old.session === session ? old.quote : null,quote),status})); };
    async function poll() {
      try {
        // Finnhub's cross-origin preflight does not allow the token header.
        // Use its documented query-token authentication only on this fixed host.
        const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`, {
          cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),
        });
        if (!response.ok) { update(null,response.status === 401 || response.status === 403 ? 'キー・利用権限を確認' : response.status === 429 ? '配信の利用上限' : '価格取得エラー'); return; }
        const quote=normalizeFinnhubQuote(await response.json(),symbol);
        update(quote,quote ? '接続済み' : '価格未配信');
      } catch { if (!closed) update(null,'価格取得エラー'); }
      finally { if (!closed) timer=setTimeout(poll,15000); }
    }
    function connect() {
      if (closed) return;
      socket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(apiKey)}`);
      socket.onopen = () => { if (!closed) socket.send(JSON.stringify({type:'subscribe',symbol})); };
      socket.onmessage = event => {
        if (closed) return;
        try {
          const message=JSON.parse(event.data);
          if (message.type === 'error') { update(null,'配信権限を確認'); return; }
          const quote=normalizeFinnhubTrade(message,symbol);
          if (quote) update(quote,'接続済み');
        } catch { /* Ignore malformed messages, without logging provider payloads or credentials. */ }
      };
      socket.onerror = () => { /* REST polling remains the fallback. */ };
      socket.onclose = () => { if (!closed && retries++ < 3) reconnect=setTimeout(connect,Math.min(30000,1000*2**retries)); };
    }
    poll();
    try { connect(); } catch { /* Browsers without WebSocket still use REST. */ }
    return () => { closed=true; controller.abort(); clearTimeout(timer); clearTimeout(reconnect); if (socket) { socket.onclose=null; socket.onmessage=null; socket.close(); } };
  }, [symbol,apiKey,session]);
  return apiKey && state.symbol === symbol && state.session === session ? state : {symbol,quote:null,status:apiKey ? '接続中' : '未接続'};
}
