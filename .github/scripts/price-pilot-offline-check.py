"""Fail-closed provenance and disconnected synthetic/real-Redis preview runner."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import traceback
import xml.etree.ElementTree as ET

BRANCH = "preview/four-symbol-price-pilot-offline"
WORKFLOW_PATH = ".github/workflows/price-pilot-offline-preview.yml"
PINS = {"yfinance": "0.2.66", "curl_cffi": "0.16.3", "exchange-calendars": "4.5.3"}
SOCKETS = ("/control/redis.sock", "/isolated-control/redis.sock")


def write_json(path, value):
    with Path(path).open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def provenance(env, head, clean):
    """Bind the report to one exact branch event and checked-out workflow SHA."""
    required = (
        "GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_SERVER_URL",
        "GITHUB_RUN_ID", "GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA",
        "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_WORKFLOW_REF", "GITHUB_WORKFLOW_SHA",
        "PRICE_PILOT_EXPECTED_SHA",
    )
    if any(not env.get(key) for key in required):
        raise ValueError("complete GitHub run/attempt/SHA/branch provenance is required")
    if env["GITHUB_ACTIONS"] != "true" or env["GITHUB_EVENT_NAME"] not in ("push", "workflow_dispatch"):
        raise ValueError("only the explicitly reviewed branch push/manual preview is supported")
    if env["GITHUB_REF"] != f"refs/heads/{BRANCH}" or env["GITHUB_REF_NAME"] != BRANCH:
        raise ValueError("preview branch does not match the exact review-only branch")
    if not re.fullmatch(r"[0-9a-f]{40}", head) or not clean:
        raise ValueError("preview needs a clean exact Git checkout")
    if any(env[key] != head for key in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "PRICE_PILOT_EXPECTED_SHA")):
        raise ValueError("checkout, event, workflow, and expected SHA must agree")
    repository = env["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("invalid GitHub repository")
    if env["GITHUB_SERVER_URL"] != "https://github.com":
        raise ValueError("unexpected GitHub server")
    expected_workflow = f"{repository}/{WORKFLOW_PATH}@refs/heads/{BRANCH}"
    if env["GITHUB_WORKFLOW_REF"] != expected_workflow:
        raise ValueError("unexpected workflow source")
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT"):
        if not re.fullmatch(r"[1-9][0-9]*", env[key]):
            raise ValueError("invalid exact GitHub run identity")
    return {
        "schema_version": "four-symbol-price-pilot-offline-preview-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repository": repository, "event": env["GITHUB_EVENT_NAME"],
        "run_id": env["GITHUB_RUN_ID"], "run_number": env["GITHUB_RUN_NUMBER"],
        "run_attempt": env["GITHUB_RUN_ATTEMPT"], "sha": head,
        "ref": env["GITHUB_REF"], "branch": env["GITHUB_REF_NAME"],
        "workflow_ref": env["GITHUB_WORKFLOW_REF"], "workflow_sha": env["GITHUB_WORKFLOW_SHA"],
        "run_attempt_url": f"https://github.com/{repository}/actions/runs/{env['GITHUB_RUN_ID']}/attempts/{env['GITHUB_RUN_ATTEMPT']}",
        "capture_approved": False, "capture_executed": False,
        "publication_authority": False, "provider_requests_authorized": 0,
        "budget_scope": "job_local_ephemeral_redis_only",
        "global_provider_budget_verified": False,
        "scope_limitation": "Separate jobs or Redis instances do not coordinate global provider budgets.",
    }


def assert_disconnected(interfaces):
    if set(interfaces) != {"lo"}:
        raise ValueError("offline tests require only the loopback interface")


def inspect_containers(records):
    if len(records) != 3:
        raise ValueError("expected exactly one test and two isolated Redis containers")
    result = []
    for value in records:
        if value["HostConfig"]["NetworkMode"] != "none":
            raise ValueError("all preview containers must use Docker --network none")
        if value["HostConfig"].get("PortBindings"):
            raise ValueError("preview must not publish a port")
        result.append({"name": value["Name"], "id": value["Id"], "image_id": value["Image"],
                       "network_mode": "none", "published_ports": []})
    return result


def prepare(args):
    root = Path(args.root).resolve()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True)
    report = provenance(os.environ, head, not dirty.strip())
    paths = [*root.glob(".github/scripts/price-pilot-offline*"), root / WORKFLOW_PATH,
             root / "backend/app/scripts/bounded_price_recovery.py",
             root / "backend/app/services/bounded_price_recovery.py",
             root / "backend/app/services/price_pilot_admission.py",
             root / "backend/tests/unit/test_bounded_price_recovery.py",
             root / "backend/tests/unit/test_price_pilot_admission.py",
             root / "backend/tests/integration/test_price_pilot_redis.py",
             root / "backend/tests/fixtures/bounded_price_pilot_transport.json",
             *root.glob("backend/requirements*.txt"),
             *root.glob("docs/financial-source-evidence/four-symbol-price-*.json")]
    report["source_sha256"] = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted(set(paths))}
    write_json(Path(args.output) / "provenance.json", report)


def check(args):
    artifacts = Path(args.output)
    report = {"capture_approved": False, "capture_executed": False, "provider_requests_authorized": 0,
              "publication_authority": False, "budget_scope": "job_local_ephemeral_redis_only",
              "global_provider_budget_verified": False, "status": "failed"}
    try:
        if os.environ.get("PRICE_PILOT_OFFLINE_REQUIRED") != "1":
            raise ValueError("required offline test admission is missing")
        interfaces = sorted(os.listdir("/sys/class/net"))
        assert_disconnected(interfaces)
        records = json.loads((artifacts / "containers.json").read_text())
        report["containers"] = inspect_containers(records)
        report["network_boundary"] = {"docker_network_mode": "none", "interfaces": interfaces,
                                      "redis_transport": "unix_sockets_only", "provider_probes_sent": 0}
        binding = json.loads((artifacts / "provenance.json").read_text())
        report["run_id"] = binding["run_id"]
        report["run_attempt"] = binding["run_attempt"]
        report["sha"] = binding["sha"]
        report["branch"] = binding["branch"]
        actual = {name: importlib.metadata.version(name) for name in PINS}
        if actual != PINS:
            raise ValueError(f"reviewed runtime pins differ: {actual}")
        report["reviewed_runtime_versions"] = actual
        for module in ("pandas", "yfinance", "curl_cffi", "redis", "pydantic", "pydantic_settings",
                       "sqlalchemy", "exchange_calendars", "app.config", "app.services.rate_budget_policy"):
            importlib.import_module(module)
        from app.scripts.bounded_price_recovery import verify_vendor_sources
        from app.services.bounded_price_recovery import read_pinned_proposal
        proposal = read_pinned_proposal(Path(args.root) / "docs/financial-source-evidence/four-symbol-price-recovery-proposal-2026-10-06.json")
        verify_vendor_sources(proposal)
        report["vendor_source_contract"] = "verified"
        from app.config import settings
        if settings.redis_enabled is not False:
            raise ValueError("the offline preview must leave production Redis activation disabled")
        pending = json.loads((Path(args.root) / "docs/financial-source-evidence/four-symbol-price-pilot-admission-pending-2026-10-06.json").read_text())
        if pending.get("capture_approved") is not False:
            raise ValueError("the preview requires the non-capture pending admission")
        subprocess.run([sys.executable, "-m", "pip", "check"], check=True)
        resolved = subprocess.check_output([sys.executable, "-m", "pip", "freeze", "--all"], text=True)
        (artifacts / "resolved-requirements.txt").write_text(resolved)
        import redis
        report["redis_instances"] = []
        for socket in SOCKETS:
            client = redis.Redis(unix_socket_path=socket, socket_timeout=2, socket_connect_timeout=2)
            try:
                assert client.ping()
                server = client.info("server")
                if int(client.config_get("port")["port"]) != 0:
                    raise ValueError("Redis must have no TCP listener")
                report["redis_instances"].append({"socket": socket, "redis_version": server["redis_version"],
                                                   "run_id": server["run_id"], "tcp_port": 0})
            finally:
                client.close()
        if report["redis_instances"][0]["run_id"] == report["redis_instances"][1]["run_id"]:
            raise ValueError("isolation-scope check needs genuinely separate Redis servers")
        commands = [
            [sys.executable, str(Path(args.root) / ".github/scripts/price-pilot-offline-test.py")],
            [sys.executable, "-m", "pytest", "--noconftest", "-p", "no:cacheprovider", "-q",
             "backend/tests/unit/test_bounded_price_recovery.py",
             "backend/tests/unit/test_price_pilot_admission.py",
             "backend/tests/integration/test_price_pilot_redis.py",
             f"--junitxml={artifacts / 'pytest.xml'}"],
        ]
        for index, command in enumerate(commands):
            completed = subprocess.run(command, cwd=args.root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            (artifacts / f"test-{index + 1}.log").write_text(completed.stdout)
            print(completed.stdout, end="", flush=True)
            if completed.returncode:
                raise RuntimeError(f"test command {index + 1} exited {completed.returncode}")
        suites = ET.parse(artifacts / "pytest.xml").getroot().iter("testsuite")
        totals = {name: 0 for name in ("tests", "failures", "errors", "skipped")}
        for suite in suites:
            for name in totals:
                totals[name] += int(suite.get(name, "0"))
        if totals["tests"] == 0 or any(totals[name] for name in ("failures", "errors", "skipped")):
            raise RuntimeError(f"required test suite did not pass without skips: {totals}")
        report["pytest"] = totals
        report["status"] = "passed_offline_only"
        return 0
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        return 1
    finally:
        write_json(artifacts / "result.json", report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "check"))
    parser.add_argument("--root", default="/work")
    parser.add_argument("--output", default="/artifacts")
    args = parser.parse_args()
    return prepare(args) if args.command == "prepare" else check(args)


if __name__ == "__main__":
    raise SystemExit(main())
