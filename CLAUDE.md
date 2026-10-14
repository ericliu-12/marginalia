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

Before committing any UI change, run the e2e specs it touches, e.g. `pnpm e2e test/e2e/trail.spec.ts` (Playwright against a production build on port 3100 and its own seeded `marginalia_e2e` database, or in a ticket worktree port 4000+N and `marginalia_e2e_N` (`test/worktree.ts`); runs beside `pnpm dev` and other checkouts, no real API calls). The full suite runs on CI. Each UI ticket adds a thin e2e check for its main flow to `test/e2e/`, seeding what it needs through `test/e2e/database.ts`.

## Evals

After any change to the Enrichment or connection-judge prompts, or to the judge's call settings or input layout, run `pnpm eval` (`scripts/eval/judge-eval.ts`, the 19-book set against the stored baseline; scratch database, local `DATABASE_URL` only) and report quote validity, how many Connections quote Notes, and any explanations that got vaguer (read `scripts/eval/out/comparison.md`), before committing. The judge's answers vary from run to run, so the eval judges each input 3 times (`--runs N`) and flags a pair as possibly vaguer, or as changed in strength or type, only when a majority of runs agree; report each flag with its agreement (e.g. 2/3). It costs about $0.20 per run, about $0.60 by default, read from `paid_call`, and stops once spend reaches $1.50 (`--cap <usd>`). This is not an MVP ticket.

After any change to the Cluster naming prompt, its call settings or input layout, re-name the dev Clusters (local `DATABASE_URL`; clear `named_member_book_ids` so each is due, then run `nameClusters` with `claudeClusterNamer`, so the call still sees the old name; a few cents) and show the user each Cluster's Books, name and description before committing.

## Shipping

`main` auto-deploys to production on Railway, so it changes only by a merged PR: commit and push on a ticket branch, never on `main`.

1. Work on a branch named `<issue-number>-<short-slug>` (e.g. `46-reading-pace`). Cut a branch for `main` from an up-to-date `origin/main` (`git fetch origin` first), never from another feature branch: a squash merge carries every commit the branch holds. Before each commit, confirm `git branch --show-current` is that branch; commit there and push the branch.
2. Before opening a PR, run `pnpm test` in full and only the e2e specs relevant to the change; both pass. Don't run the full `pnpm e2e` locally: CI runs it. Run it locally only to debug when CI's browser tests fail. Then check that `git log origin/main..HEAD` lists only this ticket's commits (and merges of `origin/main`); anything else, stop and ask.
3. Open the PR with `gh pr create`: its body says `Closes #N`, summarises the change, names the e2e specs run locally, and lists what the user should test by hand (e.g. on their iPhone).
4. Wait for the user to say "merge it". Then check `gh pr checks <n>`: CI (`.github/workflows/ci.yml`) runs the tests and e2e on every PR, and the full e2e suite must be green there: the PR doesn't merge while any check is failing or pending. Once all are green, `gh pr merge --squash` and `git push origin --delete <branch>`. Not `--delete-branch`: in a ticket worktree it tries to check out `main`, which the main checkout holds, and fails; `pnpm ticket:done` deletes the local branch. Check with `railway logs --service web` and `railway logs --service worker` that both deploys succeeded before saying it's live. Railway links per directory, so in a ticket worktree run `railway link -p marginalia -e production` first.

Migrations are backward-compatible. The web service's pre-deploy runs them while the previous deploy is still serving and the worker restarts on its own, so the code already running must keep working on the migrated schema: add tables and columns freely, and drop or rename a column only in a later deploy, once no running code uses it.

## Parallel tickets

A ticket can run in its own worktree beside other work. When asked to work on a ticket in parallel, or to "start #N alongside", use the `parallel-ticket` skill: it checks for overlap and open blockers, then gives the command for the user to run in a new terminal.

- `pnpm ticket <n> <slug>` creates `../marginalia-<n>` on branch `<n>-<slug>` from `origin/main`, copies `.env`, installs, and starts `claude "/implement #<n>"` there. Its `pnpm test` and `pnpm e2e` use their own databases and port.
- `pnpm ticket:done <n>`, from the main checkout once the PR is merged, removes the worktree and its branch and drops its test databases.
- Before merging the second of two parallel PRs, "update from main": merge `origin/main` into its branch, rerun `pnpm test` and the relevant e2e specs, push.

## Sub-agents

You may use sub-agents when a skill calls for them (e.g. /code-review's parallel reviewers, /impeccable critique).
