import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteServer, normalizeTrade } from './server.mjs';

const payload = { symbol: 'AAPL', trade: { p: 200, t: '2026-09-22T15:00:00Z' } };
test('feed, exchange coverage and source timestamp survive normalization', () => {
  assert.equal(normalizeTrade('AAPL', payload, 'delayed_sip').delay_seconds, 900);
  assert.equal(normalizeTrade('AAPL', payload, 'delayed_sip').is_realtime, false);
  assert.match(normalizeTrade('AAPL', payload, 'iex').coverage, /IEX/);
  assert.equal(normalizeTrade('AAPL', payload, 'sip').as_of, payload.trade.t);
  assert.throws(() => normalizeTrade('WRONG', payload, 'sip'));
  assert.throws(() => normalizeTrade('AAPL', { ...payload, trade: { p: -1, t: payload.trade.t } }, 'sip'));
});
test('HTTP contract: cache, origin, invalid symbol, provider failure, missing configuration', async t => {
  let calls = 0;
  const env = { ALPACA_API_KEY: 'test-key', ALPACA_SECRET_KEY: 'test-secret' };
  const server = createQuoteServer({ env, providerFetch: async () => { calls++; return { ok: true, json: async () => payload }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/quote?symbol=../secret`)).status, 400);
  assert.equal((await fetch(`${url}/quote?symbol=AAPL`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const response = await fetch(`${url}/quote?symbol=AAPL`, { headers: { Origin: 'https://kusennjp1-ai.github.io' } });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://kusennjp1-ai.github.io');
  assert.equal((await response.json()).price, 200);
  await fetch(`${url}/quote?symbol=AAPL`);
  assert.equal(calls, 1);
  assert.equal((await fetch(`${url}/quote?symbol=OTHER`)).status, 502);
  delete env.ALPACA_API_KEY;
  assert.equal((await fetch(`${url}/quote?symbol=AAPL`)).status, 503);
});
