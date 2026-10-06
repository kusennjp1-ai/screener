# Retention scan performance correction

The first disabled bridge, commit `6467ab5`, exposed a timing blocker. On its
actual staged source, five warm full-inventory checks averaged 0.466645 seconds.
About 1,000 checks add 467 seconds to the historical 660–672 seconds of provider
collection, exceeding the 1,080-second acquisition maximum before setup time
reduces it further. That checkpoint and its negative timing evidence remain
preserved. No provider request was made.

## Mutation and validation model

Every existing getter, HTTP and result boundary still enumerates the entire
tree. The implementation uses `os.scandir` and one no-follow stat per unchanged
entry, replacing sorted `Path.rglob` traversal and duplicate stat calls. The
measurement cache is keyed by relative path and requires the same device,
inode, size, mtime and ctime. New or changed files are actually read, hashed and
deflated, with a second stat after the read. No notification watcher or assumed
immutable-file shortcut replaces those boundary checks.

The guard binds its root device/inode and initial file/directory membership.
Original file bytes remain immutable during acquisition, including the current
archive manifest, cycle, frozen inputs and selected receipts. Collector writes
may add or replace files only under the batch subtree; every scan measures the
current complete batch and reserves its archive copies. Existing per-object,
package, archive, getter, HTTP and wall-time caps remain unchanged. Any integrity
failure latches so a swallowed provider-library exception cannot permit later
provider work or a successful final report.

Before archive merge, a forced fresh byte inventory verifies all original
members and enforces finalization capacity. Since all selected results already
exist and provider work is finished, this reserve covers actual batch copies,
bounded metadata/manifest replacements and framing, without reserving another
provider step. It freezes all pre-merge bytes and invalidates the measurement
cache.

The runner then supplies the exact returned archive-manifest digest, validated
object inventory and digest of the cycle bytes it wrote. Only those two existing
metadata paths may change. Every new archive object must belong to that exact
inventory and match its hash-named path; every required object and the exact
immutable manifest snapshot must exist. Extra manifests or objects are rejected.
Pre-existing crash-orphan objects remain in the exact preserved union, as the
archive retention contract requires; preserving them grants no new source or
publication authority. The exact reviewed input contains no such orphan.

Final packaging forces another complete byte inventory, writes sorted ZIP
members, hashes every decoded member on readback, and repeats the fresh full
inventory afterward. Added, deleted, changed or replaced members during packaging
fail. The actual Actions artifact still requires separate download, size/hash
checks and complete readback before source acceptance.

## Verification boundaries

Tests cover original-file deletion/rename/rewrite, root or parent replacement,
links/special files, poisoned signature cache, transient integrity errors inside
the real mocked collector, each pre-merge cap, exact final metadata and archive
membership, missing new objects/manifests, and packaging-time mutation. The
source collector and archive merge exercise the final phase sequence with mocked
transports. Real retained-source and growing-output timing/parity evidence is
reported separately; local performance does not establish CI runtime.

The dispatch admission remains disabled with a null run number. This correction
does not raise time/size caps, change financial formulas or clocks, authorize
provider work, alter publication policy, or implement cadence/rotation.

Final local validation passed 234 Python tests and 22 Node tests; an independent
review accepted the guard and reproduced closure of the merge-cap, new-object
membership and original crash-evidence findings. The final guard file SHA-256
is `590b1cdcab11bb43d8d0c626689776ce91afae178134dd7912354d54e9f48439`.

On that exact final guard, cold/warm timings were 6.08633s/0.07354s on the actual
staged source and 5.01073s/0.04644s on the synthetic full-200 growth tree. The
earlier 50/100/200 growth run used text-identical acquisition methods and had
warm means 0.04359s/0.06165s/0.10359s. All inventories, file hashes, encoded lengths
and acquisition reservation reports matched the original 6467 implementation.

Using the worst warm sample across both runs, plus both final cold scans and all
changed-input scan costs, gives a conservative local 1,000-check allowance of
123.036565 seconds. With historical collection, the estimate is
783.278565–795.101565 seconds. The unchanged job-budget formula therefore leaves
at least 284.898435 seconds for actual setup in this extrapolation. Actual CI
setup is unknown; slower CI/provider responses or extra transports can still
produce a bounded partial stop.

The growth fixture contains 400 exact original acquisition files, 198 matching
original result/envelope pairs and 406 unchanged transport events, ending at
9,249 files / 9,259 entries / 206,585,521 bytes. NVDA and VIRT have no archived
batch result objects, so their fixture placeholders are explicitly labeled as
benchmark-only. No benchmark output is a valid source artifact or new financial
observation. The original source and all negative timing evidence are unchanged.
