# Reproducible development with no new paid service

This is a local tooling foundation for the existing screener project. It does not
publish UI, repair Design Acceptance inputs, admit fresh financial evidence, or
change release gates. A passing local check is not release approval.

## Supported foundation

- Use one normal Git checkout and a separate task branch/worktree per change.
- Target the existing CI runtime families: **Node 22** and **Python 3.11**.
  `.nvmrc` and `.python-version` record that choice; they do not install anything.
  CI currently pins those families, not identical patch versions across all machines.
- Reuse `frontend/package-lock.json` with `npm ci`. Reuse the existing backend
  requirements. Python requirements are not claimed to be a complete lockfile.
- Keep GitHub Actions as the existing CI system and GitHub Pages as the existing
  static-site destination. No new runner, VPS, API subscription, token or service
  is required by this patch.
- If an AI task executor is quota-blocked, local source checkpoints and ordinary
  Git remain usable by a person with access to that checkout. This toolkit does
  not change AI quotas or prove that an assistant can operate another computer.

## 1. Check before doing expensive work

Run from the repository root. Unix/macOS:

```sh
python3.11 scripts/dev_environment.py doctor
python3.11 scripts/dev_environment.py doctor --strict
```

Windows PowerShell, when Python 3.11 is already installed:

```powershell
py -3.11 scripts/dev_environment.py doctor
py -3.11 scripts/dev_environment.py doctor --strict
```

The script itself uses only the Python standard library and also runs on newer
Python versions, but reports a CI-version warning. It checks Git state, branch,
remote/upstream presence, Node/Python families, dependency inputs, installed
frontend directory and free disk. It performs no network operation, installation,
authentication, Git mutation or configuration change. Its JSON goes to stdout.
Git's filesystem-monitor helper is disabled for these individual commands, and
configured clean/smudge/process filters are rejected before working-tree checks.
Repository settings are not changed; filtered repositories need separate review.
Partial/promisor clones are also rejected so missing objects cannot trigger a
network fetch. Inherited Git directory/index overrides cannot redirect the tool
away from the selected checkout.
Doctor also warns about assume-unchanged/skip-worktree index flags that can hide
changes; checkpoints stop if any such flags are present.

Credential reporting examines only environment variable names and credential-helper
configuration key names. It never requests credential contents. A helper, agent,
token-variable name, `gh` installation, or connector permission is **not proof of
working Git push access**. Remote URLs are not printed. A normal exit code of 0
means no preflight errors; it does not mean tests passed, credentials work, or
costs are verified. `--strict` returns 2 for environmental warnings too.

## 2. Bounded checks and logs

Run these separately, record the exit code, and stop at the first failure:

```sh
python3.11 -m unittest discover -s scripts -p test_dev_environment.py -v
cd frontend
npm run lint
npm run test:run
```

On Windows replace `python3.11` with `py -3.11`. Record each command, exact Git HEAD,
runtime versions, start/end time and exit code in a local log outside the repo.
Use ordinary shell output redirection if desired. Keep secrets out of logs.

Run the toolkit tests first (small, isolated temporary repos). Frontend lint and
Vitest are bounded processes using already installed dependencies. They are a
local subset, not all configured CI checks, backend tests, browser/Design checks,
or real-source acceptance. Some project tests may access project-specific fixtures
or external resources; only the toolkit test suite is guaranteed by this patch
to need no network. Do not infer an offline full-CI pass.

If dependencies are missing, stop and prepare them deliberately from the existing
lockfile/requirements in the chosen environment. The doctor never installs them.
Do not add paid APIs or LLM keys just to test this developer toolkit or static UI
fixtures. Full backend server setup is a separate workflow in DEVELOPMENT.md.

## 3. Save an explicit local source checkpoint

Choose only reviewed source paths. Use an existing parent directory **outside**
the checkout. The destination must not exist. Example on Unix/macOS:

