# Frontend hooks, composer, and UI

Hooks:

- `useSdk()` → bb's public API client bound to your plugin: the same areas
  the `bb` CLI and the backend `bb.sdk` expose (`threads`, `threadSections`,
  `projects`, `environments`, `hosts`, `files`, …), running with the
  signed-in user's session on the app origin. The first choice for reading
  and mutating bb state from a frontend: `sdk.threadSections.create({ name })`,
  `sdk.threads.update({ id, sectionId })`, `sdk.threads.pin({ id })`,
  `sdk.threads.spawn(request)`. `spawn` and `fork` stamp your plugin as the
  origin and the plugin-metadata calls default `pluginId`, exactly like the
  backend client. Thread title, section, and parent updates are optimistic in
  bb's own surfaces, and synchronous calls are applied in one cache transaction;
  other writes refresh over realtime. Use
  `experimental_useSidebarThreadActions()` for optimistic pin, read state,
  rename, and archive actions. The client is stable, so it is safe in dependency
  lists. Test with `renderSlot({ sdk: { threads: { update: async () => ({ … }) }
} } })` and read `inspection.sdkCalls`.
- `useRpc<typeof rpcContract>()` → `{ call(method, input?) }` — exact method,
  input, and result inference from a type-only backend contract import.
  Reach for it when the work needs your server: secrets, host files, or your
  plugin's own storage.
- `useRealtime(channel, handler)` — fires for this plugin's
  `bb.realtime.publish(channel, …)` signals while mounted.
- `useRealtimeConnectionState()` — returns `"connecting"`, `"connected"`, or
  `"reconnecting"` for the same shared socket used by `useRealtime`. Reconcile
  durable server state on subsequent transitions to `connected` (not the first
  connection) because plugin signals are ephemeral and are not replayed.
- `useSettings()` → `{ values, isLoading }` — effective non-secret values
  (secret settings are excluded; read them server-side only).
- `useBbContext()` → `{ projectId, threadId }` from the current route.
- `experimental_usePluginId()` → this plugin's id, the same value as the
  server's `bb.pluginId`. Key anything kept outside bb's plugin storage with
  it (localStorage entries, log prefixes) so a copy published under another
  package name does not share the original's state. `renderSlot` returns its
  `pluginId` option, `test-plugin` by default.
- `experimental_useQuestionFormHost()` → `{ shortcuts, registerChoiceHandler }`
  inside a `pendingInteraction` component: the host-owned answer shortcuts by
  zero-based option index, and a way to act when the person presses one. The
  registry's `question-form` item uses it. Empty outside a pending interaction
  and in `renderSlot`.
- `useBbNavigate()` → `{ toThread(id), toProject(id), toPluginPanel(path,
{ subPath?, replace? }?), toCompose({ initialPrompt?, focusPrompt? }?),
openThreadPanel({ actionId, title?, params? }), openUrl(url),
experimental_openFilePreview(options), experimental_openFileExternally(options) }`.
  `toCompose` opens the root compose screen; pass `initialPrompt` to seed the
  composer draft and `focusPrompt: true` to focus it. The panel
  opener opens one of the current plugin's registered `threadPanelAction` tabs
  in the current thread surface and returns whether the host accepted it; it
  returns false on surfaces without a thread side panel.
  `openUrl` owns HTTP(S) only and returns false for schemes BB
  leaves to normal anchor behavior. The two file methods accept an
  `ExperimentalFileOpenOptions` live-file target.
