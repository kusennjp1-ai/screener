"""Finite local API fixtures: no provider, upload, token or external transport."""
import base64
from copy import deepcopy
import importlib.util
import json
from pathlib import Path

import pytest

from app.services import financial_statement_batch as batch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("offline_price_overlap_test", ROOT / ".github/scripts/next200-provider-overlap.py")
overlap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlap)
price = overlap.offline_price
NOW = batch.clock("2026-10-07T16:00:00Z")
START = "2026-10-07T15:59:00Z"


def tree_fixture(files):
    """Build a small complete Git tree, independently of the reader."""
    import hashlib
    def tree_id(data):
        return hashlib.sha1(b"tree " + str(len(data)).encode() + b"\0" + data).hexdigest()
    entries = {path: {"path": path, "type": "blob", "mode": "100644", "sha": sha}
               for path, sha in files.items()}
    for path in list(entries):
        parent = path.rpartition("/")[0]
        while parent:
            entries.setdefault(parent, {"path": parent, "type": "tree", "mode": "040000"})
            parent = parent.rpartition("/")[0]
    for directory in sorted(["", *[p for p, v in entries.items() if v["type"] == "tree"]],
                            key=lambda p: p.count("/") + bool(p), reverse=True):
        children = [v for p, v in entries.items() if p.rpartition("/")[0] == directory]
        children.sort(key=lambda v: (v["path"].rsplit("/", 1)[-1] + ("/" if v["type"] == "tree" else "")).encode())
        payload = b"".join((v["mode"].lstrip("0") + " " + v["path"].rsplit("/", 1)[-1]).encode() +
                           b"\0" + bytes.fromhex(v["sha"]) for v in children)
        digest = tree_id(payload)
        if directory:
            entries[directory]["sha"] = digest
    return {"sha": digest, "truncated": False, "tree": list(entries.values())}


@pytest.fixture
def fixture(monkeypatch):
    repo = {"id": overlap.REPOSITORY_ID, "full_name": overlap.REPOSITORY}
    source = {"id": 101, "run_number": 9, "run_attempt": 1, "workflow_id": 12345,
              "path": overlap.WORKFLOW, "event": "push", "head_sha": "c" * 40,
              "head_branch": "improve/mandatory-financial-source-recovery", "status": "in_progress",
              "conclusion": None, "repository": repo, "head_repository": repo, "run_started_at": START}
    source_job = {"id": 201, "run_id": 101, "run_attempt": 1, "head_sha": source["head_sha"],
                  "name": overlap.JOB, "status": "in_progress", "conclusion": None,
                  "runner_id": 301, "started_at": START,
                  "steps": [{"number": 1, "name": "Set up job", "status": "completed", "conclusion": "success",
                             "started_at": START, "completed_at": START},
                            {"number": 2, "name": "Start the bounded job clock", "status": "completed", "conclusion": "success",
                             "started_at": START, "completed_at": START},
                            {"number": 3, "name": "Collect one bounded next-200 visit", "status": "in_progress", "conclusion": None}]}
    other = {**deepcopy(source), "id": 102, "workflow_id": price.WORKFLOW_ID, "path": price.WORKFLOW,
             "event": "workflow_run", "head_sha": price.REVIEWED_HEAD, "head_branch": "main",
             "created_at": START, "updated_at": START}
    jobs = []
    for index, name in enumerate(sorted(price.JOBS)):
        jobs.append({"id": 210 + index, "run_id": other["id"], "run_attempt": 1, "head_sha": other["head_sha"],
                     "name": name, "status": "completed", "conclusion": "skipped", "steps": [],
                     "started_at": START, "completed_at": START})
    route = next(job for job in jobs if job["name"] == "select-markets")
    route.update(status="in_progress", conclusion=None, runner_id=302, completed_at=None)
    for number, name in price.STEPS:
        state = "completed" if number <= 3 or number == 5 else "in_progress" if number == 4 else "queued"
        route["steps"].append({"number": number, "name": name, "status": state,
                               "conclusion": "skipped" if number == 5 else "success" if state == "completed" else None,
                               "started_at": None if state == "queued" else START,
                               "completed_at": START if state == "completed" else None})
    # Tests substitute a tiny immutable reviewed tree/request; the deployed
    # constants remain the actual P2 identity and never accept fixture opt-ins.
    raw = json.dumps({"schema_version": "retained-price-oct6-source-v1", "enabled": False, "activation": None}).encode()
    blobs = {**price.REVIEWED_BLOBS, price.REQUEST: price.git_hash("blob", raw)}
    tree = tree_fixture(blobs)
    monkeypatch.setattr(price, "REVIEWED_BLOBS", blobs)
    monkeypatch.setattr(price, "REVIEWED_TREE", tree["sha"])
    prefix = price.PREFIX
    responses = {
        prefix: {**repo, "default_branch": "main"},
        f"{prefix}/actions/workflows/12345": {"id": 12345, "path": overlap.WORKFLOW, "state": "active"},
        f"{prefix}/actions/workflows/{price.WORKFLOW_ID}": {"id": price.WORKFLOW_ID, "path": price.WORKFLOW, "state": "active"},
        f"{prefix}/actions/workflows/{price.CI_WORKFLOW_ID}": {"id": price.CI_WORKFLOW_ID, "path": ".github/workflows/ci.yml", "state": "active"},
        f"{prefix}/git/commits/{price.REVIEWED_HEAD}": {"sha": price.REVIEWED_HEAD, "tree": {"sha": tree["sha"]}},
        f"{prefix}/git/trees/{tree['sha']}?recursive=1": tree,
        f"{prefix}/contents/{price.REQUEST}?ref={price.REVIEWED_HEAD}": {"type": "file", "path": price.REQUEST,
            "sha": blobs[price.REQUEST], "encoding": "base64", "size": len(raw), "content": base64.b64encode(raw).decode()},
        f"{prefix}/actions/runs/101/attempts/1/jobs?per_page=100&page=1": {"total_count": 1, "jobs": [source_job]},
        f"{prefix}/actions/runs/102/attempts/1/jobs?per_page=100&page=1": {"total_count": len(jobs), "jobs": jobs},
        f"{prefix}/actions/runs/102": deepcopy(other),
        f"{prefix}/actions/runs/102/attempts/1": deepcopy(other),
        f"{prefix}/actions/runs/102/artifacts?per_page=100&page=1": {"total_count": 0, "artifacts": []},
        f"{prefix}/git/ref/heads/main": {"ref": "refs/heads/main", "object": {"type": "commit", "sha": price.REVIEWED_HEAD}},
    }
    for status in overlap.ACTIVE_STATUSES:
        active = [source, other] if status == "in_progress" else []
        responses[f"{prefix}/actions/runs?status={status}&per_page=100&page=1"] = {"total_count": len(active), "workflow_runs": active}
    calls = []
    def api(endpoint):
        calls.append(endpoint)
        assert endpoint in responses, "Unexpected external read: " + endpoint
        return deepcopy(responses[endpoint])
    return source, other, jobs, responses, calls, api


