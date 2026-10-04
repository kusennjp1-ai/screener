# Local cumulative statement archive

`app.services.statement_artifact_archive` adapts immutable original acquisitions
to the pure refresh planner. It has no provider, DB, workflow or publication
side effects. The supplied current base bytes and explicit US cohort are checked
before use. Every read requires the caller's trusted SHA-256 of `manifest.json`.

Objects are stored under `objects/<sha256>.json` using exact original bytes.
The manifest retains every prior receipt, current per-symbol/attribute refs,
original attempt journals, failed raw acquisitions, batch plans, summaries and
results. `manifests/<sha256>.json` preserves prior archive generations. Original
capture IDs cannot be rewritten with different bytes. Selecting a new cohort
does not discard old receipts or global 403/429 stops. Cache exports select only
the current plan's <=200 symbols, copy <=400 original acquisition files, and
revalidate those files with the collector. Symlinks and traversal are rejected.

Atomic merge uses an exclusive local file lock, a compare-and-swap check of the
trusted manifest digest, fsynced immutable objects and atomic manifest replace.
A failed or interrupted merge leaves the previous visible manifest intact;
orphan objects are bounded and never silently deleted. Limits are 40,000
receipts, 40,000 attempts, 50,000 indexed objects, 2 GiB indexed bytes, 32 MiB
manifest, and 60,000 physical files/3 GiB including old manifests and orphans.
Reaching a limit fails closed and requires an explicit retention decision.

`project_symbol` recomputes the envelope, exact mandatory EPS/sales proof and
history from validated original frames. Reasons `0` and `f` mean source acquired;
`f` remains nonordinary growth. Unsupported derived scores and a five-quarter
missing sixth comparison remain independent diagnostics. Annual structural
availability includes valid nonpositive comparison chains and uses the oldest
original clock actually included in history, bounded by the exact 550-day
reporting-period expiry. Cache/result availability flags,
file mtimes, price generations and archive write times confer no source proof.
Verified receipts retain their statement attribute. Maintenance matches actual
attempts to each attribute's own original clock, so sequential quarterly and
annual getter times cannot suppress otherwise due renewal.

Historical supported proofs are recomputed at the original source clock to
recover their exact expiry. Thus later expiry is newly due work, while a genuine
missing source period remains `retry_decision_required`. Failed/in-flight
attempts require explicit later retry decisions. A getter interrupted by a local
budget is conservatively in-flight; unattempted symbols remain eligible and
budget stops never become global provider stops. A retained 403/429 requires
both an explicit cooldown decision and the planner's bound provider resume.
Annual-history work jointly requests both statement attributes. After an
unresolved attempt or missing-period result, its explicit retry decision set
must cover all relevant retained getter attempts; an undecided earlier getter
continues to hold that joint target. Seed receipts without journals instead use
the exact receipt-bound source recheck described below.

Use the APIs `create_archive`, `seed_retained_acquisitions`, `load_archive`,
`plan_archive`, `export_cache`, and `merge_batch`. The seed operation uses the
collector's read-only `index_retained_acquisitions`, without modifying the
reviewed pilot directory. `plan_archive` plans the full cohort, then exports its
selected symbols as the collector allowlist. Planning does not advance state.

The optional `python -m app.scripts.manage_statement_archive` CLI exposes `init`,
`seed`, `plan`, `cache` and `merge`. All commands require `--archive`, `--base`,
`--cohort` and `--now`; all except init require `--archive-sha256`. Seed/cache
also require a bounded `--plan`. A completed merge requires a trusted
`--summary-sha256`; crash recovery instead requires trusted `--plan-sha256`,
`--attempts-sha256` and `--cache-sha256`. A successful operation returns the new
digest for the next explicitly trusted read. Retry and resume decisions are
explicit CLI JSON inputs, not invented intervals.
`--source-rechecks` binds an explicit recheck deadline to an original receipt ID
and missing-period target when a seed has no getter journal. Zero/tiny comparison
bases remain `source_limited` with a verified acquisition and semantic reason;
their current scalar and proof stay absent, without immediate reacquisition.

An empty plan is a valid no-work report and must not be passed to the collector,
which correctly requires a nonempty selected batch. Archive corruption is fatal;
the caller must not replace the archive with an empty one or fall back to a new
first-200 sweep. No raw live pilot fixtures are committed to the repository.
