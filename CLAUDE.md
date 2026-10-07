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

Before committing any UI change, run `pnpm e2e` (Playwright against a production build on port 3100 and its own seeded `marginalia_e2e` database; runs beside `pnpm dev`, no real API calls). Each UI ticket adds a thin e2e check for its main flow to `test/e2e/`, seeding what it needs through `test/e2e/database.ts`.

## Evals

After any change to the Enrichment or connection-judge prompts, or to the judge's call settings or input layout, run `pnpm eval` (`scripts/eval/judge-eval.ts`, the 19-book set against the stored baseline; about $0.20, scratch database, local `DATABASE_URL` only) and report quote validity, how many Connections quote Notes, and any explanations that got vaguer (read `scripts/eval/out/comparison.md`), before committing. This is not an MVP ticket.

## Git

Before any commit, check the current branch (`git branch --show-current`) and confirm it's the intended one.

## Sub-agents

You may use sub-agents when a skill calls for them (e.g. /code-review's parallel reviewers, /impeccable critique).
