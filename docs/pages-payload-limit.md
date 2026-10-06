# GitHub Pages payload preflight

GitHub documents a [1 GB maximum published site](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
The [Pages artifact action](https://github.com/actions/upload-pages-artifact#artifact-validation)
also identifies 1 GB as the supported uncompressed TAR size; its unofficial 10 GB
absolute TAR ceiling does not authorize hosting a larger site. This repository
uses the conservative decimal value **1,000,000,000 bytes**, inclusively, for each
of these two independent checks. There is no command-line or environment limit
override.

## Entry points and scope

- `Research UI Release` measures `release/frontend/dist` immediately before its
  `actions/upload-pages-artifact@v4` step, with exactly the upload/deploy condition:
  `publish == 'true' && correction != 'true'`. Every final publication mode is
  covered, including ordinary data-only updates, new UI, migration, and financial
  activation/carry. A failed guard prevents upload and deployment.
- `select-release-source.mjs recheck` also invokes the same guard, before its
  remote identity checks, for every non-correction publication. Previously
  queued workflows that retain older YAML but check out the new controller still
  enforce the limit through their existing pre-upload/pre-deploy rechecks. This
  repeated check has no cache or bypass; prepare-only correction is excluded.
- `Static Site` also uses `upload-pages-artifact@v4`, but only to retain
  `static-site-data-RUN-ATTEMPT` from `frontend/dist`. That intermediate source
  artifact has no deploy step and is rebuilt/composed by Research UI Release
  before publication. It is intentionally outside the final-site quota guard.
- Prepare-only financial correction candidates and source/certification/audit
  archives remain outside the hosted-site check. Their existing archive-specific
  safety bounds (including the 8 GB bound) and retention behavior are unchanged
  and are not Pages hosting limits.
- CI checks the current complete upload/deploy inventory, the final upload's
  immediately preceding guard, exact path/condition, and the intermediate
  exception. A new publication entry point must extend this explicit review.

## Measurement and failure behavior

Run `python3 .github/scripts/check-pages-payload.py release/frontend/dist` from
the controller checkout. It returns JSON to the log and exits nonzero on failure.
The report includes file bytes, file/directory counts (root included), UTF-8
relative-path bytes, the ten largest filenames and sizes, both limits, and the
uncompressed TAR byte count. It writes no output into the payload.

File bytes are the sum of every regular file's logical `st_size`, recursively,
including hidden files and zero-length files. Sparse files count their full
served size, not allocated disk blocks. Hidden files excluded by the uploader
are conservatively included in this first check, so the total can overestimate
the published file bytes. It is never a ZIP/gzip size or a retained archive's
size. Already oversized file trees are rejected without streaming their TAR;
the report explicitly records `tar_bytes: null` in that case.

The second check streams GNU TAR to a byte counter, using the Linux v4 action's
hidden-name exclusions. It includes all actual directory/file headers, long
filenames, file padding and trailing record padding. This is an exact TAR size
measurement for the validated stable, link-free tree on the same GNU TAR runner.
It can reject a tree whose file bytes alone fit. The guard omits dereferencing:
links are forbidden, so valid trees have identical sizes to v4's archive, while
a racing symlink cannot make the guard read external data. `TAR_OPTIONS` and
`POSIXLY_CORRECT` must be absent so they cannot silently change archive semantics.

The guard rejects root/ancestor/nested symlinks, hard-linked files (including
links outside the root), special files, unsafe path components, unreadable
entries, and TAR errors. Directory-descriptor traversal uses no-follow opens;
nonblocking file opens avoid a FIFO replacement hanging the check. Before/after
snapshots compare paths, inodes, devices, modes, link counts, logical sizes,
mtime and ctime. Same-size rewrites, added/removed entries and root replacement
during the check fail closed. Access times are excluded because TAR reads may
update them.

This is a pre-upload check of a stable tree, not an atomic filesystem lock across
two Actions steps. A concurrent writer after the check is outside its guarantee;
the upload must immediately follow it, without a payload-mutating intervening
step or background producer. The existing release identity rechecks still run.
The guard neither truncates nor removes data, changes UI/source bytes, starts a
provider fetch, nor changes live Pages state.

## Existing financial seals

The new guard/tests and workflow edits change the protected controller inventory.
An already sealed candidate cannot be reused against this new controller without
reviewed rebinding and fresh validation under the existing authorization rules.
This patch does not update any runtime approval, candidate pin, or release intent;
an absent release intent remains absent. Passing the size guard grants no release
authority and does not make an oversized historical candidate publishable.
