# bb Settings

## Goal

Add `bb settings ...` CLI commands so users and agents can inspect and update
scriptable bb app preferences.

Start with in-app browser link settings, then expand to other app preferences
that should be controllable from the CLI.

Related plans:

- `plans/in-app-browser-open-behavior-improvements.md` defines the browser link
  settings that should become scriptable.
- `plans/bb-browser.md` and `plans/bb-terminal.md` use settings and visibility
  conventions that should be inspectable from CLI.

## Current State

- Several app preferences live in app browser storage/localStorage through
  Jotai atoms, including `bb.openLinksInAppBrowser`.
- CLI access to localStorage-only settings is not practical because the CLI
  talks to the server, not the user's renderer process.
- The settings view is implemented in `apps/app/src/views/AppSettingsView.tsx`.
- There is no `bb settings ...` command group today.

## Recommendation

Move scriptable settings to a server-backed or desktop-mediated settings model
before exposing them through CLI. Do not build a CLI that tries to edit renderer
localStorage directly.

For settings that affect browser-only UI, prefer server-backed settings plus
realtime updates to the renderer. A desktop-mediated bridge is acceptable only
for truly desktop-local preferences that cannot be represented server-side.

## Command Shape

Start with:

```bash
bb settings list --json
bb settings get openLinksInAppBrowser --json
bb settings set openLinksInAppBrowser true
bb settings get openLinksInAppBrowserBypassRegexes --json
bb settings set openLinksInAppBrowserBypassRegexes '^https://example\.com'
```

Potential later commands:

```bash
bb settings reset openLinksInAppBrowser
bb settings describe openLinksInAppBrowser --json
```

## Phase 1 - Settings Model

Scope:

- Define a typed settings registry with:
  - setting key
  - value schema
  - default value
  - scope (`user`, `project`, or `thread`) if needed
  - whether CLI writes are allowed
- Start with user-level settings:
  - `openLinksInAppBrowser`
  - `openLinksInAppBrowserBypassRegexes`
- Decide persistence:
  - server-backed database/settings table
  - JSON file under data dir
  - desktop-mediated local settings store
- Prefer server/data-dir persistence so CLI, app, and agents share the same
  source of truth.

Exit criteria:

- Settings have one canonical storage path.
- Existing app settings can migrate from localStorage without losing user values
  when feasible.
- Settings schema rejects invalid types and validates regex rules.

Validation:

- `pnpm exec turbo run test --filter=@bb/domain`
- `pnpm exec turbo run test --filter=@bb/server-contract`

## Phase 2 - Server Settings API

Scope:

- Add typed routes for:
  - list settings
  - get setting
  - set setting
  - reset setting if included in v1
- Validate setting keys through the registry.
- Reject invalid values with useful error messages.
- Broadcast setting changes through existing realtime infrastructure so app UI
  updates without restart.

Exit criteria:

- Server API can read/write scriptable settings.
- Invalid keys and invalid values are rejected.
- App clients can subscribe or refetch on settings changes.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- settings`
- `pnpm exec turbo run typecheck --filter=@bb/server`

## Phase 3 - App Settings Migration

Scope:

- Update `AppSettingsView` to read/write settings through the new settings API
  for scriptable settings.
- Migrate existing `bb.openLinksInAppBrowser` localStorage value on first load
  if it exists.
- Keep non-scriptable purely-local preferences on their existing storage until
  they are added to the settings registry.
- Ensure invalid regex settings render visibly and do not crash routing.

Exit criteria:

- Desktop UI reflects CLI setting changes without restart.
- Existing local setting values migrate or are handled intentionally.
- Browser link routing uses the new canonical settings source.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- AppSettingsView`
- `pnpm exec turbo run test --filter=@bb/app -- in-app-browser-link-preference`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 4 - CLI Commands

Scope:

- Add `apps/cli/src/commands/settings.ts`.
- Register it in `apps/cli/src/index.ts`.
- Support `--json` for list/get/set.
- Print setting descriptions and current values in non-JSON mode.
- Ensure shell values are parsed predictably:
  - booleans as `true`/`false`
  - strings as raw CLI strings
  - arrays either as repeated flags or JSON input if needed

Exit criteria:

- CLI can read and update browser link-routing settings.
- Invalid regex settings are rejected or stored with explicit invalid-state
  metadata; they are never silently accepted and ignored.
- `bb settings list --json` exposes enough metadata for agents to choose valid
  keys and values.

Validation:

- `pnpm exec turbo run test --filter=@bb/cli -- settings`
- `pnpm exec turbo run typecheck --filter=@bb/cli`

## Phase 5 - Built-In Skill Update

Scope:

- Teach agents to use `bb settings ...` for scriptable app preferences.
- Include examples for in-app browser link behavior:
  - enabling/disabling in-app browser link routing
  - setting bypass regexes
  - reading current values before changing them
- Tell agents to avoid editing config files or localStorage directly.

Exit criteria:

- Agents can discover settings through CLI instead of guessing storage paths.
- Skill examples match implemented commands.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- injected-skills`

## Open Questions

- Should scriptable settings be user-scoped only in v1, or should project/thread
  scopes ship immediately?
- Should regex settings reject invalid regexes at write time, or store invalid
  text and report invalid state in the UI?
- Which existing localStorage preferences are worth migrating with this change?
