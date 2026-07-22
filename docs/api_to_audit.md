# APIs To Audit

Public surfaces shipped under an `experimental_` prefix. Each is functional
and covered by tests, but its contract has not soaked under real third-party
usage yet. Before renaming one to its stable name (a breaking rename — the
plugin SDK is pre-1.0, so minor bumps are breaking), audit it against the
questions listed with it, then remove it from this file in the same change.

## Plugin manifest

### `bb.branding.icon` plugin-owned SVG path

The existing compact-icon string also accepts a plugin-relative path beginning
with `./`, such as `./assets/icon.svg`. BB validates and hash-serves the SVG,
then renders it as a `currentColor` CSS mask across compact plugin chrome.
Older BB versions already accept the string and safely fall back to Zap. The
plugin inventory exposes the resolved URL as `experimental_iconUrl` while this
behavior soaks.

Audit before stabilizing:

- Do real third-party icons remain legible at every compact size and theme?
- Is a CSS mask sufficient, or do any valid icons need multicolor rendering?
- Should the stable inventory keep a separate `iconUrl`, or replace the name
  and URL fields with a discriminated icon source?
- Does the `./` path signal stay clear once more manifest assets exist?

## `@bb/plugin-sdk/app`

### `experimental_ThreadChat`

The host-owned chat component: given a `threadId`, renders bb's complete chat
surface (timeline, streaming, composer, drafts, send/queue/steer/stop,
attachments, execution controls, pending interactions, read tracking) anywhere
plugin React runs — nav panels, thread-panel tabs, homepage/settings sections.
Props: `threadId`, `variant: "full" | "compact" | "timeline"`,
`layout: "contained" | "document"`, `focusRequest`, `className`, plus
`leadingContent` (rendered above the conversation) and `messageActions`
(per-instance actions receiving a `ThreadChatMessageReference`).

Audit before stabilizing:

- Is the `variant`/`layout` split the right axis, or should presentation be a
  single mode enum once more consumers exist?
- Do `leadingContent`/`messageActions` stay, or migrate to slots once the
  side-chat plugin is no longer the only consumer?
- Does `focusRequest` (change-detected nonce) hold up, or should focus be an
  imperative handle?

### `experimental_Markdown`

The host-owned chat-message markdown renderer: `{ content, className? }`
rendered with exactly the timeline's typography, spacing, and code styling.
For plugin UI that quotes or previews message content (e.g. the side-chat
"Replying to" header) so it reads like the rest of the chat. Renderer options
beyond content/className (lightbox, link routing, thread mentions) are
deliberately host-internal.

Audit before stabilizing:

- Which renderer options genuinely need exposure (link routing came up first
  in ThreadChat's internal mention resolver)?
- Should it clamp/fade long content itself instead of every consumer
  reimplementing overflow handling?

### `app.slots.experimental_messageAction`

A plugin-contributed action on chat messages: an icon button in the
per-message action bar (user and assistant messages) and an entry in the
assistant text-selection menu. Registration `{ id, title, icon?, run }`;
`run(context)` receives `{ threadId, message: ThreadChatMessageReference,
selectedText?, openPanel({ actionId, title?, params? }) }`. Errors are
contained and logged. The side-chat plugin's "Reply in side chat" is the
reference consumer.

Audit before stabilizing:

- Should registrations support `roles` filtering like per-instance
  `ThreadChatMessageAction` already does?
- Is `openPanel`-only the right navigation affordance, or do actions also
  need `useBbNavigate`-style routing from `run`?
- Ordering/dedup policy when several plugins contribute actions.

### `threadPanelAction.layout` (registration field)

Not a new member, but new contract surface on an existing registration:
`layout?: "padded" | "flush"` controls how the host frames a panel tab —
`"padded"` (default) is the padded scroll container; `"flush"` hands the
component the full tab area (definite height, no padding or host
scrolling), which app-like content such as `experimental_ThreadChat` needs
to align with the main thread's composer baseline.

Audit before stabilizing: whether `layout` belongs on the registration (one
value per action) or on `openPanel` (per tab), and whether other slot kinds
(navPanel) need the same knob.

## `@bb/plugin-sdk`

### `bb.sdk.experimental_skills`

Backend plugins can list, inspect, install, remove, and write skills through
the same `SkillsArea` used by BB's first-party SDK. The plugin contract exposes
that area only as `bb.sdk.experimental_skills`; it deliberately omits the
stable first-party `BbSdk.skills` property so plugin authors cannot depend on
the experimental surface accidentally.

Audit before stabilizing:

- Should plugins receive the complete `SkillsArea`, or a narrower capability
  set based on declared permissions?
- Are install, delete, and write operations scoped tightly enough for
  third-party code?
- Do plugin consumers need provenance or manageability facts that the current
  list and file responses do not expose?
- Is `skills` the right stable name once real plugin consumers have exercised
  every operation?
