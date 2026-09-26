# Financial history and personal quote connection

## Financial history

The existing SEC ticker map and company-facts requests return HTTP 403 in this environment. Do not bypass that denial or mark failed fetches verified. SEC point-in-time evidence remains separate.

`frontend/tools/export-financial-history.py` fetches current reported diluted EPS, revenue and net income from Yahoo Finance via yfinance for up to 200 trend/IBD-qualified symbols. Annual and quarterly periods, reporting currency, source, retrieval timestamp and limitations are retained. No fabricated filing dates, interpolated years, basic/diluted mixing or annual-minus-quarter EPS calculation.

The current research screen validates identity, USD reporting currency, observation age (72 hours), period order, consecutive annual periods and four finite annual EPS values. History completeness is separate from growth: the O'Neil positive-growth test cannot pass on a negative/zero comparison base. The current financial observations must not be used for point-in-time backtests. SEC/book evidence is not overwritten. Raw period values are inspectable under detailed verification.

Release order: export and audit daily bars; acquire current financial history; recompute selection; acquire earnings dates for the qualified set; rebuild. The successful daily-data workflow triggers this release automatically. Local acquisition: 154/154 histories, 147 with four EPS values (not necessarily USD, comparable or passing growth).

## Quotes

No public quote endpoint or market-data API credential was configured. TradingView's consumer subscription does not expose a data API: https://www.tradingview.com/support/solutions/43000474413-i-need-access-to-your-api-in-order-to-get-data-or-indicator-values/

The entry panel now supports a personal Finnhub key, entered directly in the user's browser. The key stays in component memory, is cleared from the input after connection, is never in storage/query-cache/public builds, and is sent only to Finnhub's API/WebSocket. REST and WebSocket use the documented token query parameter on the fixed Finnhub host. The REST token header is not permitted by the observed cross-origin preflight response. Requests disable caching and referrers; URLs and provider payloads are never logged by the app. Quotes are not published in daily files or redistributed through a shared server.

Quotes use provider trade timestamps. The selected symbol must match; invalid/future messages are rejected, out-of-order prices cannot replace newer ones, and values older than 90 seconds are excluded from the entry calculation. Symbol changes, credential changes and disconnect invalidate the previous connection. REST polls every 15 seconds; WebSocket reconnect attempts are bounded. Coverage depends on the user's subscription; this is not a full-market NBBO or intraday-volume integration.

Remaining user action: obtain an eligible personal API key and enter it under **エントリー位置 → 場中価格を接続する**. Never send the key through chat, commit it or store it as a VITE variable. No provider account was created and no market-data subscription was purchased. Actual authenticated streaming remains unverified until the user supplies their credential. Tests use synthetic messages and do not establish real-market connectivity.

References: https://finnhub.io/docs/api/quote and https://finnhub.io/docs/api/websocket-trades . Personal data usage is governed by https://finnhub.io/terms-of-service .

Tracking: `bd` is unavailable on this host. This file records remaining provider-credential and point-in-time evidence work without silently declaring it complete.
