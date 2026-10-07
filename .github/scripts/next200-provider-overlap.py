"""Bounded read-only overlap observations; this is not a cross-workflow lock.

A provider workflow can start after any observation. No production admission
may infer atomic exclusion from this guard; shared scheduling needs separate
review. Unknown active workflows and uncertain/incomplete API data fail closed.
"""
import importlib.util
from pathlib import Path
import re
import time
from datetime import timedelta
from app.services import financial_statement_batch as batch

_offline_spec = importlib.util.spec_from_file_location(
    "next200_offline_price", Path(__file__).with_name("next200-offline-price.py"))
offline_price = importlib.util.module_from_spec(_offline_spec)
_offline_spec.loader.exec_module(offline_price)

REPOSITORY = "kusennjp1-ai/screener"
REPOSITORY_ID = 1203919607
WORKFLOW = ".github/workflows/financial-statement-recovery.yml"
JOB = "statement-recovery"
STEPS = frozenset({"Require exact one-shot next-200 admission", "Collect one bounded next-200 visit"})
ACTIVE_STATUSES = ("in_progress", "queued", "requested", "waiting", "pending")
TERMINAL_CONCLUSIONS = frozenset({"success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale", "startup_failure"})
MAX_ITEMS = 300
MAX_OBSERVATION_SECONDS = 45
POLL_SECONDS = 15
KNOWN_EVENTS = {
    WORKFLOW: frozenset({"push"}),
    ".github/workflows/static-site.yml": frozenset({"schedule", "workflow_dispatch"}),
    ".github/workflows/four-symbol-price-push.yml": frozenset({"push"}),
    ".github/workflows/four-symbol-price-capture.yml": frozenset({"workflow_dispatch"}),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive(value):
    return type(value) is int and value > 0


def job_clock(value):
    require(isinstance(value, str) and bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value)),
            "Job-start clock must match the reviewed whole-second producer")
    return batch.clock(value)


def complete(api, endpoint, key, *, maximum=MAX_ITEMS):
    """Honor the exact count across every page; never accept partial pages."""
    result, expected, page = [], None, 1
    while True:
        value = api(f"{endpoint}{'&' if '?' in endpoint else '?'}per_page=100&page={page}")
        require(isinstance(value, dict) and type(value.get("total_count")) is int and
                0 <= value["total_count"] <= maximum and isinstance(value.get(key), list),
                "Incomplete or oversized provider inventory")
        count = value["total_count"]
        require(expected is None or count == expected, "Provider inventory changed during pagination")
        expected = count
        entries = value[key]
        require(len(entries) == min(100, expected - len(result)) and
                all(isinstance(item, dict) and positive(item.get("id")) for item in entries),
                "Truncated or malformed provider inventory")
        result.extend(entries)
        require(len({item["id"] for item in result}) == len(result), "Duplicate provider inventory entries")
        if len(result) == expected:
            return result
        page += 1


def run_identity(run):
    require(all(positive(run.get(key)) for key in ("id", "workflow_id", "run_number", "run_attempt")) and
            run.get("repository", {}).get("full_name") == run.get("head_repository", {}).get("full_name") == REPOSITORY and
            run.get("repository", {}).get("id") == run.get("head_repository", {}).get("id") == REPOSITORY_ID and
            isinstance(run.get("head_sha"), str) and re.fullmatch(r"[a-f0-9]{40}", run["head_sha"]) and
            isinstance(run.get("head_branch"), str) and run["head_branch"], "Unverified provider run identity")
    require((run.get("path") in KNOWN_EVENTS and run.get("event") in KNOWN_EVENTS[run["path"]]) or
            offline_price.candidate(run),
            "Unknown active workflow/event may acquire provider data")
    require(run.get("status") in ACTIVE_STATUSES and run.get("conclusion") is None,
            "Uncertain active provider run status")
    if offline_price.candidate(run):
        offline_price.require_identity(run)


def jobs_for_run(api, run):
    jobs = complete(api, f"repos/{REPOSITORY}/actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs")
    for job in jobs:
        require(job.get("run_id") == run["id"] and type(job.get("run_attempt")) is int and
                job["run_attempt"] == run["run_attempt"] and job.get("head_sha") == run["head_sha"] and
                isinstance(job.get("name"), str) and job["name"], "Unverified provider job identity")
        require((job.get("status") in ACTIVE_STATUSES and job.get("conclusion") is None) or
                (job.get("status") == "completed" and job.get("conclusion") in TERMINAL_CONCLUSIONS),
                "Uncertain provider job status")
    return jobs


