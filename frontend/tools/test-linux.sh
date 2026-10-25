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

# Use a native Linux filesystem: Windows mounts cannot reproduce POSIX modes.
# Include staged, unstaged and untracked source, so this checks current work.
task_root=$(mktemp -d /var/tmp/screener-tests.XXXXXXXX)
cleanup() {
  case "$task_root" in /var/tmp/screener-tests.*) rm -rf -- "$task_root" ;; esac
}
trap cleanup EXIT
git -c core.autocrlf=false clone --quiet --no-hardlinks "$source_root" "$task_root/repo"
git -C "$source_root" diff --binary HEAD > "$task_root/current.patch"
if [[ -s "$task_root/current.patch" ]]; then
  git -C "$task_root/repo" apply "$task_root/current.patch"
fi
while IFS= read -r -d '' path; do
  mkdir -p "$task_root/repo/$(dirname "$path")"
  cp -P -- "$source_root/$path" "$task_root/repo/$path"
done < <(git -C "$source_root" ls-files --others --exclude-standard -z)
cd "$task_root/repo/frontend"
npm ci --no-audit --no-fund
npm run test:run -- "$@"
