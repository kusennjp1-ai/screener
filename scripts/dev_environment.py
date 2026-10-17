#!/usr/bin/env python3
"""Offline developer checks and explicit, local-only source checkpoints.

No network, installation, credential contents, Git mutations, or publish actions.
Python 3.11 standard library only. See docs/FREE_DEVELOPMENT.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone


FORMAT = "screener-source-checkpoint-v1"
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
SECRET_NAMES = {".env", ".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json",
                "secrets.json", "id_rsa", "id_ed25519", "id_ecdsa"}
SECRET_DIRS = {".git", ".ssh", ".aws", ".azure", ".config", "node_modules", ".venv", "venv"}
WINDOWS_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def run(args: list[str], cwd: Path | None = None, allowed=(0,)) -> subprocess.CompletedProcess:
    # Never print subprocess stderr: remote URLs / configuration can contain secrets.
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1")
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
                 "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(name, None)
    try:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(f"{Path(args[0]).name} could not complete ({type(exc).__name__})") from None
    if result.returncode not in allowed:
        raise ValueError(f"{Path(args[0]).name} command failed (exit {result.returncode})")
    return result


def git(repo: Path, *args: str, allowed=(0,)) -> bytes:
    return run(["git", "-c", "core.fsmonitor=false", "--literal-pathspecs", "-C", str(repo), *args], allowed=allowed).stdout


def repository(path: str | Path) -> Path:
    root = git(Path(path).resolve(), "rev-parse", "--show-toplevel").decode().strip()
    repo = Path(root).resolve()
    ensure_safe_git(repo)
    return repo


def ensure_safe_git(repo: Path) -> None:
    # Clean/process filters may run arbitrary helpers during diff or status, even
    # with --no-ext-diff. Fail before reading working-tree state; inspect key names only.
    if git(repo, "config", "--name-only", "--get-regexp", r"^filter\..*\.(clean|smudge|process|required)$", allowed=(0, 1)):
        raise ValueError("Configured Git filters require separate review; offline tooling will not execute them")
    if git(repo, "config", "--name-only", "--get-regexp", r"^(extensions\.partialclone|remote\..*\.promisor)$", allowed=(0, 1)):
        raise ValueError("Partial/promisor clones require separate review; offline tooling will not fetch missing objects")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hidden_index_paths(repo: Path) -> list[bytes]:
    entries = git(repo, "ls-files", "-v", "-z").split(b"\0")
    return [entry[2:] for entry in entries if entry and (entry[:1].islower() or entry[:1] == b"S")]


def is_link_or_reparse(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def changed_paths(repo: Path) -> list[str]:
    # Name-only metadata. No config values, remote URLs, or file contents.
    raw = git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "HEAD")
    raw += git(repo, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z")
    raw += git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z")
    raw += git(repo, "ls-files", "--others", "--exclude-standard", "-z")
    return sorted(set(raw.decode("utf-8", "strict").rstrip("\0").split("\0")) - {""})


def doctor(repo: Path) -> dict:
    ensure_safe_git(repo)
    checks = []

    def add(name, state, detail):
        checks.append({"name": name, "state": state, "detail": detail})

    head = git(repo, "rev-parse", "HEAD").decode().strip()
    branch = git(repo, "symbolic-ref", "--quiet", "--short", "HEAD", allowed=(0, 1)).decode().strip()
    add("branch", "ok" if branch and branch not in {"main", "master"} else "warning",
        f"{branch}; use a task branch, not the default branch" if branch in {"main", "master"}
        else branch or "Detached HEAD. Create or select a task branch before committing.")
    changes = changed_paths(repo)
    add("worktree", "ok" if not changes else "warning", f"{len(changes)} changed or untracked path(s)")
    hidden = hidden_index_paths(repo)
    add("index-visibility", "warning" if hidden else "ok",
        f"{len(hidden)} assume-unchanged/skip-worktree path(s); these can hide changes from Git")
    remotes = git(repo, "remote").decode().splitlines()
    add("remote", "ok" if remotes else "warning", f"{len(remotes)} configured remote(s); URLs not inspected")
    upstream = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}",
                   allowed=(0, 128)).decode().strip()
    add("upstream", "ok" if upstream else "warning",
        "Configured; not fetched or verified" if upstream else "No upstream; remote head not verified")
    add("python", "ok" if sys.version_info[:2] == (3, 11) else "warning",
        f"{sys.version.split()[0]}; CI family is Python 3.11")
    node = shutil.which("node")
    if node:
        version = run([node, "--version"]).stdout.decode().strip()
        add("node", "ok" if re.fullmatch(r"v22\.\d+\.\d+", version) else "warning",
            f"{version}; CI family is Node 22")
    else:
        add("node", "error", "Node is missing; no installer was run")
    add("npm", "ok" if shutil.which("npm") else "error",
        "Available" if shutil.which("npm") else "Missing")
    add("frontend-lock", "ok" if (repo / "frontend/package-lock.json").is_file() else "error",
        "Use the committed package-lock.json with npm ci")
    add("frontend-dependencies", "ok" if (repo / "frontend/node_modules").is_dir() else "warning",
        "Installed directory present; lock parity not established" if (repo / "frontend/node_modules").is_dir()
        else "Dependencies absent; no installation was attempted")
    add("backend-requirements", "ok" if all((repo / p).is_file() for p in
        ["backend/requirements.txt", "backend/requirements-test.txt"]) else "error",
        "Existing requirements are reused; this check does not claim a fully locked Python dependency graph")
    free = shutil.disk_usage(repo).free
    add("disk", "ok" if free >= 4 * 1024**3 else "warning",
        f"{free / 1024**3:.1f} GiB free; 4 GiB is a local warning threshold, not a CI resource guarantee")
    # Inspect names only. Never run credential fill, auth token, keychain, or secret reads.
    helper_names = git(repo, "config", "--name-only", "--get-regexp", r"^credential(\..+)?\.helper$",
                       allowed=(0, 1))
    hints = {"git_helper_key_present": bool(helper_names),
             "gh_installed": bool(shutil.which("gh")),
             "token_environment_name_present": any(name in os.environ for name in ("GH_TOKEN", "GITHUB_TOKEN")),
             "ssh_agent_environment_name_present": "SSH_AUTH_SOCK" in os.environ}
    add("authentication", "unverified", {**hints, "push_access": "Not tested. Hints are not proof of authorization."})
    add("cost", "unverified", "Offline check only; account usage, storage allowance, budgets and billing are not verified")
    return {"head": head, "checks": checks, "scope": "offline preflight only; no tests or release gates were run"}


def safe_path(value: str) -> str:
    # Literal POSIX relative paths work on Windows and Unix; no traversal or pathspecs.
    if not value or "\\" in value or ":" in value or "\0" in value:
        raise ValueError("Use an explicit repository-relative path with forward slashes")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {".", ".."} for part in value.split("/")):
        raise ValueError("Absolute, empty-component, and traversal paths are not allowed")
    if "" in value.split("/"):
        raise ValueError("Empty path components are not allowed")
    for part in path.parts:
        lower = part.lower()
        if part.endswith((".", " ")) or any(ord(char) < 32 for char in part) or lower.split(".")[0] in WINDOWS_RESERVED:
            raise ValueError("Windows-ambiguous or control-character paths are not allowed")
        if lower in SECRET_NAMES or lower in SECRET_DIRS or lower.startswith(".env.") or lower.endswith((".pem", ".key", ".p12", ".pfx")):
            raise ValueError("Credential, environment, dependency, and Git metadata paths cannot be checkpointed")
    return str(path)


def selected_state(repo: Path, paths: list[str]) -> dict:
    result = {}
    for name in paths:
        path = repo / name
        current = repo
        for part in PurePosixPath(name).parts:
            current /= part
            if is_link_or_reparse(current):
                raise ValueError("Symlinks and Windows reparse points cannot be checkpointed")
        if path.exists() and not path.is_file():
            raise ValueError("Select files explicitly, not directories")
        if path.exists() and path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("Selected file exceeds the 16 MiB checkpoint limit")
        result[name] = digest(path.read_bytes()) if path.is_file() else None
    return result


def checkpoint(repo: Path, destination: Path, names: list[str]) -> dict:
    ensure_safe_git(repo)
    if hidden_index_paths(repo):
        raise ValueError("Index contains assume-unchanged/skip-worktree paths; review those flags before checkpointing")
    paths = sorted(set(safe_path(name) for name in names))
    if not paths:
        raise ValueError("At least one explicit source file is required")
    destination = destination.resolve()
    if destination == repo or repo in destination.parents:
        raise ValueError("Checkpoint output must be outside the repository")
    if destination.exists():
        raise ValueError("Output already exists; checkpoints are never overwritten")
    if not destination.parent.is_dir():
        raise ValueError("Output parent must already exist")
    before = selected_state(repo, paths)
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    payloads = {}
    for name in paths:
        index_tracked = bool(git(repo, "ls-files", "-z", "--", name))
        head_tracked = bool(git(repo, "ls-tree", "HEAD", "--", name))
        if not index_tracked and before[name] is not None:
            # Ignored files often contain private data. Even explicit selection cannot include them.
            # check-ignore accepts literal pathnames and rejects Git's literal pathspec magic.
            if run(["git", "-c", "core.fsmonitor=false", "-C", str(repo), "check-ignore", "--quiet", "--", name],
                   allowed=(0, 1)).returncode == 0:
                raise ValueError("Ignored files cannot be checkpointed")
        if not index_tracked and not head_tracked and before[name] is None:
            raise ValueError("A selected file is neither tracked nor present")
        if before[name] is not None:
            # Raw working bytes also cover line-ending normalization and staged
            # deletion followed by an untracked replacement at the same pathname.
            payloads[f"working-files/{name}"] = (repo / name).read_bytes()
    patch = git(repo, "diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv",
                "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--no-relative", "--unified=3",
                "--line-prefix=", "--output-indicator-new=+", "--output-indicator-old=-",
                "--output-indicator-context= ", "HEAD", "--", *paths)
    payloads["changes.patch"] = patch
    if sum(map(len, payloads.values())) > MAX_TOTAL_BYTES:
        raise ValueError("Checkpoint exceeds the 64 MiB limit")
    if selected_state(repo, paths) != before or git(repo, "rev-parse", "HEAD").decode().strip() != head:
        raise ValueError("Source changed during capture; no checkpoint was created")
    manifest = {"format": FORMAT, "created_utc": datetime.now(timezone.utc).isoformat(),
                "base_head": head, "selected_paths": paths,
                "excluded_changed_paths": sorted(set(changed_paths(repo)) - set(paths)),
                "working_file_sha256": before,
                "files": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in payloads.items()},
                "scope": "Selected raw working files and a Git patch only. Git history, staging state, file permissions, ignored files and other paths are not backed up.",
                "release_status": "Not evaluated. This checkpoint is not publication approval."}
    # Exclusive creation prevents overwriting another checkpoint, including races.
    destination.mkdir()
    try:
        for name, data in payloads.items():
            output = destination / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
        # Manifest last: interruption before this point cannot look complete.
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        verify_checkpoint(destination)
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    return manifest


def verify_checkpoint(directory: Path) -> dict:
    directory = directory.resolve()
    manifest_path = directory / "manifest.json"
    if is_link_or_reparse(manifest_path) or manifest_path.stat().st_size > 1024 * 1024:
        raise ValueError("Invalid checkpoint manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or not isinstance(manifest.get("base_head"), str) or not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", manifest["base_head"]):
        raise ValueError("Unsupported or invalid checkpoint manifest")
    files = manifest.get("files")
    if not isinstance(files, dict) or "changes.patch" not in files:
        raise ValueError("Checkpoint file list is invalid")
    total = 0
    for name, expected in files.items():
        if not isinstance(name, str):
            raise ValueError("Invalid checkpoint pathname")
        name = safe_path(name)
        if name != "changes.patch" and not name.startswith("working-files/"):
            raise ValueError("Unexpected checkpoint file")
        path = directory / name
        current = directory
        for part in PurePosixPath(name).parts:
            current /= part
            if is_link_or_reparse(current):
                raise ValueError("Symlinks and reparse points are not allowed in a checkpoint")
        if not path.is_file() or path.stat().st_size > MAX_TOTAL_BYTES:
            raise ValueError("Checkpoint file missing or oversized")
        data = path.read_bytes()
        total += len(data)
        if total > MAX_TOTAL_BYTES or not isinstance(expected, dict) or len(data) != expected.get("bytes") or digest(data) != expected.get("sha256"):
            raise ValueError("Checkpoint integrity check failed")
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file() or p.is_symlink()}
    if actual != set(files) | {"manifest.json"}:
        raise ValueError("Checkpoint contains unlisted files")
    return {"verified": True, "base_head": manifest["base_head"], "files": len(files),
            "scope": "Local integrity only; manifest is not a signed authenticity proof or release gate"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="Repository directory (default: current directory)")
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("doctor", help="Offline read-only readiness checks")
    check.add_argument("--strict", action="store_true", help="Return 2 for environment warnings as well as errors")
    capture = commands.add_parser("checkpoint", help="Save only explicitly selected source-file changes locally")
    capture.add_argument("--output", required=True, type=Path)
    capture.add_argument("--paths", required=True, nargs="+")
    verify = commands.add_parser("verify-checkpoint", help="Read and hash a checkpoint without applying it")
    verify.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "verify-checkpoint":
            result = verify_checkpoint(args.directory)
        else:
            repo = repository(args.repo)
            result = doctor(repo) if args.command == "doctor" else checkpoint(repo, args.output, args.paths)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if args.command == "doctor" and any(c["state"] == "error" or (args.strict and c["state"] == "warning") for c in result["checks"]):
            return 2
        return 0
    except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"Developer tooling stopped: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
