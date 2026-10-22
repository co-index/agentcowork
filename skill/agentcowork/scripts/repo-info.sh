#!/usr/bin/env sh
# Prints the current git repository as JSON for room_join's `repo` argument.
# Usage: repo-info.sh [path]   (defaults to the current directory)
set -eu
cd "${1:-.}"

if ! top=$(git rev-parse --show-toplevel 2>/dev/null); then
  echo '{"error":"not a git repository"}'
  exit 1
fi

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

remote=$(git remote get-url origin 2>/dev/null || true)
# Never leak credentials embedded in the remote URL.
remote=$(printf '%s' "$remote" | sed -E 's#(://)[^/@]+@#\1#')
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
head=$(git rev-parse --short HEAD 2>/dev/null || true)
name=$(basename "${remote:-$top}" .git)

printf '{"name":"%s","remote_url":"%s","branch":"%s","worktree":"%s","head_commit":"%s"}\n' \
  "$(json_escape "$name")" "$(json_escape "$remote")" "$(json_escape "$branch")" \
  "$(json_escape "$top")" "$(json_escape "$head")"
