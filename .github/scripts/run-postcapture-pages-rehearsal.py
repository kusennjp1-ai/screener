"""Bounded supervisor for the explicitly diagnostic, isolated Pages fixture.

This runner has no source/publication authority and no arbitrary command option.
Retrieval happens before entering a fresh network namespace. Only the fixed test
fixture is launched here; all committed production controls remain unchanged.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

PROCESS_SECONDS = 95 * 60
JOB_SECONDS = 110 * 60
UPLOAD_MARGIN_SECONDS = 10 * 60
MAX_CONSOLE_BYTES = 64 * 1024 * 1024
HEARTBEAT_SECONDS = 30
STAGE_MINIMUM_SECONDS = {"seal": 75 * 60, "publish": 90 * 60, "carry": 30 * 60}


def remaining_budget(job_started: float, now: float) -> float:
    if not isinstance(job_started, (int, float)) or not math.isfinite(job_started) or not math.isfinite(now) or not 0 < job_started <= now:
        raise ValueError("Invalid original job-start clock")
    remaining = min(PROCESS_SECONDS, job_started + JOB_SECONDS - UPLOAD_MARGIN_SECONDS - now)
    if remaining <= 0:
        raise ValueError("Rehearsal has no time remaining before its upload reserve")
    return remaining


def stage_budget(stage: str, job_started: float, now: float) -> float:
    budget = remaining_budget(job_started, now)
    if budget < STAGE_MINIMUM_SECONDS.get(stage, 0):
        raise ValueError(f"Insufficient remaining {stage} budget before upload reserve; do not repeat the sealed prefix")
    return budget


def actual_job_start(first_step: float, api_evidence: dict) -> float:
    value = api_evidence["caller"]["job"]["started_at"]
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Authenticated job-start clock needs a timezone")
    return min(first_step, parsed.timestamp())


def require_network_isolation(parent_namespace: str, current_namespace: str, environment: dict) -> None:
    if not parent_namespace.startswith("net:[") or not current_namespace.startswith("net:["):
        raise ValueError("Missing measured network namespace identity")
    if current_namespace == parent_namespace:
        raise ValueError("Rehearsal requires a distinct network namespace")
    for name in environment:
        if name in {"GH_TOKEN", "GITHUB_TOKEN", "SEC_USER_AGENT"} or name.endswith(("API_KEY", "ACCESS_TOKEN", "SECRET_KEY")):
            raise ValueError(f"Credential environment is forbidden in offline rehearsal: {name}")


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def run_supervised(command: list[str], *, output: Path, seconds: float,
                   environment: dict, heartbeat_seconds: float = HEARTBEAT_SECONDS,
                   phase_report: Path | None = None) -> dict:
    """The injectable command is used by unit tests; the CLI builds one fixed command."""
    output.mkdir(parents=True, exist_ok=False)
    started = time.time()
    deadline = time.monotonic() + seconds
    console = output / "console.log"
    record = {"schema_version": "postcapture-pages-supervisor-v1", "authority": "none",
              "status": "running", "started_at_epoch": started, "budget_seconds": seconds,
              "provider_acquisition": "forbidden_by_network_namespace", "exit_code": None}
    write_json(output / "supervisor.json", record)
    with console.open("wb") as handle:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT,
                                 env=environment, start_new_session=True)
        reason = None
        while child.poll() is None:
            if time.monotonic() >= deadline:
                reason = "process_deadline"
            elif console.stat().st_size > MAX_CONSOLE_BYTES:
                reason = "console_byte_limit"
            if reason:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=10)
                break
            heartbeat = {"time_epoch": time.time(), "elapsed_seconds": time.time() - started,
                         "remaining_seconds": max(0, deadline - time.monotonic()),
                         "console_bytes": console.stat().st_size}
            if phase_report is not None and phase_report.is_file() and not phase_report.is_symlink() and phase_report.stat().st_size <= 8 * 1024 * 1024:
                try:
                    heartbeat["phase"] = json.loads(phase_report.read_text()).get("current_phase")
                except (OSError, ValueError):
                    # The fixture rewrites its report at each transition; its
                    # append-only phase log remains the authoritative receipt.
                    heartbeat["phase_report_being_written"] = True
            with (output / "heartbeat.jsonl").open("a") as report:
                report.write(json.dumps(heartbeat) + "\n")
            print(json.dumps({"rehearsal_heartbeat": heartbeat}), flush=True)
            try:
                child.wait(timeout=min(heartbeat_seconds, max(.01, deadline - time.monotonic())))
            except subprocess.TimeoutExpired:
                pass
    with console.open("rb") as handle:
        console_hash = hashlib.file_digest(handle, "sha256").hexdigest()
    record.update(status="passed" if child.returncode == 0 and reason is None else "failed",
                  exit_code=child.returncode, stop_reason=reason,
                  finished_at_epoch=time.time(), elapsed_seconds=time.time() - started,
                  console_bytes=console.stat().st_size,
                  console_sha256=console_hash)
    write_json(output / "supervisor.json", record)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reports", required=True, type=Path)
    parser.add_argument("--node-modules", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path)
    parser.add_argument("--job-start", required=True, type=Path)
    parser.add_argument("--parent-network-namespace", required=True)
    parser.add_argument("--stage", choices=("full", "seal", "publish", "carry"), default="full")
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--checkpoint-sha256")
    args = parser.parse_args()
    paired = args.checkpoint is not None and args.checkpoint_sha256 is not None
    any_checkpoint = args.checkpoint is not None or args.checkpoint_sha256 is not None
    if (args.stage in {"publish", "carry"} and not paired) or (args.stage not in {"publish", "carry"} and any_checkpoint):
        parser.error("Only publish/carry require both checkpoint path and exact retained SHA-256")
    require_network_isolation(args.parent_network_namespace, os.readlink("/proc/self/ns/net"), dict(os.environ))
    inputs = json.loads(args.inputs.read_text())
    evidence = json.loads(Path(inputs["api_evidence"]).read_text())
    # GitHub's authenticated job clock includes initialization before our first
    # step, so setup can never consume the promised ten-minute upload reserve.
    started = actual_job_start(float(args.job_start.read_text().strip()), evidence)
    budget = stage_budget(args.stage, started, time.time())
    root = Path(__file__).resolve().parents[2]
    fixture = root / ".github/scripts/fixtures/postcapture-pages-rehearsal.mjs"
    # Keep the venv executable path: resolving its symlink would select the base
    # interpreter and silently discard the installed replay dependencies.
    python = str(args.python.absolute())
    command = ["node", "--max-old-space-size=3072", str(fixture), "--inputs", str(args.inputs.resolve()),
               "--output", str(args.output.resolve()), "--node-modules", str(args.node_modules.resolve()),
               "--python", python, "--stage", args.stage]
    if args.checkpoint is not None:
        command += ["--checkpoint", str(args.checkpoint.resolve()), "--checkpoint-sha256", args.checkpoint_sha256]
    environment = dict(os.environ)
    environment.update(FINANCIAL_REPLAY_PYTHON=python, PYTHONDONTWRITEBYTECODE="1",
                       LITELLM_LOCAL_MODEL_COST_MAP="true", NODE_OPTIONS="--max-old-space-size=3072")
    record = run_supervised(command, output=args.reports.resolve(), seconds=budget, environment=environment,
                            phase_report=args.output.absolute() / "report.json")
    return 0 if record["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
