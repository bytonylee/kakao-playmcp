#!/usr/bin/env bash
set -euo pipefail

root=${SECRET_SCAN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}
dot='.'
git_dir="${root}/${dot}git"
worktrees_dir="${root}/${dot}worktrees"
reports_dir="${root}/${dot}superpowers/sdd"
dotenv="${dot}env"
token_pattern='(?i)(sk-(?:proj-|live-|test-)?[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|glpat-[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,}|npm_[a-z0-9]{36}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|(?:rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'
pem_pattern='-----BEGIN (?:[A-Z0-9 ]+ )?(?:PRIVATE KEY|CERTIFICATE)-----'
service_assignment_pattern="(?i)[\"']?(DATA_GO_KR_SERVICE_KEY|SAFETY_KOREA_SERVICE_ID)[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9%+/_=-]{20,}"
found=0
files=()

while IFS= read -r -d '' file; do
  case "$file" in
    "$git_dir"/*|"$worktrees_dir"/*|*/node_modules/*|*/dist/*|*/coverage/*|"$reports_dir"/*-report.md)
      continue
      ;;
  esac
  files+=("$file")
done < <(find "$root" -type f -print0)

for file in "${files[@]}"; do
  case "${file##*/}" in
    "$dotenv"|"$dotenv".*)
      printf 'Secret scan failed: dotenv file present: %s\n' "${file#"$root"/}" >&2
      found=1
      ;;
  esac
done

for rule in "$token_pattern" "$pem_pattern" "$service_assignment_pattern"; do
  matches=$(printf '%s\0' "${files[@]}" | xargs -0 rg -l --pcre2 --binary-files=without-match "$rule" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    printf 'Secret scan failed: credential-like content found in:\n' >&2
    while IFS= read -r file; do
      printf '  %s\n' "${file#"$root"/}" >&2
    done <<< "$matches"
    found=1
  fi
done

if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for rule in "$token_pattern" "$pem_pattern" "$service_assignment_pattern"; do
    history_matches=$(
      while IFS= read -r revision; do
        git -C "$root" grep -I -l -P "$rule" "$revision" -- . 2>/dev/null || true
      done < <(git -C "$root" rev-list --all)
    )
    if [[ -n "$history_matches" ]]; then
      printf 'Secret scan failed: credential-like content found in Git history:\n%s\n' "$history_matches" >&2
      found=1
    fi
  done
fi

if (( found )); then
  exit 1
fi

printf 'Secret scan passed: Git history, tracked files, and working-tree files contain no credential-like values.\n'
