## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`ericliu-12/marginalia`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Design

Any work that creates or changes UI uses the `impeccable` skill.

- Run `/impeccable shape` on a surface before building it. Use its prototype branch as input where one exists: `prototype/graph-view` (variant D) for the graph view, `prototype/mobile-capture` for mobile capture.
- The desktop library view and the Book panel have no prototype and need shaping from scratch.
- Follow `DESIGN.md`.
- Finish each UI ticket with `/impeccable critique`, `audit`, and `polish`.

## Browser tests

Before committing any UI change, run `pnpm e2e` (Playwright against a production build on port 3100 and its own seeded `marginalia_e2e` database, or in a ticket worktree port 4000+N and `marginalia_e2e_N` (`test/worktree.ts`); runs beside `pnpm dev` and other checkouts, no real API calls). Each UI ticket adds a thin e2e check for its main flow to `test/e2e/`, seeding what it needs through `test/e2e/database.ts`.

## Evals

After any change to the Enrichment or connection-judge prompts, or to the judge's call settings or input layout, run `pnpm eval` (`scripts/eval/judge-eval.ts`, the 19-book set against the stored baseline; about $0.20, scratch database, local `DATABASE_URL` only) and report quote validity, how many Connections quote Notes, and any explanations that got vaguer (read `scripts/eval/out/comparison.md`), before committing. This is not an MVP ticket.

After any change to the Cluster naming prompt, its call settings or input layout, re-name the dev Clusters (local `DATABASE_URL`; clear `named_member_book_ids` so each is due, then run `nameClusters` with `claudeClusterNamer`, so the call still sees the old name; a few cents) and show the user each Cluster's Books, name and description before committing.

## Shipping

`main` auto-deploys to production on Railway, so it changes only by a merged PR: commit and push on a ticket branch, never on `main`.

1. Work on a branch named `<issue-number>-<short-slug>` (e.g. `46-reading-pace`). Before each commit, confirm `git branch --show-current` is that branch; commit there and push the branch.
2. Before opening a PR, run `pnpm test` and `pnpm e2e`; both pass in full.
3. Open the PR with `gh pr create`: its body says `Closes #N`, summarises the change, and lists what the user should test by hand (e.g. on their iPhone).
4. Wait for the user to say "merge it". Then `gh pr merge --squash --delete-branch`, and check with `railway logs` that the deploy succeeded before saying it's live.

Migrations are backward-compatible. The web service's pre-deploy runs them while the previous deploy is still serving and the worker restarts on its own, so the code already running must keep working on the migrated schema: add tables and columns freely, and drop or rename a column only in a later deploy, once no running code uses it.

## Parallel tickets

A ticket can run in its own worktree beside other work. When asked to work on a ticket in parallel, or to "start #N alongside", use the `parallel-ticket` skill: it checks for overlap and open blockers, then gives the command for the user to run in a new terminal.

- `pnpm ticket <n> <slug>` creates `../marginalia-<n>` on branch `<n>-<slug>` from `origin/main`, copies `.env`, installs, and starts `claude "/implement #<n>"` there. Its `pnpm test` and `pnpm e2e` use their own databases and port.
- `pnpm ticket:done <n>`, from the main checkout once the PR is merged, removes the worktree and its branch and drops its test databases.
- Before merging the second of two parallel PRs, "update from main": merge `origin/main` into its branch, rerun `pnpm test` and `pnpm e2e`, push.

## Sub-agents

You may use sub-agents when a skill calls for them (e.g. /code-review's parallel reviewers, /impeccable critique).
