# Next 200 consumer-expiry correction: disabled offline candidate

This finite correction supersedes the c19 BBNX–COKE proposal with **ADP–CMS**.
It selects the first 200 source-owned consumer expiry obligations, including
valid partial annual/quarterly history, ordered by deadline, actual attempt and
ASCII symbol. There are 19 replacements and 181 retained symbols. The source
cohort remains 1,894, the applicable queue remains 1,891, and the only exclusions
remain BITU, ETHE and SBIT. Completeness and the previous refreshed prefix are
historical diagnostics, not selection gates. Null/unknown deadlines never become
zero or immediately due, and source obligations are not dropped after expiry.

The new earliest last-valid instant is **2026-10-07 11:37:21.221 UTC**. The
unchanged consumer invalidates at the next millisecond. Reserving the full
1,500-second job gives the inclusive latest start **11:12:21.221 UTC**. The
planning clock remains 02:25:13 UTC with the exact 36-hour horizon ending
2026-10-08 14:25:13 UTC. These are review clocks; no source observation is retimed.
The queue source evaluation remains 2026-10-06 21:47:36.426 UTC.

## Exact source and permission boundaries

The original retained receipt queue is byte-for-byte unchanged. A separate pinned
consumer queue preserves the reviewed consumer deadlines and source-owned rows.
Preparation validates all 1,891 rows against retained receipt IDs, original
observation times, attempts, identity and applicability. The full historical
archive and the exact failed producer/independent companion lineage stay intact.
Review, disabled admission and disabled execution move to version 2 to bind the
consumer queue and exact symbol/attribute retry decisions. Native collector,
receipt, archive, cycle, restore and publication schemas are unchanged.

The exact missing priors are BHP/quarterly_income_stmt, BTI/quarterly_income_stmt,
BXDC/income_stmt and CCEP/quarterly_income_stmt. Their retained attempts failed
with empty_getter_result and contain no retry_not_before. Each remains explicitly
retry_decision_required. Elapsed time does not establish cooldown completion or
permission. Any other missing prior or loss of an existing receipt rejects.
The collector rejects unresolved decisions before stage creation and provider
work, even if someone constructs an otherwise enabled execution fixture. Direct
synthetic tests can model an explicitly permitted fixture; no CLI policy override
or production authorization is created.

There are 396 original cache receipts and 400 fresh getters. Existing receipt
validity reasons remain distinct: 388 stale_source, six reporting_period_gap and
two stale_reporting_period, plus the four missing priors. All 400 are fresh work;
none is reusable through this horizon. Fetch success still does not guarantee
complete history, a current reporting period, positive comparison bases, currency
support or a financial pass. Identity remains ticker-only and unverified.

The limits remain 200 symbols, 400 ordered getters, 1,000 HTTP transports,
1,080 acquisition seconds, a 1,500-second job, a 420-second finalization reserve,
1.5-second pacing, no caller retries, no additional identity requests and an
immediate global stop on 403/429 or transport failure.

## Exact bindings

- Original retained queue: b0b9eacb04bbe864f55798060ec9c2e47cdfa56a417c738b8dc078526f31060a
- Consumer queue: 8ea15a9b5e8d24691c86cd1d2adf478c55a88c2dff0ea77a456d9c51fab23e38
- Projection: 17c959817367ee02e8809f913a484b055a03024dc2dd91f976555f5765027d18
- Collector plan: dc6c7eb01230c5086d5400e91ff41d2bd52bece3a8c0b68ff1a8f380fd6ae8be
- Cache: 025cd5dec973bc4cdca3eb42c6cbe385548ddfb727a022db889a70f85b521f04
- Review: 68ec4c15542851dd305baf5176a85e423c6d1d005d9b90253acad9d3a1e63d2a
- Disabled admission: 1b09c2b113207ae1c508ff8739545887e5bc70eb1e8fa547e1f958113540595d
- Disabled execution: 55c8c330652bd4f5f113670328d7fafb4015903ef195654183d789b927ea80cb

## Capacity and offline verification

The correction retains both queues, so it counts the entire 4,848,988-byte
consumer queue as additional metadata. The new selected cache is 44,946 bytes
smaller. A fresh logical inventory measured the original archive and selected
cache in place, generated exact collector metadata and applied the unchanged
production guard's byte compression, framing and reservation math. It includes
16 metadata files, companion ZIP, full typed provenance, disabled execution,
synthetic future context, original restore proof and fixture annotation.

The full inventory is 221,283,166 expanded bytes, a 36,876,904-byte known encoded
bound and 8,850 logical members. With unchanged reservations of 88,569,364 expanded
and 89,719,590 encoded bytes, it leaves **227,018,382 expanded bytes,
7,621,234 encoded bytes and 18,518 members**. Input bytes and identities matched
before and after. No full source/stage copy or archive write was performed.
This logical capacity proof is not a physical-stage, final-merge, canonical-ZIP,
provider-runtime or production-authentication proof. The real stage must repeat
all guards with actual metadata and real clocks; no proof may be removed to fit.

The inert `.github/workflow-templates/financial-statement-next-200-offline.yml`
contains only dependency setup and offline tests. It is outside the workflow
trigger directory. Provider calls, source restoration and dispatch are absent.
The reviewed policy-fixture test correction is included: disabled-policy behavior
uses an explicit disabled fixture, and an enabled fixture still checks the
companion before any stage creation. The production guards are preserved.

The reviewed standalone selector was replayed against the unchanged consumer:
15 Node tests pass, including source projection parity, 19 replacements, partial
histories, split clocks, last-valid/+1ms, horizon boundaries, deterministic ties,
source retiming, upgraded identity and unexpected missing receipts. All 183 candidate Python tests and 86 restoration Node tests pass (plus
25 Python subtests). Candidate Python checks exercise exact metadata pins, closed schemas, whole-queue receipt
reconciliation, four-gap handling, explicit retry blocking and physical guard
behavior with finite synthetic transports. Target GitHub CI has not run. The unchanged full baseline verifier also
rechecked the exact source ZIP, all 10,055 captured files and the companion at
2026-10-07 03:05:20.542 UTC under an explicit local fixture. It passed in 34.23
seconds, with zero provider/network calls, zero archive copies and original
failed-producer history preserved. This is not remote GitHub authentication.

## Remaining independent review and admission

1. Independently review this patch, exact pins and all four unresolved retry
   decisions. No permission to retry is inferred from this candidate.
2. Run the disabled offline candidate in the target Python 3.11 / Node 22 CI
   environment. Local verification used Python 3.12.14 / Node 24.19.0; no active GitHub workflow
   was added.
3. Independently authenticate the exact retained source/companion and full
   predecessor inventory. Do not reuse a baseline after intervening partial work.
4. Recheck provider exclusivity across source and price work. Price run #419 was
   reported active when this preparation began; this offline report grants no
   collection slot and does not establish that run's current status.
5. Before acquisition, require separately reviewed restore/admission/execution
   decisions, one actual run number/attempt 1, matching live code/workflow heads,
   a current finite clock, physical full-stage reservation and real setup charge.
6. After any actual source visit, require fresh independent validation and
   publication review. This correction does not renew the live site or authorize
   later visits. The next unselected due symbol is CNA at 12:48:20.674 UTC, so one
   200-symbol visit does not solve the remaining deadline cluster.
