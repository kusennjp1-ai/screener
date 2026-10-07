"""One reviewed provider-free route, not an opt-in or a workflow-name allowlist.

Only the disabled P2 Static Site workflow_run no-op is presently proved. Its
exact workflow binds checkout to github.sha, excludes acquisition/fallback jobs,
and its exact disabled request makes the repair/combine branch unreachable.
Research UI Release still has a mutable-main ordinary path and is NOT exempt.
An activated main, including a request-only child of P2, needs new exact readback
and review. Neither a source request nor an arbitrary future head can enable it.
The separately read-back A2 cd75aa0465cab7c4350aac31fb55c771b1ea402e is also
blocked: its positive active-route proof has not been independently reviewed.
"""
import base64
import binascii
import hashlib
import json
import re

from app.services import financial_statement_batch as batch

REPOSITORY = "kusennjp1-ai/screener"
REPOSITORY_ID = 1203919607
WORKFLOW = ".github/workflows/static-site.yml"
WORKFLOW_ID = 294257497
CI_WORKFLOW_ID = 294252465
REVIEWED_HEAD = "ea71eeb865c1941476b81a6f069a83279276c479"
REVIEWED_TREE = "ae80ce90e80f0ed3a2c440dfe0f7c0d6524bb9e3"
REQUEST = ".github/retained-price-oct6-source.json"
REVIEWED_BLOBS = {
    WORKFLOW: "e56f50517a7c4a001f50f9d1d82591963e685cc9",
    ".github/workflows/research-ui-release.yml": "61b641e3fd2280091641a34baa8659f62083f665",
    ".github/scripts/retained-price-ci-admission.mjs": "b2c97b5daf63d2c58d701c13f8e6fefa6d4f4cf2",
    ".github/scripts/retained-price-source-admission.mjs": "43d63b99ee8f9a1957fc7379d7a1c24bb05f9d12",
    ".github/scripts/run-retained-price-source.py": "77ffa2776eb2fd67be186d0f305e0ca11256b131",
    REQUEST: "3b2bc955ce66ba5a97e7dd9b3a5587c605b4350a",
}
JOBS = frozenset({"select-markets", "ensure_daily_price_release", "build-market",
                  "combine-and-build", "promote-daily-source"})
STEPS = (
    (1, "Set up job"), (2, "Run actions/checkout@v4"),
    (3, "Run actions/setup-node@v4"),
    (4, "Admit only the finite exact-main price CI trigger"),
    (5, "Run python - <<'PY'"),
    (6, "Run ASIA='[\"HK\",\"IN\",\"JP\",\"KR\",\"TW\",\"CN\",\"SG\",\"MY\",\"AU\"]'"),
    (11, "Post Run actions/setup-node@v4"),
    (12, "Post Run actions/checkout@v4"), (13, "Complete job"),
)
RUN_KEYS = ("id", "run_number", "run_attempt", "workflow_id", "path", "head_sha",
            "head_branch", "event", "status", "conclusion", "run_started_at")
PREFIX = f"repos/{REPOSITORY}"


def require(ok, reason):
    if not ok:
        raise ValueError("Unproved offline price route: " + reason)


def candidate(run):
    """This only selects the strict verifier; it grants no exemption."""
    return run.get("path") == WORKFLOW and run.get("event") == "workflow_run"


def require_identity(run):
    require(candidate(run) and run["workflow_id"] == WORKFLOW_ID and
            run["run_attempt"] == 1 and run["head_branch"] == "main" and
            run["head_sha"] == REVIEWED_HEAD, "head/workflow/attempt has no exact reviewed identity")


def git_hash(kind, data):
    return hashlib.sha1(f"{kind} {len(data)}\0".encode() + data).hexdigest()


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value) is not None


