#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT

git -C "$fixture_root" init --quiet
printf '"DATA_GO_KR_SERVICE_KEY": "%s"\n' "$(printf 'A%.0s' {1..24})" > "$fixture_root/config.json"
git -C "$fixture_root" add config.json
git -C "$fixture_root" -c user.name=test -c user.email=test@example.com commit --quiet -m fixture

if SECRET_SCAN_ROOT="$fixture_root" "$repo_root/scripts/verify-no-secrets.sh" >/dev/null 2>&1; then
  printf 'Secret scan regression failed: quoted JSON credential was not detected.\n' >&2
  exit 1
fi

printf 'Secret scan regression passed.\n'
