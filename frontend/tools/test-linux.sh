#!/usr/bin/env bash
set -euo pipefail

source_root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
runtime="/var/tmp/screener-test-runtime-$(id -u)"
node_version=v22.23.4
archive="node-${node_version}-linux-x64.tar.xz"
checksum=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
node_home="$runtime/node-${node_version}-linux-x64"

if [[ ${1:-} == --setup-runtime ]]; then
  shift
  [[ $(uname -m) == x86_64 ]] || { echo 'This pinned runtime requires x86_64 Linux.' >&2; exit 1; }
  mkdir -p "$runtime"
  curl --fail --silent --show-error "https://nodejs.org/dist/${node_version}/${archive}" -o "$runtime/$archive"
  (cd "$runtime" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -)
  tar -xf "$runtime/$archive" -C "$runtime"
fi
[[ -x "$node_home/bin/node" ]] || {
  echo 'Run npm run test:linux -- --setup-runtime once to install the checksum-pinned Linux Node runtime.' >&2
  exit 1
}
export PATH="$node_home/bin:/usr/local/bin:/usr/bin:/bin"
export npm_config_cache="$runtime/npm-cache"
python3 -c 'import sys; assert sys.version_info.major == 3'

# The market-history lifecycle test executes the real Python collector with
# providers offline. Use the same pinned independent calendar as CI, rather than
# skipping the end-to-end test or relying on packages in the host interpreter.
calendar_home="$runtime/session-calendar-runtime"
calendar_requirements="$source_root/.github/scripts/session-calendar-requirements.txt"
calendar_digest=$(sha256sum "$calendar_requirements" | cut -d ' ' -f 1)
if [[ ! -x "$calendar_home/bin/python" || ! -f "$calendar_home/requirements.sha256" || $(cat "$calendar_home/requirements.sha256") != "$calendar_digest" ]]; then
  python3 -m venv "$calendar_home"
  "$calendar_home/bin/python" -m pip install -r "$calendar_requirements"
  printf '%s\n' "$calendar_digest" > "$calendar_home/requirements.sha256"
fi
export SESSION_CALENDAR_PYTHON="$calendar_home/bin/python"

# Use a native Linux filesystem: Windows mounts cannot reproduce POSIX modes.
# Include staged, unstaged and untracked source, so this checks current work.
task_root=$(mktemp -d /var/tmp/screener-tests.XXXXXXXX)
cleanup() {
  case "$task_root" in /var/tmp/screener-tests.*) rm -rf -- "$task_root" ;; esac
}
trap cleanup EXIT
git -c core.autocrlf=false clone --quiet --no-hardlinks "$source_root" "$task_root/repo"
snapshot_head=$(git -C "$task_root/repo" rev-parse HEAD)
git -C "$source_root" diff --binary "$snapshot_head" > "$task_root/current.patch"
if [[ -s "$task_root/current.patch" ]]; then
  git -C "$task_root/repo" apply "$task_root/current.patch"
fi
while IFS= read -r -d '' path; do
  mkdir -p "$task_root/repo/$(dirname "$path")"
  cp -P -- "$source_root/$path" "$task_root/repo/$path"
done < <(git -C "$source_root" ls-files --others --exclude-standard -z)
[[ $(git -C "$source_root" rev-parse HEAD) == "$snapshot_head" ]] || {
  echo 'Source HEAD changed while copying. Retry after the commit completes.' >&2
  exit 1
}
cd "$task_root/repo/frontend"
npm ci --no-audit --no-fund
npm run test:run -- "$@"
