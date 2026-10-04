# Mandatory financial source pilot

This isolated branch tests whether the existing Yahoo statement producer can
recover current, source-bound financial facts for NVDA, AMD and VIRT. It is an
acquisition experiment, not a production data update or a qualification change.

The runner calls only quarterly and annual income-statement getters, at most six
times in total. It uses the production yfinance 0.2.66 capture contract, preserves
original source receipts and input cells, and validates the resulting proof with
the current static financial-evidence implementation. HTTP 403/429 or a transport
exception stops subsequent transport. There are no caller retries, alternate
routes, quote/profile fetches, secrets, database updates or publication steps.

The uploaded artifact contains public financial cells, sanitized endpoint/status
receipts, payload hashes, derived envelopes and current validation results.
Cookies, query strings, tokens, headers and complete HTTP responses are excluded.
Acquisition time is not a filing/publication date. The observations are current
when fetched; they are not evidence of what was known at the October 2 price
snapshot. Full-universe recovery cannot be inferred from these three symbols.

Run the offline tests before the explicit provider invocation:

```sh
python -m unittest discover -s tools/financial-source-pilot -p 'test_*.py' -v
python tools/financial-source-pilot/pilot_actual_sources.py --repo . --output-dir /tmp/new-pilot-evidence --dry-run
```

The actual acquisition uses the same command without `--dry-run`, in an
environment authorized to access Yahoo. The output directory must be new.
Artifacts are retained for 14 days. A blocked provider is reported as a failed
pilot with partial evidence; it is never converted to a successful financial
qualification.