```sh
python3.11 scripts/dev_environment.py checkpoint --output ../screener-checkpoint-001 --paths scripts/dev_environment.py scripts/test_dev_environment.py docs/FREE_DEVELOPMENT.md
python3.11 scripts/dev_environment.py verify-checkpoint ../screener-checkpoint-001
```

PowerShell uses the same arguments after `py -3.11`. Source paths use forward
slashes on every platform; output may use the platform's native path syntax.
Spaces are supported when quoted. This is a local source checkpoint, not the
separate reviewed UI handoff package.

The checkpoint contains an exact base commit ID, selected-path manifest, SHA-256
hashes, a binary-capable patch for tracked changes, and raw copies of all selected
working files. Raw copies also preserve line endings and a replacement created
after a staged deletion. It preserves working-tree content, **not staging state
or Git history**. File permission metadata is not backed up. Ignored files,
common credential/environment paths, symlinks, directories and oversize files are
rejected. The tool cannot prove arbitrary source text is secret-free: review
selected contents before sharing anything. Nothing is uploaded automatically.
Windows-ambiguous names and reparse points are rejected. Linux tests cover these
rules, including simulated reparse metadata; actual Windows execution remains
unverified, so platform-equivalent operation is not yet certified.

Inspect `excluded_changed_paths`: paths listed there are **not backed up**. Other
ignored/private files are never included or inventoried. Existing checkpoints are
never overwritten. A checkpoint without a valid manifest and successful integrity
verification is incomplete; do not rely on it. Hash verification checks accidental
corruption, not authenticity of a modified manifest.

For recovery, use a new, clean checkout at the recorded `base_head`, verify the
checkpoint, inspect the patch, and run `git apply --check /path/to/changes.patch`
before `git apply /path/to/changes.patch`. An empty patch needs no application.
Then copy reviewed files under `working-files/` into matching repository-relative
paths in that new recovery checkout, including tracked files, to preserve exact
raw bytes. Do not overwrite unrelated work. Recheck file modes when relevant.
The tool deliberately does not restore, reset, stage, commit or push for you.

## 4. Human-controlled Git publication

Use an existing authorized Git login in the selected executor. Never place a token
in this script, a remote URL, chat, a checkpoint, or a log. If a new credential or
persistent grant is needed, stop for the owner's specific secure authorization.

For the currently authorized existing PR only, a person should freshly verify its
repository, branch and exact remote head, fetch that branch, and compare it with
the reviewed base before committing/pushing. If the remote advanced or diverged,
stop and reconcile/retest. Push only the reviewed task branch with an ordinary,
non-force push. Do not target `main`, use force, create another PR, or run a release
as an automatic fallback. Re-read the remote exact head and its CI after a push.

CI and Design workflows intentionally cancel older in-progress runs when newer
commits arrive on the same ref. Avoid overlapping pushes while measuring one
candidate. Track checks by exact SHA. The publisher already uses a serialized
concurrency group with `cancel-in-progress: false`; queued events can still be
replaced under GitHub's default single-pending behavior. No concurrency policy is
changed here, and these facts do not diagnose a connector-tool cancellation.

## Cost and release boundaries

As verified from GitHub documentation on 2026-10-15, standard GitHub-hosted runner
execution for public repositories is free, and GitHub Pages is available for
public repositories on GitHub Free. This repository is public. Larger runners,
artifact storage and cache overages have separate billing conditions; account
usage/budgets have not been verified. This patch creates no new artifact/cache
uploads and changes no billing settings. Do not call the entire account cost-free.

GitHub Pages has a 1 GB published-site limit and a soft 100 GB/month bandwidth
limit. GitHub-hosted jobs have a 6-hour limit; a free service is not an unlimited,
always-on development computer. Keep existing payload and financial freshness
guards. Passing ordinary CI, synthetic fixtures or this toolkit does not satisfy
real-data Design Acceptance or authorize a merge/deployment.

Official references:
- [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Actions limits](https://docs.github.com/en/actions/reference/limits)
- [Concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
