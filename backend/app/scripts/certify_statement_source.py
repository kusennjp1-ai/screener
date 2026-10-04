"""Certify one explicitly pinned local statement ZIP and saved GitHub API evidence."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from app.services.statement_source_certification import certify


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("request", "api-evidence", "source-zip", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--evaluated-at", required=True)
    parser.add_argument("--code-sha", required=True)
    args = parser.parse_args(argv)
    try:
        result = certify(request_path=args.request, api_evidence_path=args.api_evidence, source_zip=args.source_zip,
                         output_dir=args.output_dir, evaluated_at=args.evaluated_at, code_sha=args.code_sha)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"result": "rejected", "reason": str(exc)}))
        return 1
    print(json.dumps({key: result[key] for key in ("result", "certificate_path", "certificate_sha256", "source", "projection", "source_execution")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
