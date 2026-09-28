# Public institutional evidence

`sec13f.json.gz` contains public SEC 13F aggregate manager-CIK counts and supporting accession numbers, not user holdings or credentials. The seed uses the official `01mar2026-31may2026_form13f.zip` and `01jun2026-31aug2026_form13f.zip` archives. Archive names, SHA-256 hashes, retrieval time, reporting periods and public-filing cutoff are embedded in the compressed JSON.

`openfigi.json` caches official OpenFIGI mapping responses reduced to ticker identity/status/time. CUSIP and CINS use their respective API namespaces. Names only prioritize requests; they never establish a match. Ambiguous classes are not merged. API keys are not required for this mapping route and are not stored here.

Update from `frontend` with `python tools/export-institutional.py --refresh --mapping-limit 200`. The official SEC archive index is queried before mapping. SEC download denial preserves explicitly dated prior evidence and exports a refresh warning. It does not advance its retrieval time or fabricate current holdings. Configure a real operator contact in the `SEC_USER_AGENT` environment variable / Actions secret when needed. The Actions cache retains downloaded archives, validators and incremental mappings.

The unit is a distinct reporting-manager CIK with a positive reported share position, not shares owned, a mutual fund, a parent-company family, or a sponsorship quality score. An absent report is unknown, not zero. See [the verification report](../../docs/institutional-scan-setup-audit-2026-09-29.md) for coverage and limitations.
