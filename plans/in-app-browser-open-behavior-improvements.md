# In-App Browser Open Behavior Improvements

## Goal

Make bb desktop open ordinary web links from more UI surfaces in the visible
in-app browser by default, while letting users bypass selected URLs to their OS
default browser with regex rules.

This plan is only about opening links and browser-tab UX. Browser automation and
CLI-driven app control are split across `plans/bb-browser.md`,
`plans/bb-terminal.md`, and `plans/bb-settings.md`.

## Current State

- `apps/app/src/lib/in-app-browser-link-preference.ts` stores the boolean
  `bb.openLinksInAppBrowser` preference and routes http/https URLs when the
  desktop browser bridge is available.
- `apps/app/src/views/thread-detail/ThreadDetailView.tsx` already passes
  `handleOpenTimelineLink` through timeline rows and markdown file previews.
- `apps/app/src/components/thread/terminal/ThreadTerminalView.tsx` handles
  xterm web links by calling `window.open(...)`, which falls back to the OS
  browser in the desktop shell.
- `apps/app/src/components/thread/timeline/TerminalOutputBlock.tsx` renders
  command output as escaped ANSI HTML and does not linkify URLs.
- `apps/desktop/src/desktop-browser-view.ts` hosts the in-app browser in an
  isolated `WebContentsView`; it already allows only http/https top-level
  navigation, redirects popups into in-panel tabs, denies permissions/downloads,
  and blocks loopback/LAN requests.
- Desktop browser IPC request schemas in
  `packages/server-contract/src/api-types.ts` are explicitly wire-frozen for
  desktop/server version skew. Link-routing preferences should stay in the SPA
  rather than expanding those IPC payloads.

## Recommendation

Keep URL-routing policy in the SPA. The renderer already owns secondary-panel
browser tabs, and default link behavior already falls through to the shell's
external-open path. Do not change desktop browser attach/navigate IPC shapes for
this feature.

## Phase 1 - Shared Link Routing Preference

Scope:

- Rename `ChatLinkOpenTarget` and `resolveChatLinkOpenTarget` to names that
  reflect all web-link surfaces, such as `WebLinkOpenTarget` and
  `resolveInAppBrowserLinkOpenTarget`.
- Search project-wide for stale `ChatLink` names in variables, tests, comments,
  and import names.
- Add a persisted bypass setting:
  - existing boolean: `bb.openLinksInAppBrowser`
  - new regex text or string list: `bb.openLinksInAppBrowserBypassRegexes`
- Add pure helpers in `apps/app/src/lib/in-app-browser-link-preference.ts`:
  - parse one regex per non-empty line
  - report invalid regexes for the settings UI
  - route to `"default"` when any valid regex matches the full URL string
  - continue routing only http/https URLs to the in-app browser
- Update `InAppBrowserLinkSettingsSection` copy from "from chat" to "from bb".
- Add a compact settings control for bypass regexes, with inline validation for
  invalid patterns.

Exit criteria:

- Existing markdown timeline/file-preview links still open in the in-app browser
  when enabled.
- A URL matching a bypass regex falls through to default browser behavior.
- Invalid regex input is visible to the user and does not crash routing.
- Non-http URLs are never routed into the in-app browser.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- in-app-browser-link-preference`
- `pnpm exec turbo run test --filter=@bb/app -- AppSettingsView`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 2 - Wire Missing URL Surfaces

Scope:

- Pass the shared timeline link handler from `ThreadDetailView` into:
  - `ThreadTerminalPanel`
  - `ThreadTerminalContent`
  - `ThreadTerminalView`
- Change the xterm web-links handler to call the shared handler first, then
  fall back to `window.open(...)` when routing returns false.
- Add linkification to `TerminalOutputBlock` for command-output timeline rows.
  Prefer a small, established HTML/text linkification library over a custom
  regex that must understand ANSI-generated HTML. Keep validation restricted to
  http/https URLs.
- Use click delegation on rendered terminal output anchors so the same shared
  routing function can open matching links in the in-app browser or fall back to
  default browser behavior.
- Audit remaining direct `window.open` / `target="_blank"` surfaces and decide
  explicitly whether each belongs in this feature. Likely candidates:
  `ConversationAttachments`, model-load error links, and internal replay links.

Exit criteria:

- Live terminal links route through the in-app browser when enabled and not
  bypassed.
- Timeline command-output URLs are clickable and use the same routing rules.
- Existing ANSI colors and terminal output escaping still work.
- Default browser fallback still works for bypassed URLs and web builds.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- ThreadTerminalView`
- `pnpm exec turbo run test --filter=@bb/app -- TerminalOutputBlock`
- `pnpm exec turbo run test --filter=@bb/app -- ThreadTerminalPanel`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 3 - Desktop QA

Scope:

- Use `scripts/bb-dev-app current` to launch the desktop dev app.
- Open a thread with:
  - assistant markdown containing `https://example.com`
  - command output containing `https://example.com`
  - terminal output containing `https://example.com`
- Test both settings states:
  - no bypass: opens an in-panel browser tab
  - bypass regex such as `^https://example\.com`: opens the OS default browser
- Confirm popups from in-app browser pages still open as in-panel tabs and the
  LAN/loopback firewall remains unchanged.

Exit criteria:

- The same URL-routing behavior is visible in chat, command-output timeline
  rows, live terminals, and markdown file previews.
- The bypass list affects all routed surfaces consistently.
- No desktop IPC schema changes were needed.

Validation:

- `pnpm exec turbo run test --filter=@bb/desktop`
- `pnpm exec turbo run typecheck --filter=@bb/desktop`
- Manual desktop smoke test through `scripts/bb-dev-app current`

## Open Questions

- Should bypass regexes match the full href string, hostname only, or both? The
  simplest and most transparent choice is full href string.
- Should bypass rules be global user preferences or project-scoped? Existing
  link routing is global, so start global.
- Should command-output linkification include bare domains like `example.com`,
  or only explicit `http://` / `https://` links? For consistency with current
  browser policy, start with explicit http/https only.
