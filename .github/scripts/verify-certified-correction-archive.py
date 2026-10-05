"""Verify retained certificate bytes offline; never execute code from the ZIP.

Requires jsonschema >= 4. This helper grants no publication or provider authority.
The caller separately authenticates exact GitHub runs/jobs/artifacts and code tree.
"""
from collections import Counter
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
MAX_ZIP = 128 * 1024 * 1024
MAX_PROJECTION = 256 * 1024 * 1024
MAX_METADATA = 4 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate certificate JSON key: {key}")
        result[key] = value
    return result


def parse(data):
    return json.loads(data, object_pairs_hook=no_duplicates,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def digest(value):
    return sha256(canonical(value)).hexdigest()


def clock(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})", value), "Invalid certificate clock")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def verify(path, certificate_sha256):
    require(path.is_file() and path.stat().st_size <= MAX_ZIP, "Certificate ZIP exceeds bound")
    require(re.fullmatch(r"[a-f0-9]{64}", certificate_sha256), "Invalid certificate hash")
    trust = parse((ROOT / "contracts/financial_source_certification_trust_v1.json").read_bytes())
    code_hashes = {name: item["sha256"] for name, item in trust["files"].items()}
    # Use only controller-owned contracts, independently bound to the review.
    for name in ("contracts/financial_source_certification_v1.json", "contracts/financial_source_certification_v1.schema.json"):
        require(sha256((ROOT / name).read_bytes()).hexdigest() == code_hashes[name], "Local reviewed certificate contract changed")
    contract = parse((ROOT / "contracts/financial_source_certification_v1.json").read_bytes())
    schema = parse((ROOT / "contracts/financial_source_certification_v1.schema.json").read_bytes())
    with zipfile.ZipFile(path) as zipped:
        infos, names, total = zipped.infolist(), set(), 0
        require(len(infos) <= 6, "Unexpected certificate archive inventory")
        for info in infos:
            name, mode = info.filename, info.external_attr >> 16
            require(name not in names and not PurePosixPath(name).is_absolute() and "\\" not in name
                    and all(part not in ("", ".", "..") for part in name.rstrip("/").split("/")), "Unsafe or duplicate certificate member")
            require(not stat.S_ISLNK(mode) and (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode)), "Special certificate member")
            require(not info.flag_bits & 1, "Encrypted certificate member")
            names.add(name)
            maximum = MAX_PROJECTION if re.fullmatch(r"projections/[a-f0-9]{64}\.json", name) else MAX_METADATA
            require(0 <= info.file_size <= maximum, "Certificate member exceeds bound")
            total += info.file_size
        require(total <= MAX_PROJECTION + 4 * MAX_METADATA, "Certificate archive exceeds bound")
        certificate_bytes = zipped.read("certificate.json")
        require(sha256(certificate_bytes).hexdigest() == certificate_sha256, "Certificate body hash mismatch")
        certificate = parse(certificate_bytes)
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(certificate)
        expected_names = {"certificate.json", "request.json", "source-api-evidence.json", "validation-code-manifest.json", certificate["projection"]["path"]}
        require(names in (expected_names, expected_names | {"projections/"}), "Unexpected certificate members")
        validation = certificate["validation"]
        require(validation["contract_version"] == contract["schema_version"]
                and validation["projection_policy"] == contract["projection_policy"]
                and validation["contract_sha256"] == code_hashes["contracts/financial_source_certification_v1.json"]
                and validation["policy_sha256"] == digest(code_hashes), "Certificate policy is not independently reviewed")
        manifest = parse(zipped.read("validation-code-manifest.json"))
        require(manifest == code_hashes, "Certificate code manifest is not independently reviewed")
        request_bytes, evidence_bytes = zipped.read("request.json"), zipped.read("source-api-evidence.json")
        request, evidence = parse(request_bytes), parse(evidence_bytes)
        require(request == {"schema_version": contract["schema_version"], "source": certificate["source"]}
                and sha256(request_bytes).hexdigest() == certificate["bindings"]["request_sha256"], "Certificate request binding mismatch")
        require(sha256(evidence_bytes).hexdigest() == certificate["bindings"]["source_api_evidence_sha256"], "Certificate evidence binding mismatch")
        require(isinstance(evidence, dict) and set(evidence) == {"run", "jobs", "artifacts"}, "Invalid closed source API evidence")
        expected_bindings = {key: certificate["source"][key] for key in ("archive_manifest_sha256", "acquisition_base_sha256", "cohort_sha256")}
        require(all(certificate["bindings"][key] == value for key, value in expected_bindings.items()), "Certificate source binding mismatch")
        summary = certificate["projection"]
        projection_bytes = zipped.read(summary["path"])
        require(summary["path"] == f"projections/{summary['sha256']}.json"
                and sha256(projection_bytes).hexdigest() == summary["sha256"], "Certificate projection hash mismatch")
        projection = parse(projection_bytes)
        require(set(projection) == {"bindings", "evaluated_at", "knowledge_basis", "point_in_time", "qualification_authority", "receipt_inventory", "schema_version", "source_data_as_of", "source_publication_date", "symbols"}, "Invalid closed certified projection")
        require(projection["bindings"] == expected_bindings and projection["evaluated_at"] == certificate["evaluated_at"]
                and all(projection[key] == summary[key] for key in ("schema_version", "knowledge_basis", "point_in_time", "qualification_authority", "source_data_as_of", "source_publication_date")), "Certificate projection semantics mismatch")
        require(isinstance(projection["symbols"], dict) and 0 < len(projection["symbols"]) == summary["cohort_count"] <= 20000,
                "Certificate full cohort mismatch")
        receipts = projection["receipt_inventory"]
        require(isinstance(receipts, list) and len(receipts) == summary["retained_receipts"]
                and digest(receipts) == summary["receipt_inventory_sha256"], "Certificate receipt inventory mismatch")
        receipt_hashes = [item["sha256"] for item in receipts]
        require(len(set(receipt_hashes)) == len(receipt_hashes) and receipt_hashes == sorted(receipt_hashes), "Duplicate or unsorted certificate receipts")
        require(len({item["symbol"] for item in receipts}) == summary["retained_symbols"]
                and all(item["symbol"] in projection["symbols"] for item in receipts)
                and summary["retained_symbols"] <= summary["attempted_symbols"] <= summary["cohort_count"], "Certificate source/cohort counts mismatch")
        times = [item["observed_at"] for item in receipts]
        bounds = {"earliest": min(times, key=clock) if times else None, "latest": max(times, key=clock) if times else None}
        require(bounds == summary["source_timestamp_bounds"], "Certificate original source clocks mismatch")
        require(all(clock(time) <= clock(certificate["evaluated_at"]) for time in times), "Certificate source clock renewed or future")
        for field, counts in summary["counts"].items():
            actual = Counter(item["availability_classification"][field] for item in projection["symbols"].values())
            require(set(actual) <= set(counts) and counts == {key: actual[key] for key in counts}, "Certificate availability counts mismatch")
        return {"certificate": certificate, "source_api_evidence": evidence}


if __name__ == "__main__":
    require(len(sys.argv) == 3, "Usage: verify-certified-correction-archive.py ZIP CERTIFICATE_SHA256")
    output = json.dumps(verify(Path(sys.argv[1]), sys.argv[2]), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    # Two independent 4 MiB metadata inputs are returned, with room for numeric
    # normalization. This matches the caller's explicit bounded stdout buffer.
    require(len(output.encode()) + 1 <= 16 * 1024 * 1024, "Certificate verification output exceeds bound")
    print(output)
