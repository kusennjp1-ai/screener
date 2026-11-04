"""Release asset cleanup must never prune the public financial audit archive.

The real inline cleanup program is extracted from the workflow and executed with
a fake ``gh`` on PATH, so the guard is exercised exactly as CI would run it.
"""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github/workflows/release-asset-cleanup.yml"

FAKE_GH = r'''#!{python}
import json, os, sys
args = sys.argv[1:]
with open(os.environ["FAKE_GH_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps(args) + "\n")
if args[:2] == ["release", "view"]:
    release = args[2]
    if release.startswith("financial-audit-"):
        print(json.dumps({"assets": [{"name": "carry-projection-x.json.gz", "size": 9, "createdAt": "2026-11-01"}]}))
    elif release == "daily-price-data":
        names = [f"daily-price-us-202610{day:02d}.json.gz" for day in range(1, 15)]
        print(json.dumps({"assets": [{"name": name, "size": 10, "createdAt": "2026-10-20"} for name in names]}))
    else:
        print(json.dumps({"assets": []}))
elif args[:2] == ["release", "download"]:
    pass
elif args[:2] == ["release", "delete-asset"]:
    pass
else:
    sys.exit(f"unexpected fake gh call {args}")
'''


def inline_program(text=None):
    text = WORKFLOW.read_text() if text is None else text
    match = re.search(r"python - <<'PY'\n(.*?)\n\s*PY\n", text, re.S)
    if match is None:
        raise AssertionError("Missing inline cleanup program")
    return textwrap.dedent(match.group(1))


class ReleaseAssetCleanupGuard(unittest.TestCase):
    def run_cleanup(self, program):
        with tempfile.TemporaryDirectory() as directory:
            bin_dir = Path(directory) / "bin"
            bin_dir.mkdir()
            gh = bin_dir / "gh"
            gh.write_text(FAKE_GH.replace("{python}", sys.executable))
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            log = Path(directory) / "gh.log"
            log.write_text("")
            env = {"PATH": f"{bin_dir}:{os.environ['PATH']}", "GITHUB_REPOSITORY": "kusennjp1-ai/screener", "DRY_RUN": "false", "FAKE_GH_LOG": str(log)}
            result = subprocess.run([sys.executable, "-I", "-"], input=program, text=True, capture_output=True, env=env, timeout=60)
            calls = [json.loads(line) for line in log.read_text().splitlines() if line]
            return result, calls

    def test_real_program_prunes_only_its_dated_policies(self):
        result, calls = self.run_cleanup(inline_program())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        deleted = [call for call in calls if call[:2] == ["release", "delete-asset"]]
        self.assertEqual(len(deleted), 4, "daily-price-data keeps ten dated assets")
        self.assertTrue(all(call[2] == "daily-price-data" for call in deleted))
        for call in calls:
            self.assertFalse(call[2].startswith("financial-audit-"), call)

    def test_reserved_policy_exits_before_any_gh_call(self):
        program = inline_program().replace('release="daily-price-data"', 'release="financial-audit-x"', 1)
        self.assertIn('release="financial-audit-x"', program)
        result, calls = self.run_cleanup(program)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing to prune reserved release", result.stderr + result.stdout)
        self.assertEqual(calls, [])

    def test_every_view_download_and_delete_is_guarded_even_without_the_startup_check(self):
        program = inline_program()
        startup = "for reserved_check in POLICIES:\n    assert_prunable(reserved_check.release)\n"
        self.assertIn(startup, program)
        for target in ("financial-audit-archive-carry-projection-x", "financial-audit-y"):
            changed = program.replace(startup, "").replace('release="daily-price-data"', f'release="{target}"', 1)
            result, calls = self.run_cleanup(changed)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual([call for call in calls if call[2:3] == [target]], [], "the guard precedes view")
        # Textual order: the guard sits immediately before each gh command.
        for command in ('["release", "view"', '"download",', '"delete-asset",'):
            self.assertEqual(program.count(command), 1, command)
            preceding = program[:program.find(command)].rstrip().splitlines()
            window = [line.strip() for line in preceding[-6:]]
            guard = [index for index, line in enumerate(window) if line == "assert_prunable(policy.release)"]
            self.assertTrue(guard, command)
            between = window[guard[-1] + 1:]
            self.assertTrue(all(line in ('result = subprocess.run(', 'subprocess.run(', '[', '"gh",', '"release",', 'payload = gh_json(["release", "view", policy.release, "--json", "assets"])') or line.startswith('payload = gh_json') for line in between), (command, between))
        self.assertIn('RESERVED_RELEASE_PREFIXES = ("financial-audit-",)', program)

    def test_guard_is_registered_in_exact_main_ci(self):
        ci = (REPO / ".github/workflows/ci.yml").read_text()
        self.assertIn("python3 -m unittest discover -s .github/scripts -p test_release_asset_cleanup.py", ci)


if __name__ == "__main__":
    unittest.main()