def verified_tree(value):
    """Reconstruct every Git directory, rejecting a claimed-but-partial tree."""
    require(isinstance(value, dict) and value.get("sha") == REVIEWED_TREE and
            value.get("truncated") is False and isinstance(value.get("tree"), list) and
            0 < len(value["tree"]) <= 60000, "incomplete or wrong reviewed tree")
    entries, children = {}, {"": []}
    for item in value["tree"]:
        require(isinstance(item, dict), "invalid tree member")
        path = item.get("path")
        require(isinstance(path, str) and 0 < len(path.encode()) <= 4096 and
                not re.search(r"[\x00-\x1f\x7f\\]", path) and
                all(part not in {"", ".", ".."} for part in path.split("/")) and
                path not in entries and sha(item.get("sha")), "invalid or duplicate tree path")
        kind, mode = item.get("type"), item.get("mode")
        require((kind == "tree" and mode == "040000") or
                (kind == "blob" and mode in {"100644", "100755"}), "nonregular code inventory")
        entries[path] = item
        parent, _, name = path.rpartition("/")
        children.setdefault(parent, []).append((name, item))
        if kind == "tree":
            children.setdefault(path, [])
    for directory, members in children.items():
        require(not directory or (directory in entries and entries[directory]["type"] == "tree"),
                "missing enclosing code directory")
        ordered = sorted(members, key=lambda pair: (pair[0] + ("/" if pair[1]["type"] == "tree" else "")).encode())
        body = b"".join((item["mode"].lstrip("0") + " " + name).encode() + b"\0" +
                        bytes.fromhex(item["sha"]) for name, item in ordered)
        expected = REVIEWED_TREE if not directory else entries[directory]["sha"]
        require(git_hash("tree", body) == expected, "incomplete or changed code inventory")
    for path, blob in REVIEWED_BLOBS.items():
        item = entries.get(path, {})
        require(item.get("type") == "blob" and item.get("mode") == "100644" and
                item.get("sha") == blob, "reviewed code/request blob changed: " + path)


def disabled_request(value):
    require(isinstance(value, dict) and value.get("type") == "file" and value.get("path") == REQUEST and
            value.get("sha") == REVIEWED_BLOBS[REQUEST] and value.get("encoding") == "base64" and
            type(value.get("size")) is int and 0 < value["size"] <= 1024 * 1024 and
            isinstance(value.get("content"), str) and len(value["content"]) <= 2 * 1024 * 1024,
            "unbound or oversized disabled request")
    try:
        raw = base64.b64decode(value["content"].replace("\n", ""), validate=True)
        request = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeError) as error:
        raise ValueError("Unproved offline price route: invalid request bytes") from error
    require(len(raw) == value["size"] and git_hash("blob", raw) == REVIEWED_BLOBS[REQUEST],
            "disabled request byte identity changed")
    require(isinstance(request, dict) and request.get("schema_version") == "retained-price-oct6-source-v1" and
            request.get("enabled") is False and "activation" in request and request["activation"] is None,
            "activation has no reviewed exact-main binding")


def run_clocks(run, now):
    created, started, updated = (batch.clock(run.get(key)) for key in
                                 ("created_at", "run_started_at", "updated_at"))
    require(created <= started <= updated <= now, "future or inconsistent price run clocks")
    return created, started, updated


def verify_jobs(jobs, run, now):
    require(len(jobs) == len(JOBS) and {job["name"] for job in jobs} == JOBS,
            "unknown or incomplete price job inventory")
    for job in jobs:
        steps = job.get("steps")
        require(isinstance(steps, list), "missing price step inventory")
        if job["name"] != "select-markets":
            require(job["status"] == "completed" and job["conclusion"] == "skipped" and not steps,
                    "provider/combine/promotion job is not proved skipped")
            # GitHub's skipped placeholders need not have ordered clocks, but
            # future/malformed clocks never contribute to an exemption.
            for key in ("started_at", "completed_at"):
                require(batch.clock(job.get(key)) <= now, "future skipped-job clock")
            continue
        require(type(job.get("runner_id")) is int and job["runner_id"] > 0 and
                (job["status"], job["conclusion"]) in {("in_progress", None), ("completed", "success")},
                "unverified price routing job")
        started = batch.clock(job.get("started_at"))
        end = batch.clock(job.get("completed_at")) if job["status"] == "completed" else now
        require(batch.clock(run["run_started_at"]) <= started <= end <= now and
                (job["status"] == "completed" or job.get("completed_at") is None), "invalid price job clocks")
        require(len(steps) == len(STEPS) and all(isinstance(step, dict) for step in steps) and
                [(step.get("number"), step.get("name")) for step in steps] == list(STEPS),
                "unknown or incomplete routing step inventory")
        running = 0
        pending = False
        prior_end = started
        for step in steps:
            if step["number"] == 5:
                require(step.get("status") == "completed" and step.get("conclusion") == "skipped",
                        "ordinary source policy executed")
                for key in ("started_at", "completed_at"):
                    require(batch.clock(step.get(key)) <= now, "future skipped-step clock")
                continue
            state = step.get("status"), step.get("conclusion")
            require(state in {("completed", "success"), ("in_progress", None), ("queued", None)},
                    "uncertain routing step status")
            if state == ("queued", None):
                require(step.get("started_at") is None and step.get("completed_at") is None,
                        "queued routing step has execution clocks")
                pending = True
                continue
            require(not pending, "executed routing step follows pending work")
            start = batch.clock(step.get("started_at"))
            require(prior_end <= start <= end, "future or unordered routing step")
            if state == ("in_progress", None):
                require(step.get("completed_at") is None, "active routing step has completion clock")
                running += 1
                pending = True
            else:
                prior_end = batch.clock(step.get("completed_at"))
                require(start <= prior_end <= end, "future or inverted routing step")
        require(running == (1 if job["status"] == "in_progress" else 0) and
                (job["status"] != "completed" or not pending), "inconsistent routing job/step status")


