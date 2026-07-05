# Codebase Guidelines

## Simplicity First

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

## CLI, Guide, And Skill

- When you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field), update its discoverable surfaces in the same change. See [docs/cli-guide-and-skill.md](docs/cli-guide-and-skill.md) for which surfaces to update.

## Data Access

- Do not load all rows and filter in JavaScript when a targeted query with `WHERE` or `JOIN` is possible.
- Add indexes only when they are required by the new or changed query.
- Never mock the database in tests. Use in-memory SQLite via `createConnection(":memory:")` plus `migrate(db)`.

## UI

- Prefer sanctioned typography tokens over arbitrary `text-[Npx]` classes.
- Derive theme color tokens from the `--canvas`/`--ink` anchors (`color-mix(in oklch, var(--ink) N%, var(--canvas))`) or from another derived token — never hand-set an `oklch(L 0 0)` literal. Achromatic literals don't follow custom palettes (Nord, Dracula, …), which re-anchor only `--canvas`/`--ink`, so a hardcoded token strands a neutral-gray element in an otherwise tinted UI. Mix opaque steps `in oklch`; mix translucent steps (a `transparent` pole) `in oklab` so the hue survives. `apps/app/src/components/ui/theme.css` is the source of truth and `theme.test.ts` guards it.

## Build And Typecheck

- Always use Turbo when building and typechecking: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Turbo ensures upstream `^build` dependencies run first.
- Typecheck with `pnpm exec turbo run typecheck --filter=@bb/<pkg>`.
- Do not run package scripts directly, such as `pnpm --filter @bb/foo test`, or raw `npx tsc --noEmit` unless you are deliberately bypassing repo orchestration for investigation.

## Testing

- Only write high quality tests that verify where there could be potential bugs. Avoid testing trivial getters/setters, framework wiring, or other code that is unlikely to break.
- Pipe slow test output to a file, then read the file. Example: `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/test-out.txt 2>&1`.

## Debugging And QA

- Do not assume. Inspect logs, query the database, call server APIs, or use the CLI to observe real state.
- See [docs/debugging-and-qa.md](docs/debugging-and-qa.md) for dev ports/data dirs, entity-ID lookups, and the `scripts/bb-dev-app` local dev QA launcher.
