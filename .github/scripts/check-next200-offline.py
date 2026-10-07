"""New reviewed reconstruction checks; provider-disconnected runtime matrix."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import signal
import stat
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ".github/bounded-refresh-next-200/offline-ci-manifest.json"
OUTPUTS = ("source-manifest.json", "results.json", "python-tests.log", "node-tests.log")
PYTHON_TESTS = [
    "backend/tests/unit/test_postcapture_next_200_preparation.py",
    "backend/tests/unit/test_postcapture_next_200_collector.py",
    "backend/tests/unit/test_next200_consumer_selection.py",
    "backend/tests/unit/test_financial_statement_batch.py",
    "backend/tests/unit/test_statement_refresh_planning.py",
    "backend/tests/unit/test_statement_refresh_collection.py",
    "backend/tests/unit/test_statement_artifact_archive.py",
    "backend/tests/unit/test_quarterly_eps_pair_selection.py",
    "backend/tests/unit/test_bounded_statement_refresh_bridge.py",
    "backend/tests/unit/test_statement_retention_budget.py",
    "backend/tests/unit/test_statement_writer_lock_preparation.py",
    ".github/scripts/verify-postcapture-correction-archive.test.py",
    ".github/scripts/verify-postcapture-statement-baseline.test.py",
    ".github/scripts/check-next200-offline.test.py",
]
NODE_TESTS = [".github/scripts/restore-statement-source.test.mjs",
              ".github/scripts/verify-postcapture-correction-source.test.mjs",
              ".github/scripts/restore-postcapture-statement-source.test.mjs"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(path):
    raw = path.read_bytes()
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify_sources(root=ROOT):
    manifest = json.loads((root / MANIFEST).read_text())
    require(manifest["provider_dispatch_permitted"] is False and manifest["activation_ready"] is False,
            "Recovered offline authority changed")
    checked = {}
    for name, expected in {**manifest["files"], **manifest["unchanged_authority_files"]}.items():
        checked[name] = identity(root / name)
        require(checked[name] == {k: expected[k] for k in ("bytes", "sha256")}, "Pinned bytes changed: " + name)
    require(manifest.get("closure_scope") == "complete_checkout_excluding_git_metadata" and
            manifest.get("manifest_self_excluded") is True, "Complete checkout dependency inventory is required")
    expected_names = set(checked) | {MANIFEST}
    actual_names = set()
    for directory, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name != ".git"]
        for name in directories:
            require(not (Path(directory) / name).is_symlink(), "Symlink in dependency closure")
        for name in files:
            path = Path(directory) / name
            if path == root / ".git":
                continue
            require(stat.S_ISREG(path.lstat().st_mode) and path.stat().st_nlink == 1,
                    "Special or linked dependency")
            actual_names.add(path.relative_to(root).as_posix())
    require(actual_names == expected_names, "Unpinned or missing checkout dependency")
    value = json.loads((root / ".github/bounded-refresh-next-200/dispatch-execution.json").read_text())
    require(value["execution_enabled"] is False and value["expected_run_number"] is None,
            "Recovered next-200 execution must remain disabled")
    require(len(value["missing_prior_decisions"]) == 4 and all(
        x["decision_state"] == "retry_decision_required" and x["retry_not_before"] is None
        for x in value["missing_prior_decisions"]), "Four unresolved decisions required")
    return {"base_commit": manifest["base_commit"], "base_tree": manifest["base_tree"],
            "verified_files": checked, "unresolved_dependencies": manifest["unresolved_dependencies"]}


def live_group(group):
    members = []
    for path in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            if int(fields[2]) == group and fields[0] != "Z":
                members.append(int(path.parent.name))
        except FileNotFoundError:
            pass
    return members


def stop_group(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            process.poll()
            if not live_group(process.pid):
                break
            time.sleep(0.05)
        if not live_group(process.pid):
            break
    process.wait(timeout=1)
    require(not live_group(process.pid), "Live descendants remain after bounded cleanup")


def run_command(command, log, env, timeout):
    process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        try:
            return process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124
    finally:
        stop_group(process)


def run(output, host_namespace, preflight_only=False, local_runtime=False):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    require(not any(output.iterdir()), "Evidence directory must be empty")
    for name in ("python-tests.log", "node-tests.log"):
        (output / name).write_text("Not run.\n")
    write(output / "source-manifest.json", {"verified": False})
    result = {"schema_version": "next200-recovered-offline-results-v1", "passed": False,
              "python": platform.python_version(), "node": None, "tests": {},
              "target_runtime_validated": False, "activation_ready": False,
              "provider_dispatch_permitted": False, "historical_tests_reused": False}
    result["local_runtime_only"] = local_runtime
    def interrupted(signum, frame):
        raise InterruptedError("Offline supervisor received signal " + str(signum))
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        require(os.getpid() == 1 and os.readlink("/proc/self/ns/net") != host_namespace,
                "Dedicated PID and network namespaces are mandatory")
        require([x.split(":", 1)[0].strip() for x in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"],
                "Network namespace has an external interface")
        require(len(Path("/proc/net/route").read_text().splitlines()) <= 1, "Network route present")
        result["namespace_verified"] = True
        source = verify_sources()
        write(output / "source-manifest.json", source)
        result["unresolved_dependencies"] = source["unresolved_dependencies"]
        require(not source["unresolved_dependencies"], "Historical runtime dependencies remain unresolved")
        result["node"] = subprocess.check_output(["node", "--version"], text=True).strip()
        target = sys.version_info[:2] == (3, 11) and result["node"].split(".")[0] == "v22"
        require(target or local_runtime, "Target CI requires Python 3.11 and Node 22")
        result["target_runtime_validated"] = target and not local_runtime
        if not preflight_only:
            env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR") if k in os.environ}
            env.update(PYTHONPATH=str(ROOT / "backend"), PYTHONDONTWRITEBYTECODE="1",
                       PYTEST_DISABLE_PLUGIN_AUTOLOAD="1", LITELLM_LOCAL_MODEL_COST_MAP="true")
            commands = {"python": [sys.executable, "-m", "pytest", "--noconftest", "--import-mode=importlib",
                                    "-p", "no:cacheprovider", *PYTHON_TESTS, "-q"],
                        "node": ["node", "--test", "--test-concurrency=2", *NODE_TESTS]}
            deadline = time.monotonic() + 360
            for name, command in commands.items():
                with (output / (name + "-tests.log")).open("w") as log:
                    left = deadline - time.monotonic()
                    code = run_command(command, log, env, min(300, left)) if left > 0 else 124
                    result["tests"][name] = {"exit_code": code, "command": command}
            require(all(x["exit_code"] == 0 for x in result["tests"].values()), "Offline suite failed")
        require(verify_sources() == source, "Source changed during verification")
        result["passed"] = True
    except BaseException:
        result["error"] = traceback.format_exc()
    finally:
        write(output / "results.json", result)
        require({x.name for x in output.iterdir()} == set(OUTPUTS), "Unexpected output file")
        write(output / "artifact-manifest.json", {"files": {n: identity(output / n) for n in OUTPUTS},
              "upload_paths": [*OUTPUTS, "artifact-manifest.json"], "manifest_self_excluded": True})
        signal.signal(signal.SIGTERM, previous)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--host-network-namespace", required=True)
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--local-runtime", action="store_true", help="Run the same bounded matrix locally; never a target CI pass")
    args = parser.parse_args()
    sys.exit(run(args.output, args.host_network_namespace, args.preflight_only, args.local_runtime))
