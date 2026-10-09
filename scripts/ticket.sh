#!/usr/bin/env bash
# pnpm ticket <issue-number> <slug>: a worktree for the ticket beside the main checkout, at
# ../marginalia-<number> on a new branch <number>-<slug> from origin/main, with .env and dependencies,
# and Claude started in it on the ticket. Its tests get their own port and databases (test/worktree.ts).
set -euo pipefail

usage="usage: pnpm ticket <issue-number> <slug>"
n=${1:?$usage}
slug=${2:?$usage}
[[ $n =~ ^[0-9]+$ ]] || { echo "Not an issue number: $n" >&2; exit 1; }

# The main checkout, even when this runs from another worktree.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
dir="$(dirname "$main")/marginalia-$n"
branch="$n-$slug"

git -C "$main" fetch origin
# --no-track: the branch's upstream is set by its first push, never origin/main.
git -C "$main" worktree add --no-track -b "$branch" "$dir" origin/main

if [[ -f "$main/.env" ]]; then
  cp "$main/.env" "$dir/.env"
else
  echo "No .env in $main to copy; the worktree has none." >&2
fi

cd "$dir"
pnpm install
exec claude "/implement #$n"
