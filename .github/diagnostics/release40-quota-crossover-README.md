# Read-only transport/scheme crossover

## Purpose and interpretation

This isolated diagnostic measures an observed CLI/native core-quota-window split. It never changes the reviewed candidate, production quota policy, grants, release activation, main, or Pages. `budgetAccepted`, `quota_credit_granted`, `whole_release_certified`, and `publication_authority` remain false on every path. A green measurement means the bounded evidence collection completed. It does not mean the release or its budget passed.

The sole API endpoint is the already verified successful fixed run attempt:

`https://api.github.com/repos/kusennjp1-ai/screener/actions/runs/37456692717/attempts/1`

Each response body must identify the same repository ID/name, run ID, attempt, head SHA, main branch, workflow path, event, completed status, and success conclusion. The body exists only in memory and is discarded. The target is unrelated to whether the old deployment is the latest production deployment; this experiment makes no such claim.

C = stock gh 2.102.0 with its normal `token` authorization scheme; T = native fetch with `token`; B = otherwise identical native fetch with `Bearer`. The serial sequence is `C,T,C,B,C,B,C,T,C,T,C,B`. All calls use one current job's automatic `github.token` bound to `GH_TOKEN`, captured once in memory. It is not the completed historical job's token.

## Measurement bounds

- Twelve explicitly initiated measurement invocations at most: six gh processes and six native fetches. There are no retries, pagination, conditional requests, cache-busting query strings, `/rate_limit` calls, identity probes, or reset waits.
- Starts are at least one second apart. Each invocation has a ten-second deadline; the measurement has an enclosing 180-second deadline. The shell watchdog is 210 seconds and the job eight minutes. Every abort ends this run permanently; workflow attempt 2 is rejected before measurement.
- Headers are capped at 32 KiB, body at 128 KiB, gh stderr at 4 KiB, and sanitized artifact at 64 KiB. No raw output or error text is persisted.
- Every accepted sample is status 200 with a complete consistent `core` resource/limit/remaining/used/reset tuple. Denial, Retry-After, malformed/missing quota, wrong identity, any observed redirect, token-binding change, byte/time cap, or reset boundary ends the experiment.
- A response must leave at least retained reserve 228 plus the remaining planned invocation suffix. This is a diagnostic-only rejection rule based on each actual response. It does not merge windows, derive fresh allowance from a limit/reset, attribute shared consumption solely to this experiment, or certify production admission. The bootstrap observation is one bounded read before a balance is known.

### Important stock-gh limitation

Twelve invocations is not a proven twelve-wire-request limit. Stock gh does not expose a no-follow flag through this invocation. Its internal redirects, connection replays, and final network origin are opaque. The artifact records internal gh wire count and final-origin evidence as null, and the proven-wire-bound flag as false. The approved fixed HTTPS endpoint is expected to be nonredirecting; observed redirects/Location/multiple response blocks stop measurement. A redirect that gh handles invisibly cannot be ruled out by this artifact. Native fetch uses `redirect: 'error'` and no fallback.

