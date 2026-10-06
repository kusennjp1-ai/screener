"""TRANSPORT ONLY: preserve one pinned GitHub artifact ZIP byte-for-byte.

No extraction, certification, approval, activation, or publication authority.
The only network operation is authenticated, read-only `gh api` on this repo.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import struct
import subprocess
import time
import zipfile


REPOSITORY = "kusennjp1-ai/screener"
BRANCH = "diagnostic/financial-candidate-transport-20261006"
WORKFLOW = ".github/workflows/financial-candidate-transport.yml"
SOURCE = {
    "repository": REPOSITORY,
    "workflow": ".github/workflows/financial-performance-certification.yml",
    "workflow_name": "Financial Performance Certification",
    "head_sha": "0ab45896dd825e05e5ef3e28b0d51e25e2928cf7",
    "head_branch": "main",
    "run_id": 37389108358,
    "run_attempt": 1,
    "job_id": 112029676592,
    "job_name": "Certify exact financial performance exception",
    "artifact_id": 11381411253,
    "artifact_name": "financial-performance-candidate-37389108358-1",
    "size_in_bytes": 1057593973,
    "sha256": "63a7ac2e5e0046789c0a5ade8e78a9af6aa05ff2f6053143bf112dbff19fc11e",
}
PART_BYTES = 400 * 1024 * 1024
DOWNLOAD_LIMIT = 512 * 1024 * 1024
BUFFER_BYTES = 1024 * 1024
MANIFEST_LIMIT = 64 * 1024
PREFIX = f"repos/{REPOSITORY}/actions/"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive(value):
    return type(value) is int and value > 0


def sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def directory(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), "Directory contains an alias or symlink")
    require(stat.S_ISDIR(path.lstat().st_mode), "Expected a real directory")
    return path


def file_path(root, name):
    directory(root)
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", name), "Unsafe filename")
    return root / name


def directory_fd(root):
    directory(root)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in root.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_file(root, name, writing=False):
    file_path(root, name)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL if writing else os.O_RDONLY
    parent = directory_fd(root)
    try:
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Linked or special file")
        return os.fdopen(fd, "wb" if writing else "rb")
    except BaseException:
        os.close(fd)
        raise


def write_json(root, name, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    require(len(data) <= MANIFEST_LIMIT, "Manifest exceeds bound")
    with open_file(root, name, writing=True) as output:
        output.write(data)


def read_json(root, name):
    with open_file(root, name) as source:
        data = source.read(MANIFEST_LIMIT + 1)
    require(len(data) <= MANIFEST_LIMIT, "Manifest exceeds bound")
    return json.loads(data)


def command_chunks(command, limit, seconds):
    """Bound stdout, elapsed time, and memory; never expose CLI stderr/redirects."""
    env = {key: value for key, value in os.environ.items() if key not in ("GH_DEBUG", "DEBUG")}
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    deadline, total = time.monotonic() + seconds, 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, "GitHub read exceeded time bound")
                require(selector.select(remaining), "GitHub read exceeded time bound")
                data = os.read(process.stdout.fileno(), BUFFER_BYTES)
                if not data:
                    break
                total += len(data)
                require(total <= limit, "GitHub response exceeds byte bound")
                yield data
        require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, "GitHub read failed")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def gh_chunks(endpoint, limit, seconds):
    require(endpoint.startswith(PREFIX), "Unexpected API repository")
    return command_chunks([
        "gh", "api", "--hostname", "github.com", "--method", "GET",
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint,
    ], limit, seconds)


def gh_json(endpoint):
    return json.loads(b"".join(gh_chunks(endpoint, BUFFER_BYTES, 30)))


def verify_source(artifact, run, job, workflow, expected=SOURCE):
    s = expected
    require(all(isinstance(value, dict) for value in (artifact, run, job, workflow)), "Invalid GitHub metadata object")
    require(artifact.get("id") == s["artifact_id"] and artifact.get("name") == s["artifact_name"], "Source artifact identity mismatch")
    require(artifact.get("expired") is False and artifact.get("size_in_bytes") == s["size_in_bytes"]
            and artifact.get("digest") == "sha256:" + s["sha256"], "Source artifact length/hash/expiry mismatch")
    require(run.get("id") == s["run_id"] and run.get("run_attempt") == s["run_attempt"]
            and run.get("path") == s["workflow"] and run.get("name") == s["workflow_name"]
            and run.get("head_sha") == s["head_sha"] and run.get("head_branch") == s["head_branch"]
            and run.get("event") == "workflow_run" and run.get("status") == "completed"
            and run.get("conclusion") == "success", "Source workflow attempt identity/success mismatch")
    repo, head_repo = run.get("repository", {}), run.get("head_repository", {})
    require(repo.get("full_name") == s["repository"] and head_repo.get("full_name") == s["repository"]
            and positive(repo.get("id")) and repo.get("id") == head_repo.get("id"), "Source repository mismatch")
    binding = artifact.get("workflow_run", {})
    require(binding.get("id") == s["run_id"] and binding.get("head_sha") == s["head_sha"]
            and binding.get("head_branch") == s["head_branch"]
            and binding.get("repository_id") == repo["id"] and binding.get("head_repository_id") == repo["id"],
            "Source artifact run/head/repository mismatch")
    require(positive(workflow.get("id")) and workflow.get("id") == run.get("workflow_id")
            and workflow.get("path") == s["workflow"] and workflow.get("name") == s["workflow_name"], "Source workflow mismatch")
    require(job.get("id") == s["job_id"] and job.get("run_id") == s["run_id"]
            and job.get("run_attempt") == s["run_attempt"] and job.get("head_sha") == s["head_sha"]
            and job.get("name") == s["job_name"] and job.get("status") == "completed"
            and job.get("conclusion") == "success", "Source job identity/success mismatch")
    for name in ("Verify exact approval and immutable capture", "Recheck financial proofs and seal exact exception candidate",
                 "Retain exact exception candidate and unchanged failed Design evidence"):
        steps = [step for step in job.get("steps", []) if step.get("name") == name]
        require(len(steps) == 1 and steps[0].get("conclusion") == "success", "Source artifact-producing step was not successful")


def transport_context(env):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY and env.get("GITHUB_REF") == "refs/heads/" + BRANCH
            and env.get("GITHUB_EVENT_NAME") == "push", "Transport requires the exact diagnostic branch push")
    require(re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", "")), "Invalid transport head")
    require(all(re.fullmatch(r"[1-9][0-9]*", env.get(k, "")) for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")), "Invalid transport run")
    return {"repository": REPOSITORY, "workflow": WORKFLOW, "head_sha": env["GITHUB_SHA"],
            "head_branch": BRANCH, "run_id": int(env["GITHUB_RUN_ID"]), "run_attempt": int(env["GITHUB_RUN_ATTEMPT"])}


def part_name(index):
    return f"part-{index:03d}.bin"


def artifact_name(context, index):
    return f"financial-candidate-transport-{context['run_id']}-{context['run_attempt']}-part-{index:03d}"


def copy_checked(chunks, output, size, digest):
    actual, count = hashlib.sha256(), 0
    for data in chunks:
        count += len(data)
        require(count <= size, "Input exceeds exact length")
        actual.update(data)
        output.write(data)
    require(count == size, "Input truncated or length mismatched")
    require(actual.hexdigest() == digest, "Input SHA256 mismatch")


def zip_inventory(root, name):
    """Inspect only bounded central-directory metadata; never inflate members."""
    with open_file(root, name) as source:
        size = os.fstat(source.fileno()).st_size
        source.seek(max(0, size - 65557))
        tail = source.read(65557)
        offset = tail.rfind(b"PK\x05\x06")
        require(offset >= 0 and len(tail) - offset >= 22, "Missing ZIP end record")
        end = struct.unpack_from("<4s4H2IH", tail, offset)
        require(len(tail) - offset == 22 + end[-1] and end[1] == end[2] == 0, "Invalid or multi-disk ZIP")
        entries, central_bytes = end[4], end[5]
        if entries == 65535 or central_bytes == 0xffffffff or end[6] == 0xffffffff:
            end_offset = max(0, size - 65557) + offset
            require(end_offset >= 20, "Missing ZIP64 locator")
            source.seek(end_offset - 20)
            locator = struct.unpack("<4sIQI", source.read(20))
            require(locator[0] == b"PK\x06\x07" and locator[1] == 0 and locator[3] == 1, "Invalid ZIP64 locator")
            source.seek(locator[2])
            record = struct.unpack("<4sQ2H2I4Q", source.read(56))
            require(record[0] == b"PK\x06\x06" and record[4] == record[5] == 0, "Invalid ZIP64 end record")
            entries, central_bytes = record[7], record[8]
        require(0 < entries <= 128 and 0 < central_bytes <= BUFFER_BYTES, "ZIP metadata exceeds bound")
        source.seek(0)
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            require(len(infos) == entries, "ZIP entry count mismatch")
            members = []
            for info in infos:
                name = info.filename
                require(len(name) <= 512 and re.fullmatch(r"[A-Za-z0-9._/-]+", name)
                        and all(part not in ("", ".", "..") for part in name.rstrip("/").split("/"))
                        and not stat.S_ISLNK(info.external_attr >> 16), "Unsafe source ZIP member")
                members.append({"name": name, "size_in_bytes": info.file_size, "compressed_size_in_bytes": info.compress_size})
            require(len({member["name"] for member in members}) == len(members), "Duplicate ZIP members")
    return {"members": members, "expanded_size_in_bytes": sum(member["size_in_bytes"] for member in members)}


def split_archive(root, context, expected=SOURCE, part_bytes=PART_BYTES):
    require(positive(part_bytes) and part_bytes <= PART_BYTES, "Unsafe part size")
    parts, entire, total = [], hashlib.sha256(), 0
    with open_file(root, "original-artifact.zip") as source:
        require(os.fstat(source.fileno()).st_size == expected["size_in_bytes"], "Source ZIP length mismatch")
        while total < expected["size_in_bytes"]:
            index, count, digest = len(parts) + 1, 0, hashlib.sha256()
            target = min(part_bytes, expected["size_in_bytes"] - total)
            with open_file(root, part_name(index), writing=True) as output:
                while count < target:
                    data = source.read(min(BUFFER_BYTES, part_bytes - count, expected["size_in_bytes"] - total))
                    require(data, "Source ZIP truncated")
                    output.write(data)
                    digest.update(data)
                    entire.update(data)
                    count += len(data)
                    total += len(data)
            parts.append({"index": index, "filename": part_name(index), "artifact_name": artifact_name(context, index),
                          "size_in_bytes": count, "sha256": digest.hexdigest()})
        require(source.read(1) == b"", "Source ZIP grew")
    require(entire.hexdigest() == expected["sha256"], "Source ZIP SHA256 mismatch")
    manifest = {"schema_version": "financial-candidate-transport-v1", "purpose": "TRANSPORT ONLY",
                "publication_authority": "none", "archive_format": "original-github-artifact-zip",
                "source": dict(expected), "transport": context, "part_bytes": part_bytes, "parts": parts,
                "original_zip": zip_inventory(root, "original-artifact.zip")}
    write_json(root, "parts-manifest.json", manifest)
    return manifest


def validate_manifest(manifest, expected=SOURCE, part_bytes=PART_BYTES, final=False):
    require(isinstance(manifest, dict), "Invalid manifest object")
    require(manifest.get("schema_version") == "financial-candidate-transport-v1"
            and manifest.get("purpose") == "TRANSPORT ONLY" and manifest.get("publication_authority") == "none"
            and manifest.get("archive_format") == "original-github-artifact-zip", "Not a transport manifest")
    require(manifest.get("source") == expected and manifest.get("part_bytes") == part_bytes, "Manifest source/part bound mismatch")
    inventory = manifest.get("original_zip", {})
    require(isinstance(inventory, dict) and isinstance(inventory.get("members"), list)
            and 0 < len(inventory["members"]) <= 128, "Missing ZIP inventory")
    require(all(isinstance(member, dict) and isinstance(member.get("name"), str)
                and type(member.get("size_in_bytes")) is int and member["size_in_bytes"] >= 0
                and type(member.get("compressed_size_in_bytes")) is int and member["compressed_size_in_bytes"] >= 0
                for member in inventory["members"]), "Invalid ZIP inventory")
    require(inventory.get("expanded_size_in_bytes") == sum(member["size_in_bytes"] for member in inventory["members"]),
            "ZIP expanded byte total mismatch")
    context = manifest.get("transport", {})
    require(isinstance(context, dict), "Invalid transport object")
    require(context.get("repository") == REPOSITORY and context.get("workflow") == WORKFLOW
            and context.get("head_branch") == BRANCH and positive(context.get("run_id"))
            and positive(context.get("run_attempt")) and re.fullmatch(r"[a-f0-9]{40}", context.get("head_sha", "")), "Invalid manifest transport")
    count = (expected["size_in_bytes"] + part_bytes - 1) // part_bytes
    parts = manifest.get("parts", [])
    require(isinstance(parts, list) and len(parts) == count, "Missing or extra manifest parts")
    for index, part in enumerate(parts, 1):
        require(isinstance(part, dict), "Invalid part object")
        require(part.get("index") == index and part.get("filename") == part_name(index)
                and part.get("artifact_name") == artifact_name(context, index), "Shuffled or unsafe manifest part")
        require(part.get("size_in_bytes") == min(part_bytes, expected["size_in_bytes"] - (index - 1) * part_bytes)
                and sha256(part.get("sha256")), "Invalid part length/hash")
        if final:
            require(positive(part.get("artifact_id")) and sha256(part.get("artifact_zip_sha256"))
                    and type(part.get("artifact_zip_bytes")) is int
                    and 0 < part["artifact_zip_bytes"] < DOWNLOAD_LIMIT, "Unbounded or missing uploaded part")
    if final:
        require(len({part["artifact_id"] for part in parts}) == count, "Duplicate uploaded artifact IDs")
    return parts


def finalize(root, context, uploads, api=gh_json, expected=SOURCE, part_bytes=PART_BYTES):
    manifest = read_json(root, "parts-manifest.json")
    parts = validate_manifest(manifest, expected, part_bytes)
    require(manifest["transport"] == context and len(uploads) == len(parts), "Transport upload context/count mismatch")
    for part, upload in zip(parts, uploads):
        artifact_id, digest = upload
        require(positive(artifact_id) and sha256(digest), "Invalid upload result")
        artifact = api(PREFIX + f"artifacts/{artifact_id}")
        binding = artifact.get("workflow_run", {})
        require(artifact.get("id") == artifact_id and artifact.get("name") == part["artifact_name"]
                and artifact.get("digest") == "sha256:" + digest and artifact.get("expired") is False
                and type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] < DOWNLOAD_LIMIT
                and binding.get("id") == context["run_id"] and binding.get("head_sha") == context["head_sha"]
                and binding.get("head_branch") == BRANCH, "Uploaded part identity/hash/length mismatch")
        part.update(artifact_id=artifact_id, artifact_zip_sha256=digest, artifact_zip_bytes=artifact["size_in_bytes"])
    validate_manifest(manifest, expected, part_bytes, final=True)
    write_json(root, "transport-manifest.json", manifest)
    return manifest


def reassemble(root, expected=SOURCE, part_bytes=PART_BYTES):
    manifest = read_json(root, "transport-manifest.json")
    parts = validate_manifest(manifest, expected, part_bytes, final=True)
    # Read only fixed leaf names, never archive entries or manifest-provided paths.
    def chunks():
        for part in parts:
            with open_file(root, part["filename"]) as source:
                require(os.fstat(source.fileno()).st_size == part["size_in_bytes"], "Part length mismatch")
                digest, count = hashlib.sha256(), 0
                for data in iter(lambda: source.read(BUFFER_BYTES), b""):
                    count += len(data)
                    require(count <= part["size_in_bytes"], "Part grew while reading")
                    digest.update(data)
                    yield data
                require(count == part["size_in_bytes"] and digest.hexdigest() == part["sha256"], "Part truncated or corrupt")
    created = False
    try:
        with open_file(root, "reassembled-artifact.zip", writing=True) as output:
            created = True
            copy_checked(chunks(), output, expected["size_in_bytes"], expected["sha256"])
        require(zip_inventory(root, "reassembled-artifact.zip") == manifest["original_zip"], "ZIP inventory mismatch")
    except BaseException:
        if created:
            parent = directory_fd(root)
            try:
                os.unlink("reassembled-artifact.zip", dir_fd=parent)
            finally:
                os.close(parent)
        raise
    return {"purpose": "TRANSPORT ONLY", "artifact_id": expected["artifact_id"],
            "size_in_bytes": expected["size_in_bytes"], "sha256": expected["sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "finalize", "reassemble"))
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "reassemble":
        result = reassemble(directory(args.directory))
    else:
        context = transport_context(os.environ)
        if args.command == "prepare":
            directory(args.directory.parent)
            require(args.directory.name == "financial-candidate-transport", "Unexpected transport directory")
            parent = directory_fd(args.directory.parent)
            try:
                os.mkdir(args.directory.name, mode=0o700, dir_fd=parent)
            finally:
                os.close(parent)
            root = directory(args.directory)
            verify_source(gh_json(PREFIX + f"artifacts/{SOURCE['artifact_id']}"),
                          gh_json(PREFIX + f"runs/{SOURCE['run_id']}/attempts/{SOURCE['run_attempt']}"),
                          gh_json(PREFIX + f"jobs/{SOURCE['job_id']}"),
                          gh_json(PREFIX + "workflows/financial-performance-certification.yml"))
            with open_file(root, "original-artifact.zip", writing=True) as output:
                copy_checked(gh_chunks(PREFIX + f"artifacts/{SOURCE['artifact_id']}/zip", SOURCE["size_in_bytes"], 420),
                             output, SOURCE["size_in_bytes"], SOURCE["sha256"])
            result = split_archive(root, context)
        else:
            uploads = [(int(os.environ[f"PART_{i}_ID"]), os.environ[f"PART_{i}_DIGEST"]) for i in (1, 2, 3)]
            result = finalize(directory(args.directory), context, uploads)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, AttributeError, struct.error, zipfile.BadZipFile, subprocess.SubprocessError):
        # No tokens, signed URLs, local paths, or raw API responses in failures.
        raise SystemExit("TRANSPORT ONLY: validation or bounded GitHub read failed") from None