def verify(api, listed, jobs, *, now, complete):
    require_identity(listed)
    run_clocks(listed, now)
    repo = api(PREFIX)
    require(repo.get("full_name") == REPOSITORY and repo.get("id") == REPOSITORY_ID and
            repo.get("default_branch") == "main", "repository identity changed")
    for identifier, path in ((WORKFLOW_ID, WORKFLOW), (CI_WORKFLOW_ID, ".github/workflows/ci.yml")):
        workflow = api(f"{PREFIX}/actions/workflows/{identifier}")
        require(workflow.get("id") == identifier and workflow.get("path") == path and
                workflow.get("state") == "active", "workflow identity changed")
    commit = api(f"{PREFIX}/git/commits/{REVIEWED_HEAD}")
    require(commit.get("sha") == REVIEWED_HEAD and commit.get("tree", {}).get("sha") == REVIEWED_TREE,
            "immutable reviewed commit/tree changed")
    verified_tree(api(f"{PREFIX}/git/trees/{REVIEWED_TREE}?recursive=1"))
    disabled_request(api(f"{PREFIX}/contents/{REQUEST}?ref={REVIEWED_HEAD}"))
    current = api(f"{PREFIX}/actions/runs/{listed['id']}")
    attempt = api(f"{PREFIX}/actions/runs/{listed['id']}/attempts/1")
    for value in (current, attempt):
        require(all(value.get(key) == listed.get(key) for key in RUN_KEYS) and
                all(value.get(key, {}).get("id") == REPOSITORY_ID and
                    value.get(key, {}).get("full_name") == REPOSITORY for key in ("repository", "head_repository")),
                "run or original attempt changed")
    created, started, updated = run_clocks(current, now)
    require(current.get("created_at") == listed["created_at"] and current.get("updated_at") == listed["updated_at"],
            "listed price run clocks changed")
    # Endpoint timestamps are distinct authenticated observations, not a
    # tolerance added to any acquisition, source or financial clock.
    attempt_created = batch.clock(attempt.get("created_at"))
    attempt_updated = batch.clock(attempt.get("updated_at"))
    require(created <= attempt_created <= updated and started <= attempt_updated <= now and
            attempt_created <= attempt_updated, "future or inconsistent attempt observation clocks")
    verify_jobs(jobs, current, now)
    require(complete(api, f"{PREFIX}/actions/runs/{listed['id']}/artifacts", "artifacts") == [],
            "disabled no-op has output artifacts")
    ref = api(f"{PREFIX}/git/ref/heads/main")
    require(ref.get("ref") == "refs/heads/main" and ref.get("object", {}).get("type") == "commit" and
            ref["object"].get("sha") == REVIEWED_HEAD, "main is not the exact disabled reviewed controller")
    return {"run_id": listed["id"], "run_attempt": 1, "head_sha": REVIEWED_HEAD,
            "tree": REVIEWED_TREE, "workflow_id": WORKFLOW_ID,
            "classification": "reviewed_disabled_price_workflow_run_noop",
            "provider_acquisition": False, "publication_authority": False,
            "source_clock_authority": False}