- `useComposer()` → one stable handle for the composer the calling surface
  belongs to: inside a composer slot, that composer; in a thread's panels,
  that thread's composer; elsewhere, the current route's draft. The same
  composer returns the same object across renders and its methods always act
  on the current draft, so keep it in effects, callbacks and async work
  directly (no `useRef` copy). Its reactive fields re-render the component
  when they change; depend on those fields, not on the handle, in memo
  dependency lists.
  - State: `scope` (`thread`, `queued-message`, or `new-thread`, with that
    surface's identifiers), `key` (stable identity for the composer's draft:
    the same across remounts and reloads, per editing session for queued and
    sent-message editors), `layout`
    (`"expanded" | "compact"`), `isRunning`, `isSubmitting`,
    `isSubmittingBlocked` and `submittingBlockedReason` (the same decision
    and message bb's send button shows: empty draft, uploads in progress,
    loading, a missing selection or setup, a pending interaction, voice
    input), `isEmpty`, and `attachmentCount`.
  - Content: `text` is the plain text; `draft` is an immutable `{ text, mentions, attachments }` snapshot where
    each `ComposerMention` carries its range and everything needed to
    recreate the pill (`kind` thread, project, section, path, command, or
    plugin with `pluginId`, `provider` and `id`).
  - Selection: `selection` is the current picker snapshot and updates reactively
    when the user or `setSelection` changes it. It contains the provider, model,
    reasoning level, service tier, and permission mode where available, plus
    project and environment in a new-thread composer. Queued-message and
    sent-message editors report their read-only pickers: the thread's provider
    with the queued message's or the thread composer's settings. Missing keys
    mean the corresponding picker has no selected value; `null` means this
    composer has no pickers. Use `isSubmittingBlocked` for submission readiness.
  - Editing: `insert(parts, { at?, block? })` inserts text and pills at the
    current selection (default) or at `"end"`; `block: true` places the content
    on its own paragraph. `replace(next)` atomically sets text and mentions;
    `replace(current => next)` transforms the latest complete draft. Mention
    ranges must explicitly match the result: replacement does not reconcile
    them automatically. Omit attachments to preserve them, or provide a list
    (including `[]`) to replace them. The updater is synchronous; invalid
    results and throws leave the draft unchanged. Returning `current` is a no-op.
  - `focus()` focuses the caret. `setTextEffect({ className })` paints the
    draft (`null` clears); `setInputLock(locked)` makes the editor read-only
    and auto-releases when the slot unmounts or changes scope.
  - Save `composer.draft`, then restore it with `composer.replace(saved)`.
    For an LLM rewrite, map preserved mention placeholders to explicit ranges
    in the resulting text and replace text and mentions together.
  - `setText`, `updateText`, `clear`, `addQuote`, `insertMention`, and
    `removeMention` are runtime-only compatibility methods and are absent
    from published types. Use `insert` or `replace` in new code. Legacy text
    setters retain automatic mention reconciliation; legacy `insertMention` retains its bare-label formatting.
  - `submit({ sendAt? , experimental_data? })` submits exactly as pressing
    Enter would (send, or queue while the thread is busy). It waits for
    uploads in progress, then rejects with `submittingBlockedReason` when the
    send button would refuse. `experimental_data` reaches dispatch hooks on
    the initial attempt, namespaced with your plugin id. The queued-message
    and sent-message editors reject.
  - `setSelection({ projectId?, environment?, providerId?, model?,
reasoningLevel?, serviceTier?, permissionMode? })` sets the pickers as if
    picked by hand and resolves with the settled selection; omitted fields keep
    their current values. It rejects in a
    queued-message editor. `onSubmitted(listener)` observes successful local
    submissions.
  - Lifetime: a handle writes to its own composer's draft. Thread and
    new-thread drafts persist, so writes after the composer leaves the screen
    still land there. Once a queued-message or sent-message editor closes,
    `insert`, `replace`, `submit` and `setSelection` throw and the older
    text methods warn and do nothing.
  - Deprecated, still working for plugins built against older SDKs but gone
    from the types: `useComposerView()` (use `useComposer()`), the
    `experimental_submit`, `experimental_setSelection`,
    `experimental_onSubmitted` and `experimental_removeMention` names, and
    `richText.onDraftChange` (read `draft` instead).
- `useComposers()` → a handle for every composer on screen that composer
  customizations mount in (thread page, `ThreadChat`, new-thread, open
  queued-message editors), oldest first. Use it from a panel or page that
  writes into a composer the user picks: label each by `scope`, then call
  `insert`, `focus` or `submit` on the chosen one. Handles are the same
  `PluginComposerApi` with the same lifetime rule; `setTextEffect` and
  `setInputLock` have no effect here. Re-renders when the list or a listed
  draft or selection changes.