The official [CLI authorization source](https://github.com/cli/cli/blob/v2.102.0/api/http_client.go#L153-L186) selects the token scheme and avoids adding a fresh authorization header when a redirect changes hostname. [go-gh client construction](https://github.com/cli/go-gh/blob/v2.16.1/pkg/api/http_client.go) passes its redirect callback to Go's HTTP client and limits default authorization additions by host. These source checks do not attest an unobserved outgoing destination. No proxy bypass or custom security exception is introduced.

## Controlled inputs and remaining differences

The same explicit nonsecret application header profile is supplied to both clients: Accept, API version, User-Agent, Content-Type, Time-Zone, Accept-Encoding identity, Cache-Control no-store, Pragma no-cache, Accept-Language, and Sec-Fetch-Mode. Native fetch uses no-store; gh receives no cache option. The artifact records header names only, alongside transport and intended authorization scheme. No authorization value is emitted. Header normalization is a code/configuration property, not a wire capture.

HTTP version, header ordering, connection behavior, runtime defaults, and default proxy routing remain possible differences between gh and native fetch. The native T/B crossover differs only in authorization scheme. The current network/proxy/certificate environment is preserved. Only safe presence booleans and a recognized Node proxy mode are recorded; no variable values or proxy destinations are saved.

The actual gh version must parse as 2.102.0 and the executable must resolve exactly to `/usr/bin/gh`. Actual Node must be v22.23.3. A changed runtime aborts without measurement. The gh configuration directory is new, empty, private, and removed afterward. CLI alternate token fallbacks are removed from the child environment. Local git verification and gh version subprocesses receive none of the four GitHub credential environment variables; these non-network checks need no token. No existing credential configuration is read or modified; no persistent access, API-token input, secret input, login, or token generation is involved. Debugging/TLS-key logging is prohibited. `NODE_DEBUG` and `NODE_DEBUG_NATIVE` are cleared by the workflow before Node startup and rejected by the context guard before any git or child-process call, preventing environment-dumping child-process debug output.

## Sanitized evidence

Only the fixed target, sequence/arm, UTC start/end, monotonic elapsed time, status, validated quota numbers/resource, HTTP Date, validated GitHub request ID, and narrow typed cache fields are retained. Missing or invalid fields are null. Cache-Control directives and Vary names are explicitly enumerated; arbitrary strings, response cookies, scopes, Location/Via values, bodies, stderr, and exception messages are never emitted. Location, Via, Retry-After, unknown headers, and rejected cache metadata have boolean indicators. A final in-memory containment check rejects any report containing the captured token; the token is never hashed, fingerprinted, serialized, or passed in command arguments.

A proof block records candidate SHA/tree, all six added overlay-file hashes, zero modified/deleted files, the number of validated candidate files, diagnostic SHA, and a scope hash. Source-file hashes are not credential hashes.

## Outcome rules

Only complete, stable-within-arm, timestamp-proximate observations with distinct validated request IDs, recognized Cache-Control, and no positive Age, explicit cached/stale/expired/revalidated status, or rejected cache metadata are classified beyond inconclusive:

- C and T match, B differs: scheme-associated window split reproduced. This does not identify which service or intermediary causes it.
- T and B match, C differs: scheme alone is not supported by this controlled sample; CLI/native transport differences remain.
- C, T, and B match: the old split was not reproduced under normalized inputs. This is not evidence that the original problem is fixed.
- Within-arm changes, stale/insufficient metadata, other patterns, reset crossing, or abort: inconclusive.

The timestamp flag means only that Date is within five seconds of the sample interval. Distinct validated request IDs help reject direct replay. Missing Age or X-Cache remains null and cannot establish a fresh origin or rule out every intermediary. Even a reproduced label describes the controlled response association, not proven causation. Missing Cache-Control or repeated request IDs makes the result inconclusive.

No automated candidate patch, balance aggregation, tolerance, reset adjustment, transport selection, retry, rerun, or follow-on experiment follows any result. Review the actual evidence before proposing another action.

## Publication and scope

The six overlay files must be one direct-child commit of candidate `c2b90868d3c9e23b731172d1181345b795963f99`, tree `6fbf30523ff84ad37b315bb760cecfde33af685e`, on `diagnostic/release40-quota-crossover-20261010`. Existing candidate paths are verified against forty pinned source hashes and remain unchanged. The candidate activation request must stay disabled with null activation. Both checkouts use `persist-credentials: false`.

Only the new branch push triggers the new workflow; its permissions are contents:read and actions:read. There is no workflow-dispatch/token input. The inherited CI/design push branches do not include this branch, and main-only release workflow-run filters do not match this workflow. The single three-day artifact is the sanitized summary including its scope proof. This implementation and its local tests do not themselves authorize a push or a live run. Independent review and explicit execution go-ahead are required first.

## Offline validation

Run `node --test .github/diagnostics/release40-quota-crossover.test.mjs` without any token. Tests use only in-memory fake transports/streams, fixture credentials, fake clocks, and local source reads. They cover exact URL constraints, finite call counts, strict headers, secret-bearing responses/errors, redirects, missing fields, body/identity/byte bounds, timeouts, token binding, scope/context restrictions, metadata classification, and immutable false budget acceptance. Consult the fresh private manifest for actual validated runtimes and counts; validation from before the workspace reset does not certify reconstructed bytes. No local live API measurement was performed.
