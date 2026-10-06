# Four-symbol offline preview (local proposal)

This harness tests the real bounded adapter against synthetic vendor responses and
real Redis Lua. It does not acquire prices, approve capture, publish data, push a
branch, or dispatch a workflow. `capture_approved` and `publication_authority`
remain false in every report. `REDIS_ENABLED=false` remains set in the test
container; the integration tests inject their disposable Redis clients directly.

Remote admission is separate. The proposed workflow accepts a push only to the
exact `preview/four-symbol-price-pilot-offline` branch, or a manual dispatch on
that branch with an exact expected SHA. The branch push allows discovery when
this new workflow does not exist on default `main`. No main, PR, schedule, or
workflow-run trigger exists. Permissions are `contents: read`; the only remote
output is a standard Actions report artifact. No provider credentials are read.

## Isolation and dependencies

The CI-only image build uses all of `backend/requirements.txt` and
`backend/requirements-test.txt`, constraining yfinance 0.2.66, curl_cffi 0.16.3,
and exchange-calendars 4.5.3. Official CPU-only PyTorch avoids CUDA downloads for
the server's sentence-transformers dependency. The context contains only the
existing requirements and reviewed constraints, not data, node_modules, or app
source. Installation uses official Python/PyTorch package indexes. Resolved
versions, image IDs/digests, source hashes and exact GitHub
repository/workflow/run/attempt/SHA/branch are retained.

After build, all three containers use Docker `--network none`, read-only root
filesystems, no capabilities, and no published ports. Both official Redis
servers have TCP disabled (`--port 0`), persistence disabled, and disposable
Unix sockets accessible only to the run's UID. The test container sees the
checkout and sockets read-only. No Docker socket, tokens or provider secrets
are mounted or passed through. The runner validates actual Docker inspect
records, a loopback-only interface set, Redis port zero, and two distinct Redis
server run IDs before testing. It sends no external connectivity probes.
This kernel/container boundary also contains curl_cffi; Python socket patches
would not be sufficient.

The offline job also runs the exact-run admission unit tests using synthetic history.
It never consumes an approved capture admission or invokes a capture workflow.
The integration suite checks independent-client concurrent atomic reservations,
all four shared keys, closed/bootstrap/open/half-open circuit behavior,
post-wait circuit changes, waits exceeding the remaining five-minute budget,
malformed/unavailable controls, cancellation, and non-coordination between
independent Redis instances. A skipped integration suite is a CI failure.
An ephemeral job's budget tests never establish global/cross-job coordination.

## Evidence and local checks

The proposed job retains provenance, source hashes, image/container records,
resolved requirements, JUnit results, test/build logs and a fail-closed result.
Only `passed_offline_only` means the required disconnected test suites passed;
it conveys no capture or publication authority. Failed setup/builds may have
provenance and logs without a result file; they are not successful tests.

Portable local checks from the repository root with the prepared Python
environment active (no Redis installation or provider traffic):

```sh
python .github/scripts/price-pilot-offline-test.py
bash -n .github/scripts/price-pilot-offline.sh
PYTHONPATH=backend python -m pytest --noconftest backend/tests/unit/test_bounded_price_recovery.py backend/tests/unit/test_price_pilot_admission.py -q
PYTHONPATH=backend python -m pytest --noconftest backend/tests/integration/test_price_pilot_redis.py --collect-only -q
```

The full image build, Docker network isolation, and actual Redis execution are
pending a separately admitted CI preview. There is no local Redis installation
or substitute service execution in this proposal.
