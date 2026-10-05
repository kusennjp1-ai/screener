#!/usr/bin/env python3
"""Bound one offline lifecycle test without sharing its process group.

The child may block in synchronous Node/native work. This separate process uses
a monotonic deadline, preserves ordinary exit codes, and kills only the session
it created. On timeout the work stops immediately; evidence upload is the next
workflow step. No command arguments, environment or child payloads are logged.
"""
from __future__ import annotations

import argparse
import ctypes
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def reap_descendants(leader):
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return
        if pid == leader.pid:
            leader.returncode = os.waitstatus_to_exitcode(status)


def kill_group(group):
    # Popen(start_new_session=True) makes this the child's unique session/group,
    # never the watchdog's, shell's, runner's or another task's process group.
    if group <= 1 or group == os.getpgrp():
        raise RuntimeError("Refusing to signal an unowned process group")
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass


def adopted_children():
    # The supervisor launches only the test. After its leader/group is killed,
    # subreaper adoption also identifies test descendants that called setsid().
    # Their unreaped PIDs cannot be reused before our own waitpid call.
    path = Path(f"/proc/self/task/{os.getpid()}/children")
    try:
        return [int(pid) for pid in path.read_text().split()]
    except FileNotFoundError:
        # Some Linux kernels omit the optional proc children interface. Read
        # only PID/PPID metadata, never another process's environment or argv.
        children = []
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                fields = (entry / 'stat').read_text().rpartition(')')[2].split()
                if int(fields[1]) == os.getpid():
                    children.append(int(entry.name))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
        return children


def retained_progress(directory):
    try:
        report = json.loads((directory / "report.json").read_text())
    except (OSError, ValueError):
        return {"last_phase": None, "last_command": None}
    phases, commands = report.get("phases", []), report.get("commands", [])
    return {
        "last_phase": report.get("active_phase") or (phases[-1].get("phase") if phases else None),
        "last_command": report.get("active_command") or (commands[-1].get("label") if commands else None),
        "last_progress_elapsed_ms": report.get("elapsed_ms"),
    }


class Interrupted(Exception):
    def __init__(self, signum):
        self.signum = signum


class InsufficientBudget(Exception):
    pass


