import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function normalizeTrade(symbol, payload, feed) {
  const trade = payload?.trade;
  if (payload?.symbol !== symbol || !Number.isFinite(trade?.p) || trade.p <= 0 || !Number.isFinite(Date.parse(trade.t))) throw Error('Invalid provider response');
  return { symbol, price: trade.p, as_of: trade.t, provider: 'Alpaca', feed, currency: 'USD',
    is_realtime: feed === 'sip' || feed === 'iex', delay_seconds: feed === 'delayed_sip' ? 900 : 0,
    coverage: feed === 'iex' ? 'IEX exchange only; not the consolidated US market' : 'US consolidated exchanges' };
}

export function createQuoteServer({ env = process.env, providerFetch = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let minute = 0;
  let requests = 0;
  const feed = env.ALPACA_DATA_FEED || 'iex';
  if (!['iex', 'sip', 'delayed_sip'].includes(feed)) throw Error('Unsupported data feed');
  const origins = new Set((env.ALLOWED_ORIGINS || 'https://kusennjp1-ai.github.io').split(',').map(s => s.trim()));
  return createServer(async (req, res) => {
    const respond = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return respond(403, { error: 'Origin not allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method !== 'GET') return respond(405, { error: 'GET required' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return respond(200, { configured: Boolean(env.ALPACA_API_KEY && env.ALPACA_SECRET_KEY), feed });
    if (url.pathname !== '/quote') return respond(404, { error: 'Not found' });
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return respond(400, { error: 'Invalid symbol' });
    if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return respond(503, { error: 'Market data is not configured' });
    const cached = cache.get(symbol);
    if (cached && now() - cached.fetched < 10000) return respond(200, cached.value);
    if (!inFlight.has(symbol)) {
      const bucket = Math.floor(now() / 60000);
      if (bucket !== minute) { minute = bucket; requests = 0; }
      if (++requests > 150) return respond(429, { error: 'Provider request budget reached' });
      const request = (async () => {
        const response = await providerFetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=${feed}`, {
          headers: { 'APCA-API-KEY-ID': env.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw Error('Provider unavailable');
        const value = normalizeTrade(symbol, await response.json(), feed);
        if (cache.size >= 1000) cache.delete(cache.keys().next().value);
        cache.set(symbol, { fetched: now(), value });
        return value;
      })();
      inFlight.set(symbol, request);
    }
    try { respond(200, await inFlight.get(symbol)); }
    catch { respond(502, { error: 'Market data unavailable' }); }
    finally { inFlight.delete(symbol); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createQuoteServer().listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('Quote gateway started'));
}