def observe(fixture, **kwargs):
    source, _, _, _, _, api = fixture
    return overlap.observe(api, source, job_started_at=START, now=NOW, **kwargs)


def test_only_actual_reviewed_disabled_parent_is_code_owned():
    assert price.REVIEWED_HEAD == "ea71eeb865c1941476b81a6f069a83279276c479"
    assert price.REVIEWED_TREE == "ae80ce90e80f0ed3a2c440dfe0f7c0d6524bb9e3"
    assert price.REVIEWED_BLOBS[price.REQUEST] == "3b2bc955ce66ba5a97e7dd9b3a5587c605b4350a"
    assert price.REVIEWED_BLOBS[price.WORKFLOW] == "e56f50517a7c4a001f50f9d1d82591963e685cc9"


def test_exact_disabled_noop_passes_without_changing_source_clocks(fixture):
    proof = observe(fixture)
    assert proof["active_run_count"] == 2
    assert proof["offline_price_observations"] == [{"run_id": 102, "run_attempt": 1, "head_sha": price.REVIEWED_HEAD,
        "tree": price.REVIEWED_TREE, "workflow_id": price.WORKFLOW_ID,
        "classification": "reviewed_disabled_price_workflow_run_noop", "provider_acquisition": False,
        "publication_authority": False, "source_clock_authority": False}]
    for field in ("job_started_at", "platform_job_started_at", "run_started_at", "job_clock_step_started_at", "job_clock_step_completed_at"):
        assert proof[field] == START
    assert proof["minimum_poll_interval_seconds"] == 15
    assert proof["isolation"] == "read_only_observation_not_shared_lock"
    assert overlap.MAX_OBSERVATION_SECONDS == 45
    assert fixture[4][-1] == price.PREFIX + "/git/ref/heads/main"


@pytest.mark.parametrize("key,value", [
    ("workflow_id", 364666954), ("workflow_id", 1), ("path", ".github/workflows/research-ui-release.yml"),
    ("path", ".github/workflows/unknown.yml"), ("event", "offline_repair"), ("event", "pull_request"),
    ("head_sha", "d" * 40), ("head_branch", "prep/price-source-pr88"), ("run_attempt", 2),
    ("repository", {"id": 1, "full_name": price.REPOSITORY}),
    ("head_repository", {"id": price.REPOSITORY_ID, "full_name": "elsewhere/screener"}),
    ("status", "unknown"), ("conclusion", "success"),
])
def test_wrong_identity_and_arbitrary_source_event_labels_reject(fixture, key, value):
    fixture[1][key] = value
    with pytest.raises(ValueError):
        observe(fixture)


