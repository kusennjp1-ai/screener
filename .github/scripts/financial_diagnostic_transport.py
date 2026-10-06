"""Validate a packed, explicitly unpublished diagnostic. This grants no authority."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

REPO = Path(__file__).resolve().parents[2]
PREVIEW_KEYS = {"schema", "publication_authority", "ui_sha", "ui_digest", "data_manifest_sha256", "transport"}
VERIFIED_KEYS = {"schema", "logical_data_inventory_sha256", "ui_inventory_sha256",
                 "physical_inventory_sha256", "preview_publication_sha256"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def preview_publication(root):
    path = Path(root) / "corrected/publication.json"
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 65536,
            "Invalid diagnostic transport preview file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        raw = source.read(65537)
    require(len(raw) == info.st_size, "Diagnostic transport preview changed")
    value = json.loads(raw)
    require(isinstance(value, dict) and set(value) == PREVIEW_KEYS and
            value["schema"] == "static-json-transport-preview-v1" and
            value["publication_authority"] == "none" and
            re.fullmatch(r"[a-f0-9]{40}", str(value["ui_sha"])) and
            all(re.fullmatch(r"[a-f0-9]{64}", str(value[key])) for key in ("ui_digest", "data_manifest_sha256")) and
            isinstance(value["transport"], dict), "Diagnostic cannot retain publication authority")
    return value


def verify_candidate_transport(root):
    """The production adapter checks every shard and decoded logical byte."""
    preview = preview_publication(root)
    if preview is None:
        return None
    result = subprocess.run(
        ["node", str(REPO / ".github/scripts/financial-release-activation.mjs"),
         "verify-candidate-transport", str(Path(root).resolve())],
        cwd=REPO, check=True, capture_output=True, text=True, timeout=600,
    )
    require(len(result.stdout.encode()) <= 4096, "Oversized transport verification result")
    value = json.loads(result.stdout)
    require(isinstance(value, dict) and set(value) == VERIFIED_KEYS and
            value["schema"] == "verified-candidate-transport-v1" and
            all(re.fullmatch(r"[a-f0-9]{64}", str(value[key])) for key in VERIFIED_KEYS - {"schema"}),
            "Invalid transport verification result")
    receipt = json.loads((Path(root) / "preview-receipt.json").read_bytes())
    require(value["logical_data_inventory_sha256"] == receipt["bundles"]["corrected_data_sha256"] and
            value["ui_inventory_sha256"] == receipt["candidate_ui"]["digest"] == preview["ui_digest"] and
            receipt["candidate_ui"]["sha"] == preview["ui_sha"] and
            value["preview_publication_sha256"] == hashlib.sha256((Path(root) / "corrected/publication.json").read_bytes()).hexdigest(),
            "Transport diagnostic differs from original logical preview")
    return value
