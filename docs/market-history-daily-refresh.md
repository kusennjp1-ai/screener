# Daily market history refresh

The ordinary **Static Site / full US** path now collects long history on every
completed snapshot, after the existing independent daily-bar audit. It uses that
snapshot's verified chart universe and dated scan classification. This remains a
current-universe retrospective calculation, not historical index membership or
historical fundamentals.

The **prices_only** path does not fetch six years of prices. It restores the last
authenticated long-history capture and preserves its actual observation date, so
the bulk history job cannot delay the fast closing-price publication. The full
producer and the post-close recovery watchdog extend the history separately.

## Source and release flow

1. `restore-market-history-source.mjs` verifies the public receipt, transport,
   manifest, derived series and original source hash before restoring the prior
   capture to `static-data/market-history-source.json`.
2. `collect-market-history.py --root public/static-data` reads the current
   `qualification-audit.json`, its chart paths, and dated scan classification.
   It requests original six-year Yahoo responses and recomputes all aggregates.
3. A successful update requires actual final-session breadth values under the
   existing 90% coverage / 100-stock RS rules, the final S&P 500 close, and all
   11 sector ETF ranks. The output is atomically replaced only after these checks.
4. `audit-market-history.py` independently replays retained response hashes,
   NYSE sessions, sampled scalar breadth calculations, sector breadth and every
   sector rank. Its report binds the exact new source hash.
5. The ordinary research exporter selects the runtime capture at its fixed
   evaluation clock and also retains its hash-named source asset. The input stays
   under `static-data`, so normal publication input inventories and offline carry
   replay bind the same original bytes. No financial or publication gate is
   bypassed; collecting a source does not itself publish it.

On an unavailable final session, the old capture stays byte-for-byte unchanged.
The update report says `updated: false`, the attempted target and the retained
date. The public UI shows the actual old observation date; recovery must inspect
the endpoints, not merely the manifest date. Malformed inputs and broken source
bindings fail rather than being treated as normal upstream delays.

## Latency and retained cache

One Actions cache per session and collector version retains raw responses for
retries. Different dates are never restored into one cache directory, and no new
cache is created for each retry. A cached response missing the requested final
bar is refetched. Valid closes are rechecked after 60 minutes to admit provider
corrections. The cache remains a performance aid: original response hashes are
checked before reuse, and the collector's results are independently replayed.

The six-year request volume is still roughly one response per verified symbol,
with at most three concurrent requests. This is deliberately excluded from the
fast route. Cold daily acquisition time depends on the provider; it is not a
guaranteed close-to-publication deadline. The report records actual elapsed time.
Reading the existing authenticated October 26 fixture on the local Windows
compressed filesystem took 80.7 seconds for 4,380 verified charts; this is an
input-read measurement, not a network or GitHub Actions benchmark.

The separate Cboe collector now refreshes the latest three sessions and gaps,
while retaining older verified observations with their original timestamps. A
normal retry makes three Cboe requests rather than 63. It never copies an older
ratio into a newer date.

## Expected update clock

The short market source includes `refresh_schedule`, an independently generated
NYSE schedule from seven days before the target through 45 days after it, with
UTC `close_at` times and an explicit `valid_until`. This covers DST, holidays and
short sessions. Future calendar dates are not price observations. The UI may use
the clock to identify a missing completed-session update; after `valid_until`, it
must show that freshness cannot be confirmed rather than assuming weekdays.

Validation covers provider failure retention, stale-date rejection, missing final
observations, cache retries, raw/derived hash binding, offline runtime replay,
current scan classification, DST and early-close clocks, and fast/full routing.