@pytest.mark.parametrize("event", ["schedule", "workflow_dispatch"])
@pytest.mark.parametrize("status", overlap.ACTIVE_STATUSES)
def test_all_ordinary_provider_events_remain_blocked(fixture, event, status):
    other, responses = fixture[1], fixture[3]
    other.update(event=event, status=status)
    for current_status in overlap.ACTIVE_STATUSES:
        entries = ([fixture[0]] if current_status == "in_progress" else []) + ([other] if current_status == status else [])
        responses[f"{price.PREFIX}/actions/runs?status={current_status}&per_page=100&page=1"] = {"total_count": len(entries), "workflow_runs": entries}
    with pytest.raises(ValueError, match="Concurrent provider/acquisition"):
        observe(fixture)


@pytest.mark.parametrize("mutation", ["repo_id", "default_branch", "workflow_path", "ci_id", "commit", "tree_id",
    "truncated_tree", "missing_code", "missing_directory", "duplicate_code", "changed_blob", "changed_mode",
    "request_sha", "request_bytes", "request_size", "request_encoding", "main", "attempt_id", "current_head",
    "run_clock", "attempt_clock", "future_attempt", "future_step", "inverted_step", "future_job", "future_skip",
    "missing_jobs", "unknown_job", "wrong_job_head", "wrong_job_attempt", "provider_job", "missing_steps",
    "unknown_step", "executed_source_policy", "queued_clock", "artifacts", "partial_artifacts"])
def test_incomplete_changed_or_uncertain_proof_blocks(fixture, mutation):
    _, _, jobs, responses, _, _ = fixture
    prefix = price.PREFIX
    tree = responses[f"{prefix}/git/trees/{price.REVIEWED_TREE}?recursive=1"]
    request = responses[f"{prefix}/contents/{price.REQUEST}?ref={price.REVIEWED_HEAD}"]
    current = responses[f"{prefix}/actions/runs/102"]
    attempt = responses[f"{prefix}/actions/runs/102/attempts/1"]
    route = next(job for job in jobs if job["name"] == "select-markets")
    skip = next(job for job in jobs if job["name"] == "combine-and-build")
    future = "2026-10-07T16:00:01Z"
    if mutation == "repo_id": responses[prefix]["id"] = 1
    elif mutation == "default_branch": responses[prefix]["default_branch"] = "other"
    elif mutation == "workflow_path": responses[f"{prefix}/actions/workflows/{price.WORKFLOW_ID}"]["path"] = ".github/workflows/evil.yml"
    elif mutation == "ci_id": responses[f"{prefix}/actions/workflows/{price.CI_WORKFLOW_ID}"]["id"] = 1
    elif mutation == "commit": responses[f"{prefix}/git/commits/{price.REVIEWED_HEAD}"]["sha"] = "e" * 40
    elif mutation == "tree_id": tree["sha"] = "e" * 40
    elif mutation == "truncated_tree": tree["truncated"] = True
    elif mutation == "missing_code": tree["tree"].pop(0)
    elif mutation == "missing_directory": tree["tree"] = [v for v in tree["tree"] if v["path"] != ".github"]
    elif mutation == "duplicate_code": tree["tree"].append(deepcopy(tree["tree"][0]))
    elif mutation == "changed_blob": tree["tree"][0]["sha"] = "e" * 40
    elif mutation == "changed_mode": tree["tree"][0]["mode"] = "100755"
    elif mutation == "request_sha": request["sha"] = "e" * 40
    elif mutation == "request_bytes": request["content"] = base64.b64encode(b'{"enabled":true,"provider_free":true}').decode()
    elif mutation == "request_size": request["size"] += 1
    elif mutation == "request_encoding": request["encoding"] = "utf8"
    elif mutation == "main": responses[f"{prefix}/git/ref/heads/main"]["object"]["sha"] = "e" * 40
    elif mutation == "attempt_id": attempt["id"] = 103
    elif mutation == "current_head": current["head_sha"] = "e" * 40
    elif mutation == "run_clock": current["updated_at"] = future
    elif mutation == "attempt_clock": attempt["created_at"] = "2026-10-07T15:58:59Z"
    elif mutation == "future_attempt": attempt["updated_at"] = future
    elif mutation == "future_step": route["steps"][3]["started_at"] = future
    elif mutation == "inverted_step": route["steps"][0]["completed_at"] = "2026-10-07T15:58:59Z"
    elif mutation == "future_job": route["started_at"] = future
    elif mutation == "future_skip": skip["completed_at"] = future
    elif mutation == "missing_jobs": jobs.pop(0)
    elif mutation == "unknown_job": skip["name"] = "offline-source-labelled-provider"
    elif mutation == "wrong_job_head": skip["head_sha"] = "e" * 40
    elif mutation == "wrong_job_attempt": skip["run_attempt"] = 2
    elif mutation == "provider_job": skip.update(status="in_progress", conclusion=None)
    elif mutation == "missing_steps": route["steps"].pop()
    elif mutation == "unknown_step": route["steps"][3]["name"] = "provider_free=true"
    elif mutation == "executed_source_policy": route["steps"][4]["conclusion"] = "success"
    elif mutation == "queued_clock": route["steps"][-1]["started_at"] = START
    elif mutation == "artifacts": responses[f"{prefix}/actions/runs/102/artifacts?per_page=100&page=1"] = {"total_count": 1, "artifacts": [{"id": 1}]}
    elif mutation == "partial_artifacts": responses[f"{prefix}/actions/runs/102/artifacts?per_page=100&page=1"]["total_count"] = 1
    with pytest.raises(ValueError):
        observe(fixture)


