#!/usr/bin/env bash
# pnpm ticket:done <issue-number>: once the ticket's PR is merged, removes its worktree and local branch,
# drops its test databases and clears its e2e files. Refuses while the PR is unmerged or the worktree
# holds uncommitted work.
set -euo pipefail

n=${1:?usage: pnpm ticket:done <issue-number>}
[[ $n =~ ^[0-9]+$ ]] || { echo "Not an issue number: $n" >&2; exit 1; }

main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
dir="$(dirname "$main")/marginalia-$n"
[[ -d $dir ]] || { echo "No worktree at $dir" >&2; exit 1; }
branch=$(git -C "$dir" branch --show-current)

state=$(gh pr view "$branch" --json state --jq .state 2>/dev/null || echo "missing")
[[ $state == MERGED ]] || { echo "The PR for $branch is $state, not merged; leaving the worktree." >&2; exit 1; }

git -C "$main" worktree remove "$dir"
# -D: a squash merge leaves the branch's own commits off main.
git -C "$main" branch -D "$branch"

docker compose -f "$main/docker-compose.yml" exec -T db psql -U marginalia -d postgres -q \
  -c "DROP DATABASE IF EXISTS marginalia_e2e_$n WITH (FORCE)" \
  -c "DROP DATABASE IF EXISTS marginalia_test_$n WITH (FORCE)"

tmp=$(node -p 'require("os").tmpdir()')
rm -f "$tmp/marginalia-e2e-outbox-$n.jsonl" "$tmp/marginalia-e2e-catalog-$n.json"

echo "Removed $dir, its branch $branch and its test databases."