- `experimental_useCodeTheme()` → `{ mode, name, theme }` — the code theme bb
  is currently rendering with. `mode` is `"light" | "dark"`, `name` is the
  registered theme name for that mode, and `theme` is the resolved **VS Code
  theme document** behind it: `{ name, type, fg, bg, colors, tokenColors }`,
  the same document bb's own highlighter paints from. Reach for it ONLY when
  your plugin renders code with an engine of its own (Monaco, CodeMirror) and
  has to build that engine's theme; for ordinary code and diffs use
  `experimental_SourceCode` / `experimental_Diff`, which are already themed.
  `theme` is null only before the first document resolves, and keeps the
  previous document while a palette switch is in flight — compare `theme.name`
  with `name` to tell a settled state from one still resolving — so a consumer
  that repaints on every change never paints an unthemed frame. Do NOT
  approximate the palette by reading bb's CSS variables: `--canvas` / `--ink`
  carry the app chrome, not the syntax colors, and a custom palette that
  declares its own code theme would not follow.

```tsx
const composer = useComposer();
composer.insert("Please summarize this.", { at: "end", block: true });
```

Composer customizations:

- Register with `app.composer.customize({ id, scopes?, actions?, experimental_popup?, plusMenu?,
sendMenu?, banners?, richText? })`. Omitted `scopes` means all thread,
  queued-message, and new-thread composers.
- `actions` and `banners` are plugin React components. `useComposer()` inside
  them is bound to the composer that mounted the component. Actions render
  before native voice/submit and are unavailable in compact layout; banners
  render above the composer. A banner's `chrome` is `"card"` by default or
  `"bare"`.
- `plusMenu` rows (the `+` menu) and `sendMenu` rows (the menu beside the send
  button, shown only while the composer can submit) are host-rendered so
  keyboard navigation, focus restoration, and mobile layout remain correct.
  Each item supplies `id`, `label`, optional `icon` (drawn instead of the
  plugin's branding icon), `description`, and `disabled` (a boolean or a
  function of the composer, re-evaluated when the draft or selection changes),
  plus `run({ composer })`. `plusMenu` rows also appear in the sent-message
  editor (scope `thread`), where the other customizations do not mount.
- `richText.effects` rules return plain-text `{ from, to }` ranges and a class
  name from plugin CSS. Decorations are paint-only and never mutate the draft.
- A `messageAction`'s `run` receives `context.composer`: the composer of the
  message's thread, or null.
- Use a vendored BB prompt icon-button recipe for native-matching action chrome
  and provide an accessible label. Each component/callback is isolated so one
  failing customization does not degrade the native composer. Complete
  reference: `examples/plugins/composer-customization`.

UI components use vendored shadcn source that you own. The former general host
component kit is removed. The app module still exports focused BB capability
components such as `ThreadChat`, `Markdown`, file links, pickers, source and
diff viewers, and the new-thread composer.

- Most builtin plugins in this repo import shared UI from `@bb/shared-ui`
  (the single source of truth the app also consumes and the registry
  generates from). Forkable builtins (`scripts/forkable-plugins.json`) import
  the same components through the `@/` alias, which their tsconfig maps onto
  that source; a fork vendors them from the registry. External and example
  plugins vendor source through the registry.
- `bb plugin new` pre-vendors button, card, input, checkbox, dialog (plus
  their support files: `lib/utils`, `lib/portal-scope`, icon,
  responsive-overlay, drawer, hooks) into `components/ui/` etc., and writes a `components.json`
  whose `@bb` registry is pinned to the release tag matching the running
  BB. Import via the `@/*` alias: `import { Button } from
"@/components/ui/button"` (tsconfig maps it; `bb plugin build` reads it).
- Add more with stock shadcn tooling: `npx shadcn add @bb/select
@bb/table` — the BB registry carries the full stock set (~46 items:
  accordion, alert-dialog, calendar, chart, command, form, sheet, table,
  …), generated from the BB app's own component source, so vendored code is
  version-matched to your BB by construction. Edit the copies freely; they
  never change out from under you. Re-running `shadcn add` is the manual
  update path.
