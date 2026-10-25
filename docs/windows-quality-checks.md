# Full validation from Windows

The frontend full suite validates real POSIX file modes, symbolic links, Python
archives and executable Git/GitHub fixtures. Run it on Linux, as CI does. Native
Windows `npm run test:run` is useful for component tests but cannot reproduce
those operating-system contracts; do not skip or weaken them to make it green.

With WSL Ubuntu installed, run from `frontend` in PowerShell:

```powershell
npm run test:linux -- --setup-runtime --maxWorkers=2
```

The first run downloads the checksum-pinned Node 22 runtime into WSL's
`/var/tmp`, then installs locked npm dependencies. Ubuntu must provide Git,
Python 3, curl and tar. Subsequent runs can omit `--setup-runtime`. Set
`SCREENER_WSL_DISTRO` to use another installed Linux distribution.

The command makes a temporary native Linux clone and applies current staged,
unstaged and untracked source. It does not reset the working checkout, run tests
against an older commit, or change production code. It returns the actual Vitest
exit status and removes its disposable clone after completion. Ignored files,
local dependencies and exported data are not copied.

Individual files and Vitest options can follow `--`. For example:

```powershell
npm run test:linux -- tools/publication-cli.test.mjs --maxWorkers=1
```

ESLint, the static build and Playwright Chromium tests can run natively on
Windows. `.gitattributes` keeps hash-bound tooling and workflow fixtures in LF
on both platforms; an existing checkout may need its affected files refreshed
after changing attributes. Do not modify expected fixture hashes to compensate
for CRLF conversion.
