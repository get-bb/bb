# Codebase Guidelines

## Type Safety

- No `unknown`, no `as X` casts unless the type is genuinely unknowable (e.g., freeform tool input). Our boundaries validate and parse; everything inside the system is strongly typed.
- Never inline types in function signatures. Define them in the appropriate shared package.
- When renaming a domain type, search project-wide for the old name in variables, functions, files, query keys, and constants — not just type references. TypeScript only validates types; stale identifiers compile fine. Rename everything in the same commit.

## Code Quality

- Prefer maintainability and readability over speed. No one-off hacks — ask whether it would pass code review. We are never in a rush.
- Reuse before duplicating. If a pattern exists N times, extract a shared component or utility so consistency is structural, not aspirational. When fixing a bug, check whether the same pattern is repeated elsewhere.
- Leave the code better than you found it. When a change touches code with a weak abstraction, fix or improve it in the same change — don't add another caller to a pattern you wouldn't design today.
- Right-size the solution. Write the simplest thing that fully works; let abstraction, layers, and configurability arrive when a second real caller demands them. A single-use wrapper, a one-implementation interface, an options bag every caller fills identically, or config nobody sets is over-engineering — as much a defect as a hack. This pulls against "reuse before duplicating": prefer a little duplication over the wrong abstraction, and don't extract before the third occurrence. (Single-use options-object parameter types are the required call style, not bloat — see Type Safety.)
- No dead optionality. An optional parameter, field, or flag no caller ever sets to a non-default is dead configurability — delete it. The general form of "Accepted-but-ignored route or command fields are forbidden," applied to every function and component.
- Separate concerns. When a substantial concern is better handled by a well-known, battle-tested library, install and use it — but only when the dependency saves materially more than the lines it replaces.
- Prefer a single object argument over multiple positional arguments, especially when a function takes 3+ parameters of the same type.
- No inline dynamic imports unless for genuine performance reasons. If it's working around a circular dependency, fix the dependency graph instead.
- Never load all rows and filter in JS when a targeted query with WHERE/JOIN is possible. Use the indexes defined in the schema.

## UI Consistency

- Reuse shared primitives before introducing view-local class bundles (page shell, detail card/rows, collapsible headers, status pill).
- Avoid arbitrary `text-[Npx]` classes; prefer sanctioned typography tokens.
- Keep one canonical rendering path per concept; remove or deprecate parallel/legacy surfaces.

## Build and Typecheck

- Always use Turbo: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Turbo ensures upstream `^build` dependencies run first. Running package scripts directly (e.g., `pnpm --filter @bb/foo test`) or raw `npx tsc` skips these and will often fail with spurious module-not-found errors.
- Typecheck: `pnpm exec turbo run typecheck --filter=@bb/<pkg>`. Do not run `npx tsc --noEmit` directly — cross-package references require upstream builds.

## Testing

- Quality over quantity. Tests that pass when the package is broken are worse than no tests — they create false confidence. Every test should be able to catch a real bug.
- Test real behavior and outcomes — resulting state, return values, persisted data, response bodies. Not call sequences.
- Never mock the database. Use in-memory SQLite via `createConnection(":memory:")` + `migrate(db)`.
- Almost never mock our own code. Mock only at true external boundaries: network calls to third-party providers, timers, and similar unpredictable externals.
- Never mock the module under test or its private methods.
- Pipe slow test output to a file, then read the file. Never grep or tail inline on slow tests — if the pattern misses, you've wasted an entire run. Example: `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/test-out.txt 2>&1`, then read `/tmp/test-out.txt`.

## Debugging Tips

- Don't assume — instrument and observe. Add logging, read logs, inspect the database, repeat.
- Prefer server API, CLI, direct SQL queries, or log files over browser-based debugging. Use the browser only for browser-specific issues.

  | -           | Dev                                        | Prod           |
  | ----------- | ------------------------------------------ | -------------- |
  | Frontend    | printed by `pnpm dev`                      | `:38886`       |
  | Server API  | printed by `pnpm dev`                      | `:38886`       |
  | Host daemon | printed by `pnpm dev`                      | `:38887`       |
  | Data dir    | `~/.bb-dev/<checkout-instance>/`           | `~/.bb/`       |
  | Database    | `<data>/bb.db`                             | `<data>/bb.db` |
  | Logs        | `<data>/logs/`                             | `<data>/logs/` |

- `pnpm dev` derives deterministic high ports and the checkout-scoped data dir from the checkout path, then prints them at startup. The checkout instance id is the sanitized home-relative checkout path plus a short hash suffix. Do not assume the old flat dev ports.
- Entity IDs in URLs (`proj_*`, `thr_*`) are primary keys. Query them directly against the active data dir: `sqlite3 <data>/bb.db "SELECT * FROM threads WHERE id = 'thr_xxx';"`.
- API routes are under `/api/v1/` — e.g. `GET /api/v1/threads/:id`. `curl` the server directly to isolate frontend vs server bugs.
- Use the CLI to inspect state: `pnpm bb thread show <id>`, `pnpm bb project list`, `pnpm bb status`. From source: `pnpm bb:dev`.