- The registry's `icon` is a thin wrapper over `experimental_Icon`: vendored
  components draw bb's glyphs, including icons other plugins register, from
  the host at runtime instead of bundling an icon set.
- `toast`: `import { toast } from "sonner"` — runtime-shimmed to the host's
  Toaster (`toast.success("Saved")` just works; never mount your own
  `<Toaster>`).
- Never bundled (runtime-shimmed, import freely): react, the portaling
  radix families (`@radix-ui/react-dialog`, `-alert-dialog`, `-popover`,
  `-select`, `-dropdown-menu`, `-context-menu`, `-menubar`, `-hover-card`,
  `-tooltip`, `-navigation-menu`), `sonner`, `vaul`, `@pierre/diffs` (+
  `/react`). Your vendored overlays therefore share the host's
  dismissable-layer/focus/scroll-lock world — stacking against host
  overlays behaves correctly. "Import freely" is about the bundle: `tsc`
  still needs each one's declarations in `node_modules`, so every shimmed
  package is a **type-only `devDependencies` entry at the host's version**
  (the scaffold declares all of them; `bb plugin types` repins them; `bb
plugin types --check` reports drift). Never list one in `dependencies` —
  the build would not read it, and a git install would bundle a second
  copy of a singleton.
- Also never bundled, for size rather than singleton reasons: `clsx`,
  `tailwind-merge`, and `class-variance-authority`. Your app bundle uses the
  host's installed copies (tailwind-merge ^3, clsx ^2, cva ^0.7), so keep
  your declared ranges inside those majors. `zod` is NOT shimmed (exposing
  its namespace would bloat the host's boot payload) — it bundles from your
  `node_modules` in both `app.tsx` and `server.ts`, so keep it in
  `dependencies`.
- Source and diffs: use the host components
  `experimental_SourceCode` / `experimental_Diff` (see "Host components"),
  NOT a direct
  `@pierre/diffs` import. The shim stays for compatibility, but hand-rolled
  Pierre usage means owning patch normalization and the code theme yourself,
  and it opts you out of any installed renderer replacement.
- Everything else bundles from YOUR `node_modules` (hugeicons, lucide,
  non-portal radix, zod, form/calendar/chart libs): run `npm install`
  after adding components (`bb plugin new` runs the first one; `shadcn add`
  installs each item's declared deps). Users of your prebuilt artifact need no
  npm. Managed source installs do.
- `EmptyState` ships as `npx shadcn add @bb/empty-state`. The other old bb
  extras (`PageBody`, `Spinner`) are gone — write your own (each is a few
  lines; see `plugins/github/components/` for reference implementations).

One deviation from stock shadcn: `Dialog` renders as a bottom drawer on
compact viewports (the host's responsive behavior) — same API.

Crash isolation stays local to the slot. Additive slots can show a crash chip
or nothing. Replacement slots fall back to the native list or renderer.
`messageDirective` falls back to the original source text.

The `run` pattern (threadPanelAction): `run` is the place to resolve
server state before deciding what to open — e.g. call a backend rpc, then
`openPanel({ title: issue.title, params: { issueId: issue.id } })`, or
`toast.error("No linked issue")` and open nothing. The panel component
should treat `params` as untrusted input (it round-trips through
persistence) and re-fetch fresh data by id rather than embedding whole
payloads in params.

Styling: Tailwind classes compile against the host theme's live CSS
variables — use host token classes (`bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `text-destructive`, …). Never
define custom `@theme` colors and never hand-set `oklch(...)`/gray
literals: the build's Tailwind pass emits default-theme utilities only, and
hardcoded colors break custom palettes.

Composer popups register `{ label, component }` through `experimental_popup`.
Open by customization id with `composer.experimental_openPopup(id)`. The host
shares mention-menu placement and dismissal, and uses a persistent responsive
drawer for compact interactive popups. Inside the component, `useComposer()`
is bound to the opening composer; its `experimental_closePopup()` closes only
that plugin's popup and restores editor focus. Components own their search
input and result navigation. Opening returns false when the target or scoped
registration is unavailable; closing returns false if that plugin has no open
popup.