def job_allocation(clock_path, requested, job_timeout, reserve, minimum, now):
    """Use the first workflow step's monotonic clock, on this same runner."""
    if clock_path.stat().st_size > 4096:
        raise ValueError("Invalid early job clock size")
    clock = json.loads(clock_path.read_text())
    if not isinstance(clock, dict):
        raise ValueError("Invalid early job clock")
    started = clock.get("started_monotonic_seconds")
    if (clock.get("schema_version") != "offline-financial-lifecycle-job-clock-v1"
            or type(started) not in (int, float) or not math.isfinite(started)
            or started < 0 or started > now):
        raise ValueError("Invalid early job clock")
    preparation = now - started
    remaining = job_timeout - preparation
    effective = max(0, min(requested, remaining - reserve))
    return {"job_started_at": clock.get("started_at"), "job_timeout_seconds": job_timeout,
            "preparation_elapsed_seconds": round(preparation, 3),
            "remaining_job_seconds": round(max(0, remaining), 3),
            "upload_reserve_seconds": reserve, "minimum_runtime_seconds": minimum,
            "effective_timeout_seconds": effective}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--allocation-reason")
    parser.add_argument("--heartbeat-seconds", type=float, default=30)
    parser.add_argument("--job-clock", type=Path)
    parser.add_argument("--job-timeout-seconds", type=float, default=5400)
    parser.add_argument("--upload-reserve-seconds", type=float, default=600)
    parser.add_argument("--minimum-runtime-seconds", type=float, default=3600)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not 0 < args.timeout_seconds <= 4500:
        parser.error("a command and a positive deadline of at most 4500 seconds are required")
    if args.timeout_seconds > 1800 and not args.allocation_reason:
        parser.error("an allocation above the 1800-second default requires an explicit reason")
    if args.allocation_reason and (len(args.allocation_reason) > 300 or any(ord(c) < 32 for c in args.allocation_reason)):
        parser.error("the allocation reason must be one short line")
    if not 0 < args.heartbeat_seconds <= 60:
        parser.error("the heartbeat interval must be positive and at most 60 seconds")
    if args.job_clock and not (math.isfinite(args.job_timeout_seconds) and args.job_timeout_seconds > 0
                              and 0 < args.upload_reserve_seconds < args.job_timeout_seconds
                              and 0 < args.minimum_runtime_seconds <= args.timeout_seconds):
        parser.error("invalid remaining-job runtime/reserve allocation")
    if sys.platform != "linux":
        parser.error("this workflow watchdog requires Linux process sessions")
    # Reap orphaned grandchildren ourselves, including a child whose leader
    # exits first. This is process-local and changes no system setting.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "Cannot supervise lifecycle descendants")

    started, started_at = time.monotonic(), timestamp()
    record = {"schema_version": "offline-financial-lifecycle-watchdog-v1", "authority": "none",
              "started_at": started_at, "timeout_seconds": args.timeout_seconds,
              "requested_timeout_seconds": args.timeout_seconds,
              "allocation_reason": args.allocation_reason or "Default lifecycle allocation (maximum 1800 seconds).",
              "command": Path(command[0]).name, "heartbeat_seconds": args.heartbeat_seconds, "heartbeat_count": 0, "heartbeats": []}
    process, child_code, status, exit_code = None, None, "failed", 127
    print(f"Lifecycle watchdog start: requested limit {args.timeout_seconds:g}s", flush=True)

    def interrupt(signum, _frame):
        raise Interrupted(signum)

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupt)

    def persist_record(create=False):
        if create:
            args.report_directory.mkdir(parents=True, exist_ok=True)
        if args.report_directory.is_dir():
            temporary = args.report_directory / "watchdog.json.tmp"
            temporary.write_text(json.dumps(record, indent=2) + "\n")
            temporary.replace(args.report_directory / "watchdog.json")

    try:
        effective_timeout = args.timeout_seconds
        if args.job_clock:
            try:
                allocation = job_allocation(args.job_clock, args.timeout_seconds, args.job_timeout_seconds,
                                            args.upload_reserve_seconds, args.minimum_runtime_seconds, started)
            except (OSError, ValueError, TypeError) as exc:
                raise InsufficientBudget("The early job clock is missing or invalid; the expensive test was not launched.") from exc
            record["job_budget"] = allocation
            effective_timeout = allocation["effective_timeout_seconds"]
            record["timeout_seconds"] = effective_timeout
            print(f"Lifecycle job budget: preparation {allocation['preparation_elapsed_seconds']:.3f}s; "
                  f"effective test limit {effective_timeout:.3f}s; upload reserve {args.upload_reserve_seconds:g}s", flush=True)
            if effective_timeout < args.minimum_runtime_seconds:
                raise InsufficientBudget("Remaining job time cannot provide the minimum useful test runtime plus the artifact-upload reserve; the test was not launched.")
        child_environment = {**os.environ, "FINANCIAL_RELEASE_ARCHIVE_WATCHDOG_SECONDS": str(effective_timeout)}
        process = subprocess.Popen(command, start_new_session=True, env=child_environment)
        deadline, next_heartbeat = started + effective_timeout, started + args.heartbeat_seconds
        previous_progress = None
        while True:
            try:
                child_code = process.wait(timeout=max(0, min(deadline, next_heartbeat) - time.monotonic()))
                break
            except subprocess.TimeoutExpired:
                now = time.monotonic()
                if now >= deadline:
                    raise
                progress = retained_progress(args.report_directory)
                changed = progress != previous_progress
                heartbeat = {"at": timestamp(), "elapsed_seconds": round(now - started, 3),
                             "progress_changed": changed, **progress}
                record["heartbeats"].append(heartbeat)
                record["heartbeat_count"] += 1
                record["heartbeats"] = record["heartbeats"][-256:]
                record.update(status="running", partial_execution=True, elapsed_seconds=heartbeat["elapsed_seconds"], **progress)
                persist_record()
                phase = str(progress["last_phase"] or "not started")[:120]
                command_label = str(progress["last_command"] or "none")[:120]
                print(f"Lifecycle watchdog heartbeat: elapsed {heartbeat['elapsed_seconds']:.3f}s; "
                      f"last phase {phase}; last command {command_label}; "
                      f"{'new phase/command evidence' if changed else 'no new phase/command evidence'}", flush=True)
                previous_progress = progress
                next_heartbeat = now + args.heartbeat_seconds
        exit_code = child_code if child_code >= 0 else 128 - child_code
        status = "completed" if exit_code == 0 else "failed"
    except subprocess.TimeoutExpired:
        status, exit_code = "timed_out", 124
        record["reason"] = f"The {record['timeout_seconds']:g}-second lifecycle work allocation expired; only partial execution is established."
    except InsufficientBudget as exc:
        status, exit_code = "insufficient_job_budget", 125
        record["reason"] = str(exc)
    except Interrupted as exc:
        status, exit_code = "interrupted", 128 + exc.signum
        record["reason"] = f"The watchdog received signal {exc.signum}; execution is partial."
    except OSError as exc:
        record["reason"] = f"Cannot start lifecycle command (errno {exc.errno})."
    finally:
        # Stop every remaining member even if its leader returned successfully.
        # Timeout receives no extra work grace period beyond the stated budget.
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, signal.SIG_IGN)
        if process is not None:
            # A successful wait() already reaped the leader. Its old numeric
            # PGID could now be reused, so only signal the group while that
            # leader identity is still ours. After reaping, adopted children
            # provide the exclusive cleanup boundary, including detached ones.
            if process.returncode is None:
                kill_group(process.pid)
            cleanup_deadline = time.monotonic() + 2
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass  # Report unreaped kernel/IO-blocked work instead of hanging the supervisor.
            child_code = process.returncode
            while True:
                for pid in adopted_children():
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                reap_descendants(process)
                record["descendants_cleaned"] = not adopted_children()
                record["process_group_cleaned"] = process.returncode is not None and record["descendants_cleaned"]
                if record["process_group_cleaned"] and record["descendants_cleaned"]:
                    break
                if time.monotonic() >= cleanup_deadline:
                    break
                time.sleep(0.01)
            child_code = process.returncode
        else:
            record["process_group_cleaned"] = True
            record["descendants_cleaned"] = True
        if not record["process_group_cleaned"] or not record["descendants_cleaned"]:
            record["cleanup_error"] = "A test descendant could not be reaped after termination; execution is partial."
            if exit_code == 0:
                status, exit_code = "cleanup_failed", 125
        record.update(status=status, exit_code=exit_code, child_exit_code=child_code,
                      child_launched=process is not None,
                      partial_execution=status != "completed", completed_at=timestamp(),
                      elapsed_seconds=round(time.monotonic() - started, 3),
                      **retained_progress(args.report_directory))
        # Do not create the lifecycle directory before the child: its existing
        # safety assertion requires a new scratch directory at startup.
        persist_record(create=True)
        print(f"Lifecycle watchdog end: {status}; exit {exit_code}; elapsed {record['elapsed_seconds']:.3f}s; "
              f"last phase {record['last_phase'] or 'not started'}; last command {record['last_command'] or 'none'}", flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
