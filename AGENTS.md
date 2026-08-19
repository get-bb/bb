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
- **Always increment `HOST_DAEMON_PROTOCOL_VERSION` when a change can alter anything sent between the server and host daemon.** This includes adding, removing, renaming, or changing the type, requiredness, default, or meaning of fields in session payloads, WebSocket messages, host RPC commands, or host RPC results. A shared TypeScript build passing is not evidence of wire compatibility: enrolled machines can still be running an older daemon. The version mismatch is what triggers their automatic update; without a bump, an old daemon may connect successfully and then enter an `invalid-message` reconnect loop. If compatibility with the previously shipped daemon has not been deliberately preserved and tested, bump the version.

## CLI, Guide, And Skill

- When you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field), update its discoverable surfaces in the same change. See [docs/cli-guide-and-skill.md](docs/cli-guide-and-skill.md) for which surfaces to update.
- Every end-user feature must also be usable by agents through both the SDK and the `bb` CLI; ship and document those surfaces in the same change as the UI.

## Plugin API

- Any new public plugin API member (a `@get-bb/plugin-sdk/app` export, an `app.slots.*` method, or a `BbPluginApi` property) ships with an `experimental_` name prefix and an entry in [docs/api_to_audit.md](docs/api_to_audit.md) describing what it does and what to audit before stabilizing. Dropping the prefix is the deliberate stabilization step: audit the entry, rename project-wide, and remove it from the doc in the same change.

## Data Access

- Do not load all rows and filter in JavaScript when a targeted query with `WHERE` or `JOIN` is possible.
- Add indexes only when they are required by the new or changed query.
- Do not manually edit Drizzle snapshot JSON. Change the schema, then regenerate migrations/snapshots with Drizzle so the snapshot chain stays consistent.
- Never mock the database in tests. Use in-memory SQLite via `createConnection(":memory:")` plus `migrate(db)`.

## UI

- Prefer sanctioned typography tokens over arbitrary `text-[Npx]` classes.
- Derive theme color tokens from the `--canvas`/`--ink` anchors (`color-mix(in oklch, var(--ink) N%, var(--canvas))`) or from another derived token — never hand-set an `oklch(L 0 0)` literal. Achromatic literals don't follow custom palettes (Nord, Dracula, …), which re-anchor only `--canvas`/`--ink`, so a hardcoded token strands a neutral-gray element in an otherwise tinted UI. Mix opaque steps `in oklch`; mix translucent steps (a `transparent` pole) `in oklab` so the hue survives. `apps/app/src/components/ui/theme.css` is the source of truth and `theme.test.ts` guards it.
- Never scope styles with the CSS `@scope` at-rule. WebKit resolves scope containment per element per scoped rule with no selector bucketing, so a rule set inside `@scope` costs `elements × rules` on every style recalculation. Measured on a 2,635-element page: one plugin's Tailwind utilities layer inside `@scope` took 306ms per recalculation, 7ms after rewriting to a `:where()` prefix, against a 6ms floor for the whole document. Blink shows none of it, so this is invisible in Chrome and dominant in Safari. To confine rules to a subtree, prefix each selector with a zero-specificity `:where(<roots>) ` arm plus a `:where(<roots>)` compound arm — `packages/plugin-build/src/scope-plugin-utilities.ts` does this for every plugin's compiled stylesheet and explains why both arms are required. When style recalculation is slow, bisect it: disable stylesheets one at a time and time `getComputedStyle` after invalidating a custom property on `:root`.
- Use the shared persistent responsive drawer for every compact slide-out menu, picker, popover, and dialog. Do not use modal drawer primitives that add `inert` or `aria-hidden` to the app root: iOS Safari can recalculate styles for the full app tree and stall the interaction. Start the drawer transform before heavy content, realize that content after two animation frames with a timeout fallback, and retain it after the first open. Verify representative drawers in iOS Simulator Safari and protect the app-root and deferred-realization behavior with tests.

## Build And Typecheck

- Always use Turbo when building and typechecking: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Turbo ensures upstream `^build` dependencies run first.
- Typecheck with `pnpm exec turbo run typecheck --filter=@bb/<pkg>`.
- Do not run package scripts directly, such as `pnpm --filter @bb/foo test`, or raw `npx tsc --noEmit` unless you are deliberately bypassing repo orchestration for investigation.
- Generated modules are not committed: `packages/templates/src/generated/`, `packages/plugin-build/src/generated/`, and `packages/plugin-sdk/bundled-types/` are gitignored. Turbo tasks (`@bb/templates#generate:*`, `@bb/plugin-build#generate`, `@get-bb/plugin-sdk#build:types`) produce them before every dependent build, typecheck, and test task, and `pnpm install` runs the cheap ones. If your editor cannot resolve `@get-bb/plugin-sdk` inside a plugin, run `pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk` once. Never commit a generated module and never add a `--check` mode for one; when you add a generated module, add a turbo task with explicit `inputs`/`outputs` and edges from its consumers.

## Testing

- Only write high quality tests that verify where there could be potential bugs. Avoid testing trivial getters/setters, framework wiring, or other code that is unlikely to break.
- Pipe slow test output to a file, then read the file. Example: `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/test-out.txt 2>&1`.

## GitHub Issues And Pull Requests

- Follow [docs/filing-issues.md](docs/filing-issues.md) when you file an issue. Reproduce first; give versions, minimal copy-pasteable steps, expected vs actual output pasted verbatim, evidence with commit permalinks, and what you ruled out. Use the issue form's sections. Do not file from a single symptom or log line, and do not open a duplicate — add evidence to the existing issue instead.
- Follow `.github/PULL_REQUEST_TEMPLATE.md` when you open a pull request: what was wrong (root cause), what changed, how you verified (tests that fail before and pass after), `Fixes #N`.
- When an agent creates a GitHub issue or pull request, add this line at the end of the body:

  ```
  > AGENT GENERATED: by <model>
  ```

- Replace `<model>` with the name of the model that writes the text, for example `Claude Opus 5`.
- Add this line to each new issue and pull request. It shows the readers that an agent made the content.

## Debugging And QA

- Do not assume. Inspect logs, query the database, call server APIs, or use the CLI to observe real state.
- See [docs/debugging-and-qa.md](docs/debugging-and-qa.md) for dev ports/data dirs, entity-ID lookups, and the `scripts/bb-dev-app` local dev QA launcher.
