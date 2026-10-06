"""Offline C-source / exact R-intent / I-only push admission regressions.

All commits, run histories, jobs and immutable artifact downloads are synthetic.
No provider, GitHub, Redis, git subprocess or remote write is used by these tests.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import zipfile

import pytest

from app.services.bounded_price_recovery import encoded, sha
from app.services.price_pilot_admission import PILOT, REPOSITORY, REPOSITORY_ID
from app.services.price_pilot_push import (
    BRANCH, CAPTURE_JOB, CAPTURE_STEP, INTENT_PATH, POLICY_PATH, REGISTER_JOB,
    TEMPLATE_PATH, WORKFLOW, activation_message, checked_run, consume_push_attempt,
    prepare_activation, push_context, read_registration_zip, registration_receipt,
    validate_activation, validate_intent, validated_capture_context,
    verify_registered_attempt,
)


ROOT = Path(__file__).resolve().parents[3]
SOURCE = "a" * 40
ACTIVATION = "b" * 40
OTHER = "c" * 40
TREE = "d" * 40
REGISTER_RUN = 100
CAPTURE_RUN = 101
WORKFLOW_ID = 70
ARTIFACT_ID = 200
NOW = datetime(2026, 10, 6, 19, tzinfo=timezone.utc)
BASE = f"repos/{REPOSITORY}/"


def change(value, path, replacement):
    """Change one nested fixture field without normalizing the malformed value."""
    for key in path[:-1]:
        value = value[key]
    value[path[-1]] = replacement


def archive_bytes(proof, member="source-registration.json"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(zipfile.ZipInfo(member), encoded(proof))
    return output.getvalue()


class FakeGit:
    def __init__(self, template):
        workflow = b"name: synthetic reviewed push source\n"
        self.files = {
            (SOURCE, TEMPLATE_PATH): encoded(template),
            (SOURCE, POLICY_PATH): encoded({
                "schema_version": "four-symbol-price-push-policy-v1",
                "branch": BRANCH, "enabled": True,
            }),
            (SOURCE, WORKFLOW): workflow,
            (ACTIVATION, WORKFLOW): workflow,
        }
        self.parent_list = [SOURCE]
        self.changed_paths = ["A\t" + INTENT_PATH]
        self.commit_message = ""
        self.checkout = SOURCE
        self.commands = []

    def show(self, commit, path):
        return self.files[commit, path]

    def exists(self, commit, path):
        return (commit, path) in self.files

    def parents(self, commit):
        assert commit == ACTIVATION
        return list(self.parent_list)

    def changes(self, before, after):
        assert (before, after) == (SOURCE, ACTIVATION)
        return list(self.changed_paths)

    def message(self, commit):
        assert commit == ACTIVATION
        return self.commit_message

    def tree(self, commit):
        assert commit == SOURCE
        return TREE

    def git(self, *args):
        self.commands.append(args)
        assert args == ("rev-parse", "HEAD"), "Only read-only checkout inspection is allowed"
        return (self.checkout + "\n").encode()


def run_record(run_id, number, head, terminal=False):
    return {
        "id": run_id, "run_number": number, "run_attempt": 1,
        "workflow_id": WORKFLOW_ID, "head_sha": head, "head_branch": BRANCH,
        "path": WORKFLOW, "event": "push",
        "status": "completed" if terminal else "in_progress",
        "conclusion": "success" if terminal else None,
        "created_at": (NOW - timedelta(minutes=14)).isoformat(),
        "run_started_at": (NOW - timedelta(minutes=13)).isoformat(),
        "updated_at": (NOW - timedelta(minutes=7)).isoformat(),
        "repository": {"id": REPOSITORY_ID, "full_name": REPOSITORY},
        "head_repository": {"id": REPOSITORY_ID, "full_name": REPOSITORY},
    }


class Fixture:
    def __init__(self):
        self.template = json.loads((ROOT / TEMPLATE_PATH).read_bytes())
        self.git = FakeGit(self.template)
        self.env = {
            "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "push",
            "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_REF": "refs/heads/" + BRANCH,
            "GITHUB_SHA": ACTIVATION, "GITHUB_WORKFLOW_SHA": ACTIVATION,
            "GITHUB_WORKFLOW_REF": f"{REPOSITORY}/{WORKFLOW}@refs/heads/{BRANCH}",
            "GITHUB_RUN_ID": str(CAPTURE_RUN), "GITHUB_RUN_NUMBER": "2",
            "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": CAPTURE_JOB,
        }
        self.event = {
            "ref": "refs/heads/" + BRANCH, "repository": {"id": REPOSITORY_ID},
            "before": SOURCE, "after": ACTIVATION, "created": False,
            "deleted": False, "forced": False,
        }
        self.context = push_context(self.env, self.event)
        self.source_context = {
            **self.context, "activation_sha": SOURCE, "run_id": REGISTER_RUN,
            "run_number": 1,
        }
        self.approval = deepcopy(self.template)
        self.approval.update(controller_sha=SOURCE, capture_approved=True)
        self.approval["provider_budget"] = {
            "scope": "isolated_ci_job",
            "review_status": "approved_for_ten_request_pilot",
            "review_note": "Synthetic exact isolated ten-request review.",
        }
        self.approval["github_admission"].update(
            review_status="approved_finite_capture_run", workflow_id=WORKFLOW_ID,
        )
        self.approval["source_registration"] = {
            "run_id": REGISTER_RUN, "workflow_id": WORKFLOW_ID,
            "artifact_id": ARTIFACT_ID, "artifact_sha256": "0" * 64,
        }
        self.proof = {
            "schema_version": "four-symbol-source-registration-v1",
            "context": deepcopy(self.source_context), "workflow_id": WORKFLOW_ID,
            "source_sha": SOURCE, "source_tree": TREE,
            "template_sha256": sha(self.git.show(SOURCE, TEMPLATE_PATH)),
            "policy_sha256": sha(self.git.show(SOURCE, POLICY_PATH)),
            "capture_policy_enabled": True,
            "created_at": (NOW - timedelta(minutes=10)).isoformat(),
            "intent_present": False, "capture_approved": False, "provider_requests": 0,
        }
        self.registration_run = run_record(REGISTER_RUN, 1, SOURCE, terminal=True)
        self.capture_run = run_record(CAPTURE_RUN, 2, ACTIVATION)
        self.capture_job = {
            "id": 80, "name": CAPTURE_JOB, "run_id": CAPTURE_RUN,
            "head_sha": ACTIVATION, "run_attempt": 1, "status": "in_progress",
            "conclusion": None, "runner_id": 81,
            "steps": [{"name": CAPTURE_STEP, "number": 5,
                       "status": "in_progress", "conclusion": None}],
        }
        self.registration_jobs = [
            {"id": 78, "name": REGISTER_JOB, "run_id": REGISTER_RUN,
             "head_sha": SOURCE, "run_attempt": 1, "status": "completed",
             "conclusion": "success",
             "started_at": (NOW - timedelta(minutes=12)).isoformat(),
             "completed_at": (NOW - timedelta(minutes=8)).isoformat()},
            {"id": 79, "name": CAPTURE_JOB, "run_id": REGISTER_RUN,
             "head_sha": SOURCE, "run_attempt": 1, "status": "completed",
             "conclusion": "skipped"},
        ]
        self.artifact = {
            "id": ARTIFACT_ID, "name": f"price-pilot-source-{REGISTER_RUN}-1",
            "expired": False, "created_at": (NOW - timedelta(minutes=9)).isoformat(),
            "workflow_run": {"id": REGISTER_RUN, "head_sha": SOURCE},
        }
        self.responses = {
            f"actions/runs/{CAPTURE_RUN}": deepcopy(self.capture_run),
            f"actions/runs/{CAPTURE_RUN}/attempts/1": deepcopy(self.capture_run),
            f"actions/runs/{REGISTER_RUN}/attempts/1": deepcopy(self.registration_run),
            f"actions/workflows/{WORKFLOW_ID}": {
                "id": WORKFLOW_ID, "path": WORKFLOW, "state": "active",
            },
            f"actions/workflows/{WORKFLOW_ID}/runs?per_page=100": {
                "total_count": 2,
                "workflow_runs": [deepcopy(self.registration_run), deepcopy(self.capture_run)],
            },
            f"actions/runs/{REGISTER_RUN}/attempts/1/jobs?per_page=100": {
                "total_count": 2, "jobs": self.registration_jobs,
            },
            f"actions/runs/{REGISTER_RUN}/artifacts?per_page=100": {
                "total_count": 1, "artifacts": [self.artifact],
            },
            f"actions/runs/{CAPTURE_RUN}/artifacts?per_page=100": {
                "total_count": 0, "artifacts": [],
            },
            f"actions/runs/{CAPTURE_RUN}/attempts/1/jobs?per_page=100": {
                "total_count": 1, "jobs": [self.capture_job],
            },
            "git/ref/heads/" + BRANCH: {
                "ref": "refs/heads/" + BRANCH,
                "object": {"type": "commit", "sha": ACTIVATION},
            },
        }
        self.calls = []
        self.downloads = []
        self.fail_endpoint = None
        self.fail_after = None
        self.seal_registration()

    def seal_intent(self):
        self.raw = encoded(self.approval)
        self.digest = sha(self.raw)
        self.git.files[ACTIVATION, INTENT_PATH] = self.raw
        self.git.commit_message = activation_message(SOURCE, self.digest)
        self.binding = {
            "source_sha": SOURCE, "source_tree": TREE, "intent_sha256": self.digest,
            "template_sha256": sha(self.git.show(SOURCE, TEMPLATE_PATH)),
            "registration": deepcopy(self.approval["source_registration"]),
        }

    def seal_registration(self):
        self.zip = archive_bytes(self.proof)
        self.approval["source_registration"]["artifact_sha256"] = sha(self.zip)
        self.artifact.update(digest="sha256:" + sha(self.zip), size_in_bytes=len(self.zip))
        self.seal_intent()

    def api(self, endpoint):
        assert endpoint.startswith(BASE)
        tail = endpoint[len(BASE):]
        self.calls.append(tail)
        if tail == self.fail_endpoint or (
                self.fail_after is not None and len(self.calls) > self.fail_after):
            raise OSError("Synthetic uncertain authority read")
        assert tail in self.responses, "Unexpected read-only API route: " + tail
        return deepcopy(self.responses[tail])

    def download(self, artifact_id):
        assert artifact_id == ARTIFACT_ID
        self.downloads.append(artifact_id)
        return self.zip

    def verify(self):
        return verify_registered_attempt(
            self.git, self.context, self.binding, self.api, self.download, NOW,
        )

    def capture(self):
        return validated_capture_context(
            self.approval, self.digest, environment=self.env, event=self.event,
            git=self.git, api=self.api, download=self.download, now=NOW,
        )

    def consume(self, root):
        event_path = root / "push-event.json"
        event_path.write_bytes(encoded(self.event))
        self.env.update(GITHUB_EVENT_PATH=str(event_path), RUNNER_TEMP=str(root))
        return consume_push_attempt(
            self.approval, self.digest, environment=self.env, api=self.api,
            clock=lambda: NOW, git=self.git, download=self.download,
        )


@pytest.fixture
def fixture():
    return Fixture()


def test_checked_in_policy_and_template_are_unarmed():
    policy = json.loads((ROOT / POLICY_PATH).read_bytes())
    template = json.loads((ROOT / TEMPLATE_PATH).read_bytes())
    assert policy == {"schema_version": "four-symbol-price-push-policy-v1",
                      "branch": BRANCH, "enabled": False}
    assert template["capture_approved"] is False
    assert template["controller_sha"] is None
    assert template["provider_budget"]["review_status"] == "pending_owner_review"
    assert template["github_admission"]["review_status"] == "pending_owner_review"
    assert all(row["review_status"] == "pending_owner_review"
               for row in template["identity_records"])
    assert all(value is None for value in template["source_registration"].values())


@pytest.mark.parametrize("enabled", [False, True])
def test_registration_receipt_proves_source_without_approving_capture(fixture, enabled):
    policy = json.loads(fixture.git.show(SOURCE, POLICY_PATH))
    policy["enabled"] = enabled
    fixture.git.files[SOURCE, POLICY_PATH] = encoded(policy)
    run = run_record(REGISTER_RUN, 1, SOURCE)
    proof = registration_receipt(fixture.git, fixture.source_context, run, NOW)
    assert proof["source_sha"] == SOURCE
    assert proof["source_tree"] == TREE
    assert proof["template_sha256"] == sha(fixture.git.show(SOURCE, TEMPLATE_PATH))
    assert proof["policy_sha256"] == sha(encoded(policy))
    assert proof["capture_policy_enabled"] is enabled
    assert proof["capture_approved"] is False
    assert proof["intent_present"] is False
    assert proof["provider_requests"] == 0
    assert fixture.calls == fixture.downloads == fixture.git.commands == []


@pytest.mark.parametrize("mutation", ["later_run", "existing_intent", "foreign_run", "wrong_head"])
def test_registration_rejects_armed_or_nonfirst_source(fixture, mutation):
    context = deepcopy(fixture.source_context)
    run = run_record(REGISTER_RUN, 1, SOURCE)
    if mutation == "later_run":
        context["run_number"] = 2
    elif mutation == "existing_intent":
        fixture.git.files[SOURCE, INTENT_PATH] = fixture.raw
    elif mutation == "foreign_run":
        run["repository"]["id"] += 1
    else:
        run["head_sha"] = OTHER
    with pytest.raises(ValueError):
        registration_receipt(fixture.git, context, run, NOW)


def test_exact_c_r_i_activation_and_prepare_are_read_only(fixture):
    spec = prepare_activation(fixture.git, SOURCE, fixture.raw, fixture.digest)
    intent, binding = validate_activation(
        fixture.git, fixture.context, fixture.event, fixture.raw,
        reviewed_intent_sha=fixture.digest,
    )
    assert intent == fixture.approval
    assert binding == fixture.binding
    assert spec["expected_parent"] == SOURCE
    assert spec["only_changed_path"] == INTENT_PATH
    assert spec["intent_sha256"] == fixture.digest
    assert spec["capture_permission_from_spec_alone"] is False
    assert spec["remote_write_performed"] is False
    assert fixture.calls == fixture.downloads == fixture.git.commands == []


@pytest.mark.parametrize("path,value", [
    (("GITHUB_ACTIONS",), "false"),
    (("GITHUB_EVENT_NAME",), "workflow_dispatch"),
    (("GITHUB_REPOSITORY",), "someone/screener"),
    (("GITHUB_REF",), "refs/heads/main"),
    (("GITHUB_SHA",), OTHER), (("GITHUB_SHA",), "arbitrary-branch"),
    (("GITHUB_WORKFLOW_SHA",), SOURCE),
    (("GITHUB_WORKFLOW_REF",), f"{REPOSITORY}/{WORKFLOW}@refs/heads/main"),
    (("GITHUB_RUN_ID",), "0"), (("GITHUB_RUN_ID",), "not-a-run"),
    (("GITHUB_RUN_NUMBER",), "3"), (("GITHUB_RUN_ATTEMPT",), "2"),
])
def test_push_rejects_arbitrary_environment_identity(fixture, path, value):
    change(fixture.env, path, value)
    with pytest.raises(ValueError):
        push_context(fixture.env, fixture.event)


@pytest.mark.parametrize("path,value", [
    (("ref",), "refs/heads/main"), (("repository", "id"), REPOSITORY_ID + 1),
    (("after",), OTHER), (("deleted",), True), (("forced",), True),
    (("deleted",), None), (("forced",), None),
])
def test_push_rejects_foreign_recreated_or_uncertain_event(fixture, path, value):
    change(fixture.event, path, value)
    with pytest.raises(ValueError):
        push_context(fixture.env, fixture.event)


@pytest.mark.parametrize("mutation", [
    "reviewed_digest", "created_branch", "wrong_before", "first_run", "wrong_parent",
    "merge_parent", "extra_file", "modified_intent", "source_intent", "pushed_bytes",
    "commit_message", "workflow", "disabled_policy",
])
def test_activation_rejects_nonexact_review_and_non_intent_only_push(fixture, mutation):
    digest = fixture.digest
    if mutation == "reviewed_digest":
        digest = "f" * 64
    elif mutation == "created_branch":
        fixture.event["created"] = True
    elif mutation == "wrong_before":
        fixture.event["before"] = OTHER
    elif mutation == "first_run":
        fixture.context["run_number"] = 1
    elif mutation == "wrong_parent":
        fixture.git.parent_list = [OTHER]
    elif mutation == "merge_parent":
        fixture.git.parent_list = [SOURCE, OTHER]
    elif mutation == "extra_file":
        fixture.git.changed_paths.append("M\tbackend/app/main.py")
    elif mutation == "modified_intent":
        fixture.git.changed_paths = ["M\t" + INTENT_PATH]
    elif mutation == "source_intent":
        fixture.git.files[SOURCE, INTENT_PATH] = fixture.raw
    elif mutation == "pushed_bytes":
        fixture.git.files[ACTIVATION, INTENT_PATH] += b"\n"
    elif mutation == "commit_message":
        fixture.git.commit_message += "\nAnother instruction"
    elif mutation == "workflow":
        fixture.git.files[ACTIVATION, WORKFLOW] += b"changed\n"
    else:
        policy = json.loads(fixture.git.show(SOURCE, POLICY_PATH))
        policy["enabled"] = False
        fixture.git.files[SOURCE, POLICY_PATH] = encoded(policy)
    with pytest.raises(ValueError):
        validate_activation(fixture.git, fixture.context, fixture.event, fixture.raw,
                            reviewed_intent_sha=digest)


@pytest.mark.parametrize("path,value", [
    (("proposal_sha256",), "f" * 64), (("controller_sha",), OTHER),
    (("capture_approved",), False),
    (("identity_records", 0, "provider_symbol"), "AAPL"),
    (("identity_records", 0, "official_identifiers", "cik"), "different-issuer"),
    (("identity_records", 0, "review_status"), "trusted"),
    (("provider_budget", "scope"), "global"),
    (("provider_budget", "review_status"), "pending_owner_review"),
    (("provider_budget", "review_note"), ""),
    (("github_admission", "branch"), "main"),
    (("github_admission", "expected_run_number"), 3),
    (("github_admission", "expected_run_attempt"), 2),
    (("source_registration", "artifact_id"), True),
    (("source_registration", "artifact_sha256"), "unpinned"),
    (("prior_release", "run_id"), 37456692718),
    (("prior_release", "artifact_id"), 11421722414),
    (("prior_release", "artifact_name"), "github-pages-another-run"),
    (("prior_release", "artifact_sha256"), "f" * 64),
])
def test_intent_scope_and_approval_edits_fail_closed(fixture, path, value):
    change(fixture.approval, path, value)
    with pytest.raises(ValueError):
        validate_intent(fixture.approval, fixture.template, SOURCE)


def test_pending_identity_stays_pending_and_review_can_only_change_status(fixture):
    validate_intent(fixture.approval, fixture.template, SOURCE)
    fixture.approval["identity_records"][0]["review_status"] = "approved_for_price_identity_validation"
    validate_intent(fixture.approval, fixture.template, SOURCE)
    fixture.approval["identity_records"][0]["target_mic"] = "XNYS"
    with pytest.raises(ValueError):
        validate_intent(fixture.approval, fixture.template, SOURCE)


def test_prepare_requires_exact_reviewed_canonical_intent(fixture):
    with pytest.raises(ValueError):
        prepare_activation(fixture.git, SOURCE, fixture.raw, "f" * 64)
    noncanonical = json.dumps(fixture.approval, indent=2).encode()
    with pytest.raises(ValueError):
        prepare_activation(fixture.git, SOURCE, noncanonical, sha(noncanonical))


def test_complete_registration_and_exact_current_capture_are_admitted(fixture):
    result = fixture.capture()
    assert result["controller_sha"] == SOURCE
    assert result["activation_sha"] == ACTIVATION
    assert result["intent_sha256"] == fixture.digest
    assert result["registration_artifact_id"] == ARTIFACT_ID
    assert result["run_id"] == CAPTURE_RUN
    assert result["run_number"] == 2 and result["run_attempt"] == 1
    assert (result["job_id"], result["runner_id"], result["step_number"]) == (80, 81, 5)
    assert fixture.downloads == [ARTIFACT_ID]
    assert set(fixture.calls) == set(fixture.responses)
    assert fixture.git.commands == [("rev-parse", "HEAD")]


@pytest.mark.parametrize("mutation", ["extra", "missing", "duplicate", "incomplete", "oversized"])
def test_complete_history_rejects_repeated_missing_or_uncertain_runs(fixture, mutation):
    response = fixture.responses[f"actions/workflows/{WORKFLOW_ID}/runs?per_page=100"]
    runs = response["workflow_runs"]
    if mutation == "extra":
        runs.append(run_record(102, 3, OTHER))
    elif mutation == "missing":
        runs.pop(0)
    elif mutation == "duplicate":
        runs[0] = deepcopy(runs[1])
    response["total_count"] = len(runs)
    if mutation == "incomplete":
        response["total_count"] += 1
    elif mutation == "oversized":
        response["total_count"] = 101
    with pytest.raises(ValueError):
        fixture.verify()
    assert fixture.downloads == []


@pytest.mark.parametrize("endpoint", [
    f"actions/runs/{REGISTER_RUN}/attempts/1/jobs?per_page=100",
    f"actions/runs/{REGISTER_RUN}/artifacts?per_page=100",
    f"actions/runs/{CAPTURE_RUN}/artifacts?per_page=100",
    f"actions/runs/{CAPTURE_RUN}/attempts/1/jobs?per_page=100",
])
def test_incomplete_job_or_artifact_inventory_never_grants_capture(fixture, endpoint):
    fixture.responses[endpoint]["total_count"] += 1
    with pytest.raises(ValueError):
        fixture.capture()


@pytest.mark.parametrize("field,value", [
    ("id", WORKFLOW_ID + 1), ("path", ".github/workflows/another.yml"),
    ("state", "disabled_manually"),
])
def test_current_workflow_authority_must_still_be_exact_and_active(fixture, field, value):
    fixture.responses[f"actions/workflows/{WORKFLOW_ID}"][field] = value
    with pytest.raises(ValueError):
        fixture.capture()


@pytest.mark.parametrize("endpoint", [
    f"actions/runs/{CAPTURE_RUN}", f"actions/runs/{CAPTURE_RUN}/attempts/1",
    f"actions/runs/{REGISTER_RUN}/attempts/1",
])
@pytest.mark.parametrize("path,value", [
    (("run_attempt",), 2), (("head_sha",), OTHER),
    (("head_branch",), "main"), (("repository", "id"), REPOSITORY_ID + 1),
    (("head_repository", "id"), REPOSITORY_ID + 1),
    (("status",), "queued"), (("conclusion",), "cancelled"),
])
def test_exact_attempt_reads_reject_retried_canceled_foreign_or_uncertain_runs(
        fixture, endpoint, path, value):
    change(fixture.responses[endpoint], path, value)
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("index", [0, 1])
@pytest.mark.parametrize("path,value", [
    (("run_attempt",), 2), (("head_sha",), OTHER),
    (("conclusion",), "cancelled"), (("status",), "waiting"),
])
def test_latest_history_cannot_hide_a_retry_or_terminal_attempt(fixture, index, path, value):
    runs = fixture.responses[f"actions/workflows/{WORKFLOW_ID}/runs?per_page=100"]["workflow_runs"]
    change(runs[index], path, value)
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("mutation", ["registration_head", "registration_run", "registration_retry",
                                         "capture_executed", "missing_capture", "duplicate_registration"])
def test_registration_jobs_must_prove_one_unarmed_source_run(fixture, mutation):
    jobs = fixture.registration_jobs
    if mutation == "registration_head":
        jobs[0]["head_sha"] = OTHER
    elif mutation == "registration_run":
        jobs[0]["run_id"] += 1
    elif mutation == "registration_retry":
        jobs[0]["run_attempt"] = 2
    elif mutation == "capture_executed":
        jobs[1]["conclusion"] = "success"
    elif mutation == "missing_capture":
        jobs.pop()
    else:
        jobs.append(deepcopy(jobs[0]))
    fixture.responses[f"actions/runs/{REGISTER_RUN}/attempts/1/jobs?per_page=100"]["total_count"] = len(jobs)
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("index", [0, 1])
@pytest.mark.parametrize("path,value", [
    (("id",), 0), (("run_id",), CAPTURE_RUN), (("head_sha",), ACTIVATION),
    (("run_attempt",), True), (("status",), "queued"),
])
def test_both_source_jobs_bind_exact_registration_run_and_head(fixture, index, path, value):
    change(fixture.registration_jobs[index], path, value)
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("path,value", [
    (("id",), ARTIFACT_ID + 1), (("name",), "price-pilot-source-another-run"),
    (("expired",), True), (("digest",), "sha256:" + "f" * 64),
    (("size_in_bytes",), 0), (("size_in_bytes",), 256 * 1024 + 1),
    (("workflow_run", "id"), REGISTER_RUN + 1), (("workflow_run", "head_sha"), OTHER),
])
def test_registration_artifact_must_match_immutable_reference_and_producer(fixture, path, value):
    change(fixture.artifact, path, value)
    with pytest.raises(ValueError):
        fixture.verify()
    assert fixture.downloads == []


@pytest.mark.parametrize("path,value", [
    (("source_sha",), OTHER), (("source_tree",), OTHER),
    (("template_sha256",), "f" * 64), (("policy_sha256",), "f" * 64),
    (("workflow_id",), WORKFLOW_ID + 1), (("context", "run_id"), REGISTER_RUN + 1),
    (("capture_policy_enabled",), False), (("capture_approved",), True),
    (("intent_present",), True), (("provider_requests",), 1),
])
def test_rehashed_receipt_still_must_bind_exact_unarmed_source(fixture, path, value):
    change(fixture.proof, path, value)
    fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("created,artifact_created", [
    (NOW - timedelta(hours=2, seconds=1), NOW - timedelta(minutes=1)),
    (NOW + timedelta(seconds=1), NOW + timedelta(seconds=2)),
    (NOW - timedelta(minutes=5), NOW - timedelta(minutes=6)),
    (NOW - timedelta(minutes=5), NOW + timedelta(seconds=1)),
])
def test_stale_future_or_impossible_registration_clock_fails_closed(fixture, created, artifact_created):
    fixture.proof["created_at"] = created.isoformat()
    fixture.artifact["created_at"] = artifact_created.isoformat()
    fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


def test_registration_clock_requires_timezone(fixture):
    fixture.proof["created_at"] = "2026-10-06T18:50:00"
    fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("age_seconds,valid", [(7200, True), (7201, False)])
def test_maximum_registration_age_applies_even_when_all_authority_clocks_agree(
        fixture, age_seconds, valid):
    shift = timedelta(seconds=age_seconds - 600)
    for target, fields in [
        (fixture.proof, ("created_at",)),
        (fixture.artifact, ("created_at",)),
        (fixture.registration_jobs[0], ("started_at", "completed_at")),
        (fixture.responses[f"actions/runs/{REGISTER_RUN}/attempts/1"],
         ("created_at", "run_started_at", "updated_at")),
    ]:
        for field in fields:
            target[field] = (datetime.fromisoformat(target[field]) - shift).isoformat()
    fixture.seal_registration()
    if valid:
        assert fixture.verify() == fixture.proof
    else:
        with pytest.raises(ValueError):
            fixture.verify()


@pytest.mark.parametrize("target,field,minutes_ago", [
    ("run", "created_at", 12),
    ("run", "run_started_at", 11),
    ("run", "updated_at", 9),
    ("run", "updated_at", -1),
    ("job", "started_at", 9),
    ("job", "completed_at", 10),
    ("proof", "created_at", 13),
])
def test_registration_receipt_time_is_inside_exact_run_and_job_intervals(
        fixture, target, field, minutes_ago):
    timestamp = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    if target == "run":
        fixture.responses[f"actions/runs/{REGISTER_RUN}/attempts/1"][field] = timestamp
    elif target == "job":
        fixture.registration_jobs[0][field] = timestamp
    else:
        fixture.proof[field] = timestamp
        fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("mutation", ["digest", "path", "extra_member", "oversized_member", "oversized_archive"])
def test_registration_zip_is_bounded_and_has_one_exact_member(fixture, mutation):
    raw = fixture.zip
    if mutation == "path":
        raw = archive_bytes(fixture.proof, "../source-registration.json")
    elif mutation in ("extra_member", "oversized_member"):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("source-registration.json", b" " * (64 * 1024 + 1)
                             if mutation == "oversized_member" else encoded(fixture.proof))
            if mutation == "extra_member":
                archive.writestr("unexpected.json", b"{}")
        raw = output.getvalue()
    elif mutation == "oversized_archive":
        raw += b"x" * (256 * 1024)
    digest = "f" * 64 if mutation == "digest" else sha(raw)
    with pytest.raises(ValueError):
        read_registration_zip(raw, digest)


def test_download_bytes_cannot_be_replaced_after_artifact_metadata_check(fixture):
    fixture.zip = archive_bytes({**fixture.proof, "source_sha": OTHER})
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("expired", [False, True])
def test_existing_terminal_receipt_spends_even_expired_capture(fixture, expired):
    fixture.responses[f"actions/runs/{CAPTURE_RUN}/artifacts?per_page=100"] = {
        "total_count": 1, "artifacts": [{
            "name": f"price-pilot-terminal-{CAPTURE_RUN}-1", "expired": expired,
        }],
    }
    with pytest.raises(ValueError):
        fixture.capture()


@pytest.mark.parametrize("path,value", [
    (("run_id",), REGISTER_RUN), (("head_sha",), SOURCE),
    (("run_attempt",), 2), (("id",), 0), (("runner_id",), 0),
    (("status",), "completed"), (("conclusion",), "cancelled"),
    (("steps", 0, "status"), "queued"), (("steps", 0, "conclusion"), "success"),
])
def test_capture_job_and_active_step_belong_to_this_exact_run_and_head(fixture, path, value):
    change(fixture.capture_job, path, value)
    with pytest.raises(ValueError):
        fixture.capture()


@pytest.mark.parametrize("mutation", ["duplicate_job", "missing_job", "duplicate_step", "missing_step"])
def test_capture_job_and_step_are_unique(fixture, mutation):
    response = fixture.responses[f"actions/runs/{CAPTURE_RUN}/attempts/1/jobs?per_page=100"]
    if mutation == "duplicate_job":
        response["jobs"].append(deepcopy(fixture.capture_job))
    elif mutation == "missing_job":
        response["jobs"] = []
    elif mutation == "duplicate_step":
        fixture.capture_job["steps"].append(deepcopy(fixture.capture_job["steps"][0]))
    else:
        fixture.capture_job["steps"] = []
    response["total_count"] = len(response["jobs"])
    with pytest.raises(ValueError):
        fixture.capture()


@pytest.mark.parametrize("mutation", ["wrong_job", "wrong_checkout", "advanced_branch", "changed_approval", "noncanonical"])
def test_capture_requires_source_checkout_and_exact_reviewed_activation(fixture, mutation):
    if mutation == "wrong_job":
        fixture.env["GITHUB_JOB"] = REGISTER_JOB
    elif mutation == "wrong_checkout":
        fixture.git.checkout = ACTIVATION
    elif mutation == "advanced_branch":
        fixture.responses["git/ref/heads/" + BRANCH]["object"]["sha"] = OTHER
    elif mutation == "changed_approval":
        fixture.approval["provider_budget"]["review_note"] = "Edited after review"
    else:
        fixture.git.files[ACTIVATION, INTENT_PATH] += b"\n"
    with pytest.raises(ValueError):
        fixture.capture()


def test_uncertain_authority_read_never_grants_capture(fixture):
    fixture.fail_endpoint = f"actions/runs/{REGISTER_RUN}/attempts/1"
    with pytest.raises(OSError, match="uncertain"):
        fixture.capture()
    assert fixture.downloads == []


def test_consumption_has_one_fixed_marker_and_no_second_provider_admission(fixture, tmp_path):
    claim = fixture.consume(tmp_path)
    marker = tmp_path / f"{PILOT}-consumed.json"
    original = marker.read_bytes()
    assert claim["state"] == "consumed"
    assert claim["context"]["controller_sha"] == SOURCE
    assert claim["context"]["activation_sha"] == ACTIVATION
    fixture.env.update(PRICE_PILOT_OUTPUT="another-output", REDIS_HOST="another-redis")
    with pytest.raises(FileExistsError):
        fixture.consume(tmp_path)
    assert marker.read_bytes() == original


def test_uncertain_postconsumption_reread_keeps_attempt_spent(fixture, tmp_path):
    fixture.capture()
    fixture.fail_after = len(fixture.calls)
    fixture.calls.clear()
    with pytest.raises(OSError, match="uncertain"):
        fixture.consume(tmp_path)
    marker = tmp_path / f"{PILOT}-consumed.json"
    assert marker.exists()
    original = marker.read_bytes()
    fixture.fail_after = None
    with pytest.raises(FileExistsError):
        fixture.consume(tmp_path)
    assert marker.read_bytes() == original


@pytest.mark.parametrize("path,value", [
    (("activation_sha",), OTHER), (("repository_id",), REPOSITORY_ID + 1),
    (("repository",), "another/screener"), (("workflow_path",), "another.yml"),
    (("branch",), "main"), (("run_number",), 2), (("run_attempt",), 2),
    (("run_number",), True), (("run_attempt",), True),
])
def test_receipt_entire_source_context_is_bound(fixture, path, value):
    change(fixture.proof["context"], path, value)
    fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("count", [False, 0.0, "0", None])
def test_registration_proves_an_exact_integer_zero_provider_request_count(fixture, count):
    fixture.proof["provider_requests"] = count
    fixture.seal_registration()
    with pytest.raises(ValueError):
        fixture.verify()


@pytest.mark.parametrize("field,value", [("run_number", True), ("run_attempt", True)])
def test_run_identity_numbers_are_integers_not_booleans(fixture, field, value):
    run = deepcopy(fixture.registration_run)
    run[field] = value
    with pytest.raises(ValueError):
        checked_run(run, run_id=REGISTER_RUN, number=1, head=SOURCE,
                    workflow_id=WORKFLOW_ID, terminal=True)


@pytest.mark.parametrize("number", [None, 0, -1, True, "5"])
def test_capture_requires_a_positive_integer_step_number(fixture, number):
    fixture.capture_job["steps"][0]["number"] = number
    with pytest.raises(ValueError):
        fixture.capture()


def test_branch_reference_must_be_a_commit(fixture):
    fixture.responses["git/ref/heads/" + BRANCH]["object"]["type"] = "tag"
    with pytest.raises(ValueError):
        fixture.capture()