def observe(api, current, *, job_started_at, now, monotonic=time.monotonic):
    """Reject concurrent acquisition, except one immutable offline price route.

    Whole-run exclusion is deliberate: a queued job, future matrix child or
    Static Site combine step can still acquire even when one job has completed.
    We do not cancel, postpone or modify any other run.
    """
    started = monotonic()
    def bounded(endpoint):
        require(monotonic() - started < MAX_OBSERVATION_SECONDS, "Provider overlap observation exhausted its wall-time bound")
        result = api(endpoint)
        require(monotonic() - started < MAX_OBSERVATION_SECONDS, "Provider overlap observation exhausted its wall-time bound")
        return result
    run_identity(current)
    require(current["path"] == WORKFLOW and current["event"] == "push" and
            current["status"] == "in_progress" and current["run_attempt"] == 1,
            "Wrong current acquisition workflow or attempt")
    workflow = bounded(f"repos/{REPOSITORY}/actions/workflows/{current['workflow_id']}")
    require(workflow.get("id") == current["workflow_id"] and workflow.get("path") == WORKFLOW and
            workflow.get("state") == "active", "Current acquisition workflow identity changed")
    jobs = jobs_for_run(bounded, current)
    require(len(jobs) == 1 and jobs[0]["name"] == JOB and jobs[0]["status"] == "in_progress" and
            positive(jobs[0].get("runner_id")), "Missing or replaced current acquisition job")
    steps = jobs[0].get("steps")
    require(isinstance(steps, list) and steps and all(isinstance(step, dict) and
            positive(step.get("number")) and isinstance(step.get("name"), str) and
            ((step.get("status") in ACTIVE_STATUSES and step.get("conclusion") is None) or
             (step.get("status") == "completed" and step.get("conclusion") in TERMINAL_CONCLUSIONS)) for step in steps) and
            len({step["number"] for step in steps}) == len(steps) and
            steps == sorted(steps, key=lambda step: step["number"]), "Uncertain acquisition step inventory")
    active_steps = [step for step in steps if step["status"] == "in_progress"]
    require(len(active_steps) == 1 and active_steps[0]["name"] in STEPS, "Wrong current acquisition step")
    clocks = [step for step in steps if step["name"] == "Start the bounded job clock"]
    require(len(clocks) == 1 and clocks[0]["status"] == "completed" and
            clocks[0]["conclusion"] == "success" and active_steps[0]["number"] > clocks[0]["number"],
            "Missing or unverified original job-clock step")
    budget_clock = clocks[0]
    preceding = [step for step in steps if step["number"] < budget_clock["number"]]
    # Actual retained GitHub job evidence contains its setup pseudo-step before
    # the first YAML step. No earlier user-defined work may go uncharged.
    require(len(preceding) == 1 and preceding[0]["name"] == "Set up job" and
            preceding[0]["number"] == 1 and budget_clock["number"] == preceding[0]["number"] + 1 and
            preceding[0]["status"] == "completed" and preceding[0]["conclusion"] == "success",
            "Unreviewed work or missing platform setup precedes the original job clock")
    setup = preceding[0]
    require(batch.clock(jobs[0].get("started_at")) <= batch.clock(setup.get("started_at")) <=
            batch.clock(setup.get("completed_at")) <= batch.clock(budget_clock.get("started_at")) <= now,
            "Unverified platform setup/clock-step timing")
    completed_text = budget_clock.get("completed_at")
    completed = batch.clock(completed_text)
    # The existing workflow emits `date -u +%Y-%m-%dT%H:%M:%SZ`.
    # API step clocks may be truncated to whole seconds. The comparison-only
    # upper interval is then exclusive at the next second; no elapsed budget
    # or persisted timestamp receives this tolerance.
    truncated = isinstance(completed_text, str) and bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", completed_text))
    start = job_clock(job_started_at)
    within_completion = start < completed + timedelta(seconds=1) if truncated else start <= completed
    # The whole-second producer also floors its emission time: a fractional
    # API step start may follow the token within that same second. Budgeting
    # still begins at the unchanged (earlier) token, never at token + 1 second.
    require(batch.clock(current.get("run_started_at")) <= batch.clock(jobs[0].get("started_at")) <=
            batch.clock(budget_clock.get("started_at")) < start + timedelta(seconds=1) and
            start <= now and completed <= now and within_completion,
            "Job-start clock is future or outside the authenticated original step")
    seen = {}
    for status in ACTIVE_STATUSES:
        runs = complete(bounded, f"repos/{REPOSITORY}/actions/runs?status={status}", "workflow_runs")
        for run in runs:
            run_identity(run)
            require(run["status"] == status and run["id"] not in seen,
                    "Provider run moved or duplicated during observation")
            seen[run["id"]] = run
    require(current["id"] in seen and all(seen[current["id"]].get(key) == current.get(key) for key in
            ("workflow_id", "run_number", "run_attempt", "head_sha", "head_branch", "path", "event", "status", "conclusion")),
            "Current run missing or changed in complete provider inventory")
    offline_observations = []
    for run in seen.values():
        if run["id"] != current["id"]:
            other_jobs = jobs_for_run(bounded, run)
            if offline_price.candidate(run):
                offline_observations.append(offline_price.verify(
                    bounded, run, other_jobs, now=now, complete=complete))
                continue
            raise ValueError(f"Concurrent provider/acquisition workflow {run['path']} run {run['id']} is {run['status']}")
    return {"schema_version": "next200-provider-overlap-observation-v1", "active_run_count": len(seen),
            "current_job_id": jobs[0]["id"], "current_step_number": active_steps[0]["number"],
            "current_step_name": active_steps[0]["name"],
            "job_started_at": job_started_at,
            "platform_job_started_at": jobs[0]["started_at"], "run_started_at": current["run_started_at"],
            "job_clock_step_started_at": budget_clock["started_at"],
            "job_clock_step_completed_at": budget_clock["completed_at"],
            "offline_price_observations": offline_observations,
            "isolation": "read_only_observation_not_shared_lock", "minimum_poll_interval_seconds": POLL_SECONDS}