### Local Dev QA Launcher

Use `scripts/bb-dev-app` when validating changes in the desktop dev app or
helping QA from this single checkout:

- `scripts/bb-dev-app status` prints the active branch, dev URLs, data dir, and
  logs.
- `scripts/bb-dev-app current` restarts dev server + desktop on the current
  branch.
- `scripts/bb-dev-app main` fetches `origin/main`, fast-forwards `main`, and
  launches dev server + desktop from this same checkout.
- `scripts/bb-dev-app branch <branch>` switches to a local branch, or creates
  it from `origin/<branch>`, then launches dev server + desktop.
- `scripts/bb-dev-app stop` stops the launcher-managed dev server and desktop.
- `scripts/bb-dev-app logs dev` and `scripts/bb-dev-app logs desktop` follow
  logs.

Branch switches intentionally keep dirty work in this single checkout; git will
stop if a local file would be overwritten. Set `BB_DEV_APP_STASH_DIRTY=1` for a
one-off launch that stashes first.

For CLI QA against the dev instance, run `eval "$(scripts/bb-dev-app env)"`
first. This sets `BB_SERVER_URL`, `BB_HOST_DAEMON_PORT`, and
`BB_PROJECT_ID=proj_personal` so `pnpm bb:dev ...` does not accidentally target
the packaged/prod app.

Smoke-test agents with:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread spawn --project proj_personal --provider codex --permission-mode readonly --title "Smoke test" --prompt "Reply only with ok." --no-context-parent-thread --json
```

## Contract Documentation

- Routes and commands that are self-evident from their name and type signature don't need comments. Add JSDoc only when the behavior is non-obvious — side effects, multi-step flows, guards, or context that the type signature doesn't convey.
- When adding a new route or command type with non-obvious behavior, add the documentation in the same commit.
- When changing a route's behavior, update any existing documentation to match.

## Contracts And Boundaries

- Optional contract fields are allowed only when leaving the field out has its own real semantic meaning. Do not use optional fields to hide defaults.
- Use `required + nullable` only when `null` has a distinct meaning such as “clear this value” or “unknown”. Do not use nullable as a stand-in for defaulting.
- If a field has a default, fill it in once at the server boundary, then pass an explicit value through internal routes, commands, and persisted events.
- Accepted-but-ignored route or command fields are forbidden. Delete them or implement them end to end in the same change.
- For new APIs and commands, answer “why is this optional?” during design and review.

## Async Lifecycle Ownership

- `status` fields represent current resource state only. Do not grow them into queue-state ladders like `requested`, `queued`, or `fetched`.
- Durable async lifecycles belong to server-owned lifecycle modules. Routes may request lifecycle work, but only lifecycle owners may advance it, mark it in progress, handle command results, or reconcile it after reconnect.
- Generic metadata update helpers must not accept lifecycle fields such as `status`, `stopRequestedAt`, `cleanupRequestedAt`, `cleanupMode`, or similar workflow state.
- Model lifecycle intent and progress explicitly. Do not rely on a resource `status` field alone to represent requested work, queued work, and recovery state.
- Commands are live host RPCs that succeed, fail, or time out; there is no persisted command queue. Durability lives in intent persisted on resource rows, recovered by the periodic sweeps in `apps/server/src/services/system/periodic-sweeps.ts` (`durable-intent-retry` and `orphan-cleanup` categories). Every new async lifecycle must define how it handles lost results from failed or timed-out RPCs, reconnect reconciliation, and idempotent repeated requests.

## Server And Daemon Ownership

- The server owns product policy: defaults, instructions, manager behavior, tool lists, and thread behavior.
- The host daemon owns host-local primitives, provider translation, runtime/session management, and workspace execution.
- If the server needs host-local data, the daemon should return the raw data and the server should assemble the final behavior.
- When changing a server/daemon boundary, ask “should this decision live on the server instead?”

## Reuse Discipline

- Do not add optional arguments just to support a new caller. First ask whether the new caller should share this code at all — a small, honest duplicate often beats a shared surface bent to fit two callers. If sharing is right, prefer a wrapper, a new object type, or a separate helper over an optional flag. Aim for the fewest clear surfaces, not the most reuse.

## Planning Workflow

- When asked to "make a plan", create or update a Markdown file under `plans/`.
- Plans must have clear exit criteria and concrete validation instructions.
- Delete plan files once completed or superseded.