def test_exact_disabled_request_stays_required_even_with_synthetic_matching_blob(monkeypatch):
    raw = b'{"schema_version":"retained-price-oct6-source-v1","enabled":true,"activation":null,"provider_free":true}'
    blob = price.git_hash("blob", raw)
    monkeypatch.setitem(price.REVIEWED_BLOBS, price.REQUEST, blob)
    with pytest.raises(ValueError, match="no reviewed exact-main"):
        price.disabled_request({"type": "file", "path": price.REQUEST, "sha": blob, "encoding": "base64",
                                "size": len(raw), "content": base64.b64encode(raw).decode()})


@pytest.mark.parametrize("target", ["run_head", "live_main", "request_blob"])
def test_read_back_actual_a2_is_not_positive_offline_admission(fixture, target):
    # Actual readback alone is no proof of active-route coordination. This exact
    # activated main remains blocked until independent route/current-run review.
    head = "cd75aa0465cab7c4350aac31fb55c771b1ea402e"
    responses = fixture[3]
    if target == "run_head":
        fixture[1]["head_sha"] = head
    elif target == "live_main":
        responses[f"{price.PREFIX}/git/ref/heads/main"]["object"]["sha"] = head
    else:
        responses[f"{price.PREFIX}/contents/{price.REQUEST}?ref={price.REVIEWED_HEAD}"]["sha"] = "1816d1572f3b253817e5e350eeb28cdb5bde08db"
    with pytest.raises(ValueError, match="Unproved offline price route"):
        observe(fixture)


def test_offline_exemption_does_not_hide_another_unknown_active_run(fixture):
    value = fixture[3][f"{price.PREFIX}/actions/runs?status=in_progress&per_page=100&page=1"]
    value["workflow_runs"].append({**deepcopy(fixture[1]), "id": 103, "path": ".github/workflows/unknown.yml"})
    value["total_count"] += 1
    with pytest.raises(ValueError, match="Unknown active workflow"):
        observe(fixture)


def test_full_price_proof_shares_45_second_observation_bound(fixture):
    source, _, _, _, _, api = fixture
    elapsed = [0]
    def slow(endpoint):
        if "/git/trees/" in endpoint:
            elapsed[0] = 45
        return api(endpoint)
    with pytest.raises(ValueError, match="wall-time bound"):
        overlap.observe(slow, source, job_started_at=START, now=NOW, monotonic=lambda: elapsed[0])


@pytest.mark.parametrize("mutation", ["future_job_clock", "different_clock_step", "source_job_id", "extra_source_job"])
def test_source_job_clock_checks_remain_mandatory_with_offline_price(fixture, mutation):
    inventory = fixture[3][f"{price.PREFIX}/actions/runs/101/attempts/1/jobs?per_page=100&page=1"]
    job = inventory["jobs"][0]
    if mutation == "future_job_clock": job["steps"][1]["completed_at"] = "2026-10-07T16:00:01Z"
    elif mutation == "different_clock_step": job["steps"][1]["name"] = "Reset source clock"
    elif mutation == "source_job_id": job["run_id"] = 102
    else:
        inventory["total_count"] += 1
        inventory["jobs"].append({**deepcopy(job), "id": 999})
    with pytest.raises(ValueError):
        observe(fixture)
