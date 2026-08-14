# Worker guide — bb-plugin-tasks

You are one of several agents building this plugin in a SHARED worktree on branch `bb/tasks-plugin`. Read this whole file before writing code.

## Design sources of truth

- Design decisions: the manager thread's storage `tasks-plugin-plan.md` (21 numbered decisions). Your prompt quotes what you need; when in doubt ask the manager thread, do not guess.
- Visual reference: `tasks-plugin-mock.html` in manager thread storage (Linear-like, bb-themed).
- Plugin platform contracts: `packages/plugin-sdk/src/backend-contract.ts` and
  `packages/plugin-sdk/src/app-contract.ts`.

## Ground rules

1. **Ownership**: touch ONLY the paths your prompt assigns. Others work in this tree concurrently. Never run repo-wide formatters. Never modify `pnpm-lock.yaml` unless your prompt explicitly assigns dependency changes.
2. **Git**: commit only your owned paths on `bb/tasks-plugin` when your checks are green, message prefixed `tasks plugin: `. Never push, never switch branches, never merge.
3. **UI rules** (for any frontend work):
   - Components: vendored shadcn from `components/ui/` (source of truth: `packages/plugin-registry/r`). Need one that isn't vendored yet? Copy it from the registry source, don't hand-roll.
   - Theme: bb tokens only (`bg-background`, `text-muted-foreground`, `border-border`, semantic `--success`/`--attention`/`--timeline-accent`/`--warning`/`--destructive` via their utilities). NO hex/oklch literals, no `text-[Npx]` (AGENTS.md).
   - Icons: **Hugeicons** (`@hugeicons/react` + `@hugeicons/core-free-icons`) — see `packages/shared-ui/src/components/ui/icon.tsx` for the pattern. No Lucide, no emoji.
   - Typography: text-sm is 13px here; match the app's density.
4. **Tests**: vitest in this package; plugin testing harness for backend (`@get-bb/plugin-sdk/testing`, see `server.test.ts`). High-value tests only; never mock sqlite (the harness gives a real one).
5. **Gates before you report done**:
   - `pnpm exec turbo run typecheck --filter=bb-plugin-tasks`
   - `pnpm exec turbo run test --filter=bb-plugin-tasks`
   - `pnpm exec turbo run build --filter=bb-plugin-tasks`
   - UI tasks: visual verification (below) with screenshots in your report.

## Dev instance + reload loop

A dev bb instance for THIS worktree is already running with the plugin installed (path install, `provenance: direct`):

- App: http://localhost:15943 — Server API: http://localhost:23943
- Plugin panel: http://localhost:15943/plugins/tasks/tasks
- CLI against the dev instance: `eval "$(scripts/bb-dev-app env)"` then `pnpm bb:dev tasks <subcommand>`.
- After changing plugin code: `pnpm exec turbo run build --filter=bb-plugin-tasks` then reload. NOTE: the `bb plugin reload` CLI hits the same pre-existing `displayName` validation bug as `plugin list` — reload via the API instead: `curl -s -X POST http://localhost:23943/api/v1/plugins/reload -H 'Content-Type: application/json' -d '{"id":"tasks"}'` (check the exact payload against `packages/server-contract` if it 400s; T3.2 used this route successfully).
- If the dev server itself died: `scripts/bb-dev-app status` / `scripts/bb-dev-app current`.

## Visual verification (UI tasks)

Use the `dev-browser` CLI (sandboxed Playwright):

```bash
dev-browser <<'EOF'
const page = await browser.getPage("worker-<your-task-id>");
await page.setViewportSize({width: 1280, height: 850});
await page.goto("http://localhost:15943/plugins/tasks/tasks");
await new Promise(r=>setTimeout(r,2000));
console.log(await saveScreenshot(await page.screenshot(), "<task>-light.png"));
EOF
```

Check light AND dark (toggle the app theme in Settings → Appearance, or `document.documentElement.classList` won't work here — use the real settings). Include screenshot paths in your report.

## Known gotchas

- `pnpm bb:dev plugin list` currently fails CLI response validation (pre-existing repo bug, missing `displayName`). Use `curl -s http://localhost:23943/api/v1/plugins` instead.
- Backend factory reloads must stay clean: never keep `bb` in module state; register everything inside the factory; `onDispose` for cleanup.
- RPC methods are the only bridge frontend→backend; the frontend cannot use `bb.sdk` (validate inputs server-side).

## Report format (end your thread with this)

Outcome · files changed · commands run + pass/fail · screenshots (UI) · deviations/blockers · commit hash.
