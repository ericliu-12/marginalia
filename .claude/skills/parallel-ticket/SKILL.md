---
name: parallel-ticket
description: Checks whether a ticket can start in its own worktree beside the work in progress, and gives the command to start it. Use when asked to work on a ticket in parallel, or to "start #N alongside".
---

The user wants ticket #N started beside work already in progress. Decide whether it is safe, and if so, give them the command. This session only advises; the ticket runs in a separate terminal.

## 1. Map the work in progress

Run `gh pr list` and `git worktree list`. Each ticket worktree is `../marginalia-<n>` on branch `<n>-<slug>`; the main checkout's own branch counts too, if it isn't `main`. Every open PR and every ticket worktree is a ticket in progress.

Done when you have the list of in-progress ticket numbers.

## 2. Check the blockers

Read #N with `gh issue view N --comments`. Its `## Blocked by` section lists issue numbers; check each with `gh issue view <b> --json state`. Every blocker must be closed. An open one ends the check: name it and stop.

## 3. Judge the overlap

Read each in-progress ticket the same way, and for those with a PR, its changed files (`gh pr diff <pr> --name-only`). For #N, predict the files it will touch: find the modules, routes, components, schema and tests its "What to build" names, by searching the code.

Overlap is any file both would change, and these shared hot spots in particular:

- `src/db/schema.ts` and `drizzle/`: two tickets that both add migrations collide on the migration journal and numbering.
- shared UI shells and layouts, `DESIGN.md`, `CONTEXT.md`
- `package.json` and `pnpm-lock.yaml`

Done when every in-progress ticket has a verdict: no overlap, or the named files it shares with #N.

## 4. Answer

**Overlap or open blocker**: say which files or blockers, and recommend waiting for that PR to merge, or a different `ready-for-agent` ticket that clears the check.

**Safe**: give the command to run in a new terminal, from the main checkout:

```
pnpm ticket <N> <slug>
```

The slug is two to four lowercase words from the ticket's title, joined by hyphens. Then remind them:

- before merging the second of two parallel PRs, ask its session to "update from main" (merge `origin/main` into the branch, rerun `pnpm test` and `pnpm e2e`, push)
- after its PR merges, run `pnpm ticket:done <N>` from the main checkout
