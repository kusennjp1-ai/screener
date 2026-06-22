# IBD reference lists (calibration ground truth)

These files are the **ground truth** for the IBD-50 calibration harness: IBD's
actual published weekly leaders (the IBD 50 / Leaderboard), transcribed into
JSON. The harness compares the screener's Composite-Rating leadership list to
these and reports the overlap, then sweeps Composite weights and gate
thresholds to maximise it.

## Layout

```
data/ibd_reference/
  ibd50/
    2026-06-18.json      # one file per published week
    2026-06-11.json
  leaderboard/           # optional: a second list type
    2026-06-18.json
```

- Folder = `list_type` (e.g. `ibd50`, `leaderboard`).
- Filename = the list's `as_of_date` (`YYYY-MM-DD.json`).
- A file named `TEMPLATE.json` is ignored by the loader.

## File schema

```json
{
  "as_of_date": "2026-06-18",
  "list_type": "ibd50",
  "market": "US",
  "source": "IBD 50 weekly (investors.com)",
  "constituents": [
    {"symbol": "FIX", "composite": 99, "eps": 98, "rs": 94, "smr": "A", "acc_dis": "B", "group_rank": 12},
    {"symbol": "ALAB"},
    "CRDO"
  ]
}
```

- Only `symbol` is required per constituent. A bare string (e.g. `"CRDO"`) is
  accepted as shorthand for `{"symbol": "CRDO"}`.
- The optional IBD ratings (`composite`, `eps`, `rs`, `smr`, `acc_dis`,
  `group_rank`) are not needed for membership-overlap scoring but let future
  work calibrate against IBD's own ratings.

> **Accuracy matters.** Mis-transcribed tickers silently corrupt the overlap
> metric, so transcribe symbols from a legible source (the IBD list text, not a
> blurry screenshot) and double-check them.

## Running the report

From the repository root:

```bash
cd backend && source venv/bin/activate
python -m app.scripts.ibd_overlap_report \
    --reference-dir ../data/ibd_reference --list-type ibd50 \
    --features /tmp/feature_rows.json

# Sweep weights + gates to maximise mean recall:
python -m app.scripts.ibd_overlap_report \
    --reference-dir ../data/ibd_reference --features /tmp/feature_rows.json \
    --calibrate --objective recall
```

`--features` is a JSON snapshot of the screener's feature rows per week — either
`{ "2026-06-18": [ {row}, ... ] }` or a flat list where each row carries an
`as_of_date`. Each row needs: `symbol`, `eps_rating`, `rs_rating`,
`ibd_group_rank`, `smr_rating`, `acc_dis_rating`, `week_52_high_distance`. These
are exactly the fields the static scan bundle already serializes, so the snapshot
can be extracted from a published feature run for the matching week.
