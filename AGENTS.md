# Codebase Guidelines

## Simplicity First

- Solve the requested problem with the smallest correct change.
- Prefer deleting code, fields, branches, and surfaces over adding new ones.
- Keep code local until reuse is proven by real callers. A little duplication is better than a shared abstraction that bends callers together.
- Do not do broad cleanup, opportunistic refactors, or architecture rewrites unless they are required for the current change to be correct.
- Do not turn a local bug fix into a descriptor system, registry, lifecycle table, coordinator, queue, cache framework, package split, compatibility adapter, migration/backfill framework, or generalized pipeline.
- If adjacent debt is real but not required, mention it as follow-up instead of fixing it.
- When renaming a domain concept, search project-wide for stale names in variables, files, query keys, constants, tests, and docs. TypeScript only catches type references.

## Types And Contracts

- Validate and parse data at system boundaries, then pass typed values internally.
- Avoid `unknown` and `as X` casts inside the system. Use them only at genuinely unknowable boundaries such as freeform tool input, then narrow immediately.
- Keep one-off types near the code that uses them. Move types to a shared package only for a real cross-package contract.
- Optional contract fields are allowed only when omission has real semantic meaning. Do not use optional or nullable fields to hide defaults.
- If a field has a default, fill it in once at the server boundary and pass the explicit value through internal routes, commands, and persisted events.
- Accepted-but-ignored route or command fields are forbidden. Delete them or implement them end to end.
- Add or update route and command documentation only when behavior is non-obvious.

## Server And Daemon

- The server owns product policy: defaults, instructions, manager behavior, tool lists, and thread behavior.
- The host daemon owns host-local primitives, provider translation, runtime/session management, and workspace execution.
- If the server needs host-local data, the daemon should return raw data and the server should assemble product behavior.
- Do not move responsibility across the server/daemon boundary unless the current change requires it.

## Data Access

- Do not load all rows and filter in JavaScript when a targeted query with `WHERE` or `JOIN` is possible.
- Add indexes only when they are required by the new or changed query.
- Never mock the database in tests. Use in-memory SQLite via `createConnection(":memory:")` plus `migrate(db)`.

## UI

- Use existing shared primitives when they already fit. Do not create a new shared primitive from a single use.
- Avoid adding a second rendering path for the same concept. Remove an old path only when the current change directly replaces it.
- Prefer sanctioned typography tokens over arbitrary `text-[Npx]` classes.

## Build And Typecheck

- Always use Turbo: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Turbo ensures upstream `^build` dependencies run first.
- Typecheck with `pnpm exec turbo run typecheck --filter=@bb/<pkg>`.
- Do not run package scripts directly, such as `pnpm --filter @bb/foo test`, or raw `npx tsc --noEmit` unless you are deliberately bypassing repo orchestration for investigation.

## Testing

- Match validation to risk. Docs-only and fixture-text changes usually do not need behavior tests.
- Test real behavior and outcomes: resulting state, return values, persisted data, response bodies, and visible UI state.
- Mock only true external boundaries such as third-party network calls, timers, and provider APIs. Do not mock the module under test or its private methods.
- Bug fixes should usually include a regression test that would have failed before the fix. If a test is not practical, state why.
- Pipe slow test output to a file, then read the file. Example: `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/test-out.txt 2>&1`.

## Debugging And QA

- Do not assume. Inspect logs, query the database, call server APIs, or use the CLI to observe real state.
- Prefer server API, CLI, direct SQL queries, and log files over browser debugging except for browser-specific issues.
- `pnpm dev` prints the active frontend URL, server API URL, host daemon port, data dir, and logs dir. Do not assume fixed dev ports.
- The packaged app defaults to server/frontend `:38886`, host daemon `:38887`, data dir `~/.bb/`, and logs under `~/.bb/logs/`.
- Entity IDs in URLs (`proj_*`, `thr_*`) are primary keys. Query them directly against the active data dir: `sqlite3 <data>/bb.db "SELECT * FROM threads WHERE id = 'thr_xxx';"`.
- API routes are under `/api/v1/`, for example `GET /api/v1/threads/:id`.
- Use `curl` against the server API to isolate frontend issues from server behavior.
- Use the CLI to inspect state: `pnpm bb thread show <id>`, `pnpm bb project list`, `pnpm bb status`. From source, use `pnpm bb:dev`.

### Local Dev QA Launcher

Use `scripts/bb-dev-app` when validating changes in the desktop dev app or helping QA from this checkout:

- `scripts/bb-dev-app status` prints the active branch, dev URLs, data dir, and logs.
- `scripts/bb-dev-app current` restarts dev server and desktop on the current branch.
- `scripts/bb-dev-app main` fetches `origin/main`, fast-forwards `main`, and launches dev server and desktop from this checkout.
- `scripts/bb-dev-app branch <branch>` switches to a local branch, or creates it from `origin/<branch>`, then launches dev server and desktop.
- `scripts/bb-dev-app stop` stops the launcher-managed dev server and desktop.
- `scripts/bb-dev-app logs dev` and `scripts/bb-dev-app logs desktop` follow logs.

Branch switches intentionally keep dirty work in this checkout; git will stop if a local file would be overwritten. Set `BB_DEV_APP_STASH_DIRTY=1` for a one-off launch that stashes first.

For CLI QA against the dev instance, run `eval "$(scripts/bb-dev-app env)"` first. This sets `BB_SERVER_URL`, `BB_HOST_DAEMON_PORT`, and `BB_PROJECT_ID=proj_personal` so `pnpm bb:dev ...` does not accidentally target the packaged app.

Smoke-test agents with:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread spawn --project proj_personal --provider codex --permission-mode readonly --title "Smoke test" --prompt "Reply only with ok." --json
```

## Planning Workflow

- When asked to make a plan, create or update a Markdown file under `plans/`.
- Plans must include concrete exit criteria and validation instructions.
- Delete plan files once completed or superseded.
