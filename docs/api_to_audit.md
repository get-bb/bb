# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "CLI And Plugin API"). Each entry
summarizes the API, names where its behavior is documented, and lists what
must be settled before the prefix drops. Stabilizing means auditing the entry,
renaming project-wide, and deleting the entry in the same change. An entry
that stays experimental after an audit says so with the date and the open
question.

"Docs:" names a file in
`plugins/bb-guide/skills/bb-plugin-authoring/references/`, or
[provider-plugin-api.md](provider-plugin-api.md) /
[provider-bridge-protocol.md](provider-bridge-protocol.md). An entry without
a "Docs:" line has no owning doc, so it keeps the essential contract itself.

## Host paths (`@get-bb/plugin-sdk`)

`experimental_normalizeHostPath(path)`,
`experimental_resolveHostPath({ rootPath, path })`, and
`experimental_isHostPathWithin({ rootPath, candidatePath })` use the shared
`packages/domain/src/host-path.ts` parser. Normalization returns null for
non-absolute paths; resolution accepts absolute paths or joins relative paths
against an absolute root, rejecting empty/NUL paths, rootless backslashes and
drive-relative forms such as `C:foo`. Bare `C:` means the drive root. Windows
paths accept either separator and containment is case-insensitive; POSIX
backslashes within relative names stay literal. Resolution permits `..` escapes;
containment is a separate lexical check, not a symlink or filesystem check.
`experimental_joinHostPath({ rootPath, relativePath })` appends relative segments;
`experimental_getHostPathDirname(path)` / `experimental_getHostPathBasename(path)`
extract components; `experimental_getRelativeHostPath({ rootPath, candidatePath })`
returns slash-separated descendants (null outside the root); and
`experimental_getHostPathComparisonKey(path)` normalizes keys with Windows case
folding. These re-export the same domain functions used by core workspace paths,
file-link resolution, and database host-path SQL. None accesses the filesystem.
Workflows and Inline Vis apply containment; Secrets permits outside destinations.
Docs and Monaco use joins and components for host-backed files; Tasks, Automations,
and Browser Automation resolve CLI file paths. Storage Retention uses comparison
keys and relative paths to protect live workspaces across Windows spellings.

Core callers of the same parser include project-path normalization,
`normalizeAbsoluteFilePath` / `isAbsoluteFilePathWithinRoot` in shared-ui,
`isBbManagedWorkspacePath` on the server, and database host-path SQL functions.
Docs: Plugin Guide, The bb SDK (`plugins/plugin-api-docs/src/surfaces.ts`).
Before stabilization, audit drive/UNC ambiguity, separator and case rules,
relative escapes, and whether more callers need resolution rather than joining.

## SDK HTTP errors (`experimental_BbHttpError`, `@get-bb/plugin-sdk`)

`experimental_BbHttpError` re-exports `BbHttpError` from `@bb/sdk/http-error`,
the error every `bb.sdk` call rejects a non-2xx response with: `status`,
`code` (the server's error code or null), `body` (the parsed response) and the
message `HTTP <status>: <message>`. A `Symbol.for("@bb/sdk/http-error")` brand
and `static [Symbol.hasInstance]` make `instanceof` match errors created by any
copy of the SDK, so a plugin's bundled copy recognizes errors the host's
`bb.sdk` throws. Core callers: `@bb/sdk`'s own job waits and status reads use
the same class and check; bundled plugins (tasks, git, github-pr-status,
secrets, connect, storage-retention, provider usage sources and others)
narrow with it instead of duck-typing `status`. The plugin RPC route
(`POST /api/v1/plugins/<id>/rpc/<method>`) returns `{ code, message }` for
every failure, including `plugin_not_found` (404), `plugin_not_running` (503),
`invalid_caller` (403) and `unsupported_media_type` (415), so bb-account's
client and connect's sign-in UI read `code` instead of the status. Docs: Plugin
Guide, The bb SDK (`plugins/plugin-api-docs/src/surfaces.ts`). Stabilize after
checking `code`/`body` across every route family (the plugin `http` and
WebSocket routes still return bare string errors) and whether plugins need a
narrower helper than the class.

## UTF-16-safe cuts (`@get-bb/plugin-sdk`, `@get-bb/plugin-sdk/app`, `@get-bb/plugin-sdk/host`)

`experimental_sliceUtf16Head(value, maxChars)` keeps at most `maxChars` UTF-16
code units from the start of `value`, and `experimental_sliceUtf16Tail(value,
maxChars)` (`@get-bb/plugin-sdk/host` only) keeps them from the end. When the
cut would land inside a surrogate pair, the whole pair is dropped, so the
result never holds a lone surrogate (half an emoji). A negative `maxChars`
returns an empty string. The root and `/app` exports serve server and app
code; `/host` serves host workers and provider bridges, whose root SDK runtime
is a stub.

These re-export `sliceUtf16Head` / `sliceUtf16Tail` from `@bb/text-utils`,
the helpers core uses to cap child-thread output, plugin instructions,
restart-resume notes, timeline output, terminal titles and queued-message
failure reasons; the `/app` export is that function, installed by
`plugin-sdk-app-impl.tsx`. Plugin callers: Account Pool, Ask User Question,
Automations, Browser Automation, Concurrency Limit, Docs, GitHub, MCP, Push
Notifications, Secrets, and the Claude Code and Codex providers. Agent
Annotations keeps an inline copy because its page script is stringified into
the browser. Docs: Plugin Guide, The bb SDK
(`plugins/plugin-api-docs/src/surfaces.ts`).

Before stabilization, decide whether callers need grapheme-safe cuts (joined
emoji, combining marks) rather than surrogate-safe ones, and whether
`/app` and the root need the tail variant.

## Application link approvals (`@get-bb/plugin-sdk/app`)

`experimental_getApplicationLinkApprovals()` lists approved URL schemes on the
viewing client. `experimental_revokeApplicationLinkApproval(scheme)` removes one;
`null` resets all. Both return the remaining scheme list. They use the same
`applicationLinkApprovals` implementation as core Settings → General → Links →
Application link approvals. All clients use web localStorage scoped to the
current origin and device profile. Neither API can grant approvals. The shared
web UI owns consent; native clients validate and launch the approved URL.

Docs: Plugin Guide, Host components (`plugins/plugin-api-docs/src/surfaces.ts`).
Before stabilization, verify consent and revoke flows on all supported native
platforms, per-origin scope, old-client launch errors, and storage recovery. Core
callers are `ApplicationLinkApprovalsSettings` and the URL confirmation dispatcher.

## Server list (`experimental_useServers`, `experimental_hasServers`, `@get-bb/plugin-sdk/app`)

`experimental_useServers()` returns `{ status, servers, switchTo, addServer,
accountSignIn }` on bb Desktop and the mobile app, and null in a web browser,
whose server list would be scoped to one origin. Each `ExperimentalServer` has an `id`, `name`, `origin` (scheme,
host and port only; desktop custom URLs can embed login details and paths),
`kind` (`local`, `account` or `custom`) and `active`. On desktop, `status` is
`loading` with no servers until the main process answers; the mobile app
injects its list with the bridge handshake, so it starts `ready`. Both then
push changes, and a change that arrives during a read wins over the read. `switchTo(id)` reloads the client on that server, unloading every
plugin; it ignores the active server and unknown ids. `addServer()` opens the
client's own add-server screen (bb Desktop's Add Server dialog, the mobile
app's Add server screen from bridge version 5); it is null on clients without
one. `accountSignIn` is set while bb Desktop skips listing the user's account
servers because bb Connect needs a sign-in, with the label its Server menu
uses and a `start()` that opens the same sign-in window; it is always null on
the mobile app. `experimental_hasServers()` is true exactly where the hook
returns a value; it is fixed for the life of the page, so a plugin can read it
in `definePluginApp` and register server controls only on bb Desktop and the
mobile app. Core's command palette uses the same `getServerChoices` /
`useServerChoices` implementation, and the bundled Server switcher plugin
(`plugins/server-switcher`) is the sidebar footer's server switcher, built on
both functions. `apps/app/src/lib/server-choices.test.tsx` runs the hook
against bb Desktop and the mobile app, and the plugin's own tests cover its
registration and panel. Desktop's main process opens the sign-in only while
its Server menu offers it (`bbDesktopConnectSignInLabel`). Desktop pages
served by an older desktop release get null until it updates, and a desktop
release from before `addServer` lists servers without it. Plugins can't edit, rename or remove
servers, and can't call another server. The list lives in the client, so the
`bb` CLI has no server list to reach and no command.

Docs: Plugin Guide, Sidebar footer items (`plugins/plugin-api-docs/src/surfaces.ts`).
Before stabilization, decide
whether desktop custom-server ids should survive a URL edit (they hash the
URL today), and verify switching on iOS, Android and desktop with account and
custom servers, including a mobile route pinned to a profile by a deep link.

## Composer popups

`ComposerCustomization.experimental_popups` registers `{ id, label, component }`
popups; `PluginComposerApi.experimental_openPopup(id)` opens one in that
composer and `experimental_closePopup()` closes it, both returning false when
they cannot act.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, verify multiple composers, selection retention, plugin
reload and crash recovery, scope suppression, and compact Safari
keyboard/drawer behavior. Verify multiple popups in one customization and
popup-id uniqueness across customizations.

## `app.slots.experimental_composer`, `experimental_useComposerRenderer`, `experimental_ComposerRoot`, `experimental_useComposerContributions`, the composer search hooks, the prompt mention pill functions and the composer host components (`@get-bb/plugin-sdk/app`)

`experimental_composer({ id, title, description?, component })` draws bb's
composer input box everywhere bb shows a composer. It is exclusive, chosen by
the synced `composer.provider` UI preference through the shared exclusive-slot
resolver (`resolveExclusive` in
`apps/app/src/lib/plugin-replacement-preference.ts`; Settings → Appearance →
Composer), and with no composer plugin enabled no composer is shown. While another plugin's composer is crashed, `ComposerBox` renders the
bundled one over the same host draft, with Reload in the toast. bb's own
composer is the bundled `plugins/composer` plugin (`bb--composer`), built on
this slot: core renders every composer through `ComposerBox`
(`apps/app/src/components/promptbox/ComposerBox.tsx`), which resolves the
slot and provides the hooks below.

The composer reads and writes the draft through `useComposer()`, the same
path other plugins use: inside the box it is bound to the box's host, and
`submit()` runs the box's own Enter, queue or steer handler (the host picks
it from `experimental_mode` exactly as the box's shortcuts do), so a plugin's
submit steers a running thread exactly as Enter does. The host runs other plugins' draft observers and assembles every
highlight rule into `decorationSources`.

`experimental_useComposerRenderer()` carries `input` (the surface, submission,
typeahead, attachments, history, voice, sizing and collapse state, and bb's
execution controls, handoff banner and compact-before-send chip, named so the
composer chooses where they go) and host services (`threadLinks`,
`clipboard`, `attachmentSrc`, app key dispatch, toasts). The composer's
scope and draft key come from `useComposer().scope` and `.key`, which inside
the box are bound to the box's host.
`input.submission.enter` and `.modifier` are the box's two actions, worked
out by the host from the surface and the user's "Enter steers" setting: each
says what it does now (`send`, `queue` or `steer`), whether it needs a
draft, and its shortcut, and `run()` runs it. The box only gates and draws
them; which key queues and which steers, and that an empty steer sends the
next queued message, stay with the host. `input.resolveMentionLink` says what clicking a
pill does, opening attachment mentions and tiles in bb's viewer; core's
timeline, the thread view's attachment opener and the composer share that
opener. `input.maxHeight` caps the box where the host has limited room (the
compact New thread home), so the host no longer measures the composer's DOM. `experimental_ComposerRoot` takes the composer's
root element and its editor and does the wiring core used to ask each
composer for: it publishes the editor to `useComposer()`, routes bb's and
other plugins' composer commands, and registers pane focus and thread drops.
`experimental_useComposerContributions()` returns other plugins' popups, `+`
and send menu items and inline actions with their host renderers, applying
the surface's suppression. The host components are the voice button
(`experimental_VoiceInputButton`), recording bar
(`experimental_VoiceRecordingBar`) and failed recordings
(`experimental_FailedVoiceRecordings`), shortcut hints
(`experimental_ShortcutHint`), mention and plugin icons
(`experimental_PromptMentionIcon`, `experimental_PluginIcon`) and thread-title
text (`experimental_ThreadTitleText`, with the
`experimental_useThreadTitleDisplayText(title)` hook for plain strings). The
image lightbox the composer uses for attachments has its own entry
(`experimental_ImageLightbox`).

Docs: `frontend-renderer-slots.md`.

`experimental_useComposerMentionSearch()` and
`experimental_useComposerCommandSearch()` search bb's @-mention sources and
the provider's commands for the composer's open menu, and both return ranked
groups under their headings, so relevance and grouping stay with bb. The
composer reports the menu's query with `search(query)` from the event that
changed it. Each composer box runs its searches in its own memoized provider,
which the surface configures with what to search (project, environment,
provider, triggers): a keystroke in an open menu renders the provider and the
composer once, and plain typing never runs the search. A query passed during
render would have to reach the provider from an effect, a second render.
Both report `refreshing` while earlier results show. The command search has
no paging, since bb returns every match, and no prefetch: commands load when
the first command query arrives and report `loading` until they do, so
focusing a composer costs no request. A character is a mention trigger or a command trigger, never both;
when a plugin mention provider claims `$`, `$` opens the mention menu.
Every type in the contract is public: mentions, attachments and history use
the `useComposer()` shapes, and suggestions carry the mention to insert plus
per-kind display fields. bb's composer works in these types throughout. bb
reaches a composer only through the editor it hands to
`experimental_ComposerRoot`.

`experimental_describePromptMention(mention)`,
`experimental_promptMentionClipboardAttributes(mention, text)` and
`experimental_readPromptMentionClipboard(element)` give a composer's pills
bb's classes, tooltip and text and its copy format, so pills copied between
any composer and bb's messages paste back as pills. The timeline's pills use
the same implementation. `threadLinks.parse`, `.cached` and `.resolve` turn
pasted bb thread links into thread pills; bb owns
its route shapes, id format and lookup batching, and core's initial-draft
mention resolution shares the batching.

The bundled composer is on the forkable list (`scripts/forkable-plugins.json`):
it imports only `@get-bb/plugin-sdk`, npm packages and registry UI, and
`pnpm check:plugin-forks plugins/composer` builds a copy outside this
repository.

Decided and kept: collapse state (`compact`, `onCollapse`, `minHeight`,
`maxHeight`, `mentionMenuPlacement`) is host state, because the controls outside the box
collapse with it; the attachment, clipboard, toast and thread-link services
stay composer-scoped until another caller needs them; voice keeps its config
and host components; `+` menu items show on surfaces that hide other plugin
customizations, as before the move; @-mentions of the draft's own
attachments are the composer's, since it holds the draft, so bb's mention
search returns none.

`apps/app/src/components/promptbox/composer-contract.test.tsx` is the
contract table: bb's composer and a minimal textarea composer
(`apps/app/src/test/fixtures/minimal-composer.tsx`, public SDK only) each run
on the thread composer, a running thread that steers on Enter, embedded
thread chat, the queued and sent message editors and the New thread
composer, mounted through the real surface components. It covers drafts,
Enter, pane focus, thread drops, voice transcripts, other plugins' insert,
submit and popups, and which surfaces stay out of `useComposers()`. With bb's
composer it also checks other plugins' `+` rows (each opening its popup in
that composer), send rows, banners and actions on every surface, filtered by
`scopes`: the sent-message editor runs `+` rows, popups and composer commands
but mounts no send rows, banners, actions or rich text.
`experimental_ComposerRoot` publishes stable functions that call the latest
editor and republishes only when the editor's state changes, so a composer
can build its editor inline on every render. The box reports only what it
alone knows (`editor.state.layout`). bb owns run, submit and upload state:
`useComposer().isRunning`, `isSubmitting`, `isSubmittingBlocked`,
`submittingBlockedReason` and `submit()`'s upload wait come from what bb
passes the box in `submission`, `attachments` and `voice`
(`apps/app/src/components/promptbox/composer-host-state.ts`), so a box that
mis-reports them cannot mislead other plugins. Already-built composers that
still report the removed fields keep working; bb ignores them.

Styling the composer needs lives in the plugin (`plugins/composer/src/composer.css`).
bb keeps the pill surface its timeline shares and the highlight classes of
its own decorations. bb's controls inside the box size their labels against
bb's own `[data-composer-box]` wrapper, so a composer declares no CSS
container. `input.compact` says when to show the one-line form: `"always"`
when the host collapsed the box, `"narrow"` when bb's CSS container signal
says the pane is short or the column narrow. The box reports the form it
shows in `editor.state.layout`, which becomes `view.layout`; the host asks
for the caret at the end with `editor.focusEnd()`, and measures the menu
`experimental_ComposerRoot` is given on surfaces that make room for it, so
the input carries no change counters or layout callbacks. bb releases
local attachment previews when attachments leave the draft.

Before stabilization:

- a composer has one mention search and one command search; confirm no
  composer needs two at once;

## Composer commands

`PluginAppComposer.experimental_registerCommand({ id, title, defaultShortcut?, scopes?, isAvailable?, run })`
registers a palette and keyboard command that runs against the owning
composer's `PluginComposerApi`, rebindable under
`plugin:<plugin-id>/<command-id>` and sharing the `app.commands` id namespace.

`scopes` takes the composer kinds of `ComposerCustomization.scopes`
(`"thread"`, `"queued-message"`, `"new-thread"`; the sent-message editor
reports `"thread"`), and `isAvailable(context)` gets the context `run` would
get. Both feed the availability predicate of `useComposerCommand`
(`apps/app/src/components/promptbox/composer-commands.tsx`), the hook bb's own
`composer.focus` command registers through: out of scope, unavailable or
throwing (logged), the composer does not claim the key, so the shortcut falls
through to bb, and the palette leaves the row out for that composer. Callers
these replace: kalindudc/bb-marketplace's tavern returns early from `run` when
`composer.scope.kind !== "thread"`, and jonnik-bb-plugins/bb-plugin-bang-shell
returns early on `composer.isEmpty || composer.isSubmittingBlocked`; both
still swallow the key and keep the palette row today. Prompt Library's
`search-prompts` command needs neither.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, verify split panes, side chat, inline queued-message
editing, palette invocation from each, plugin reload, and rebinding.

## `settingsSection.experimental_page`

`experimental_page: "mobile"` mounts a plugin settings section only on
Settings → Mobile, and only when that plugin owns the selected access
provider. Omitting it keeps the section on the plugin's configuration page.

Docs: the Plugin Guide's Custom settings section card lists the symbol only.

Callers: bb connect (`plugins/connect/app.tsx`), and one community plugin, the
lan-connect plugin in kalindudc/bb-marketplace.

Stabilization requires verifying placement isolation, plugin
disable/uninstall, loading and failure states, and pairing lifecycle on
Mobile.

## `app.slots.experimental_messageMetadata` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.98.

`app.slots.experimental_messageMetadata({ id, placement?, component })` mounts
React metadata beside realized user and assistant conversation messages,
including windowing overscan and embedded ThreadChat timelines. `placement`
accepts "above" or "actionRow"; omission defaults to "above". "above" renders
over the message, aligned to its side. "actionRow" renders in the message's
action row and shows and hides with the actions: on hover or focus where the
device can hover, and always where it cannot. It sits before the actions on
user messages and after the overflow menu on assistant messages, and extends
into the space beside the message rather than narrowing the actions. Device
policy belongs to the component: bb's own inline time returns null on touch
devices, which keep the time in the overflow menu footer. The component
receives `{ message }` with `id`, `threadId`, `role`, exact `createdAt` in Unix
milliseconds, and `turnId` (null outside a turn). User messages also expose
`initiator: "user" | "agent" | "system"`; assistant messages do not. Message
text and source sequence numbers are excluded, so streaming text does not
invalidate metadata props. Types: `ExperimentalMessageMetadataRegistration`,
`ExperimentalMessageMetadataPlacement`, `ExperimentalMessageMetadataProps`, and
`ExperimentalMessageMetadataContext`.

Components inspect `message.role` and return null to skip a message.

BB supplies plugin context, CSS, muted typography, alignment, and ordering: bb's
own contributions first, then plugin id, then registration order. Each plugin
contribution has its own error boundary and empty suspense fallback. Plugin
hooks can fetch or subscribe to data; use shared query caches rather than one
request per message. Components unmount when their messages are no longer
realized or the registration is removed. Plugin effects own their cleanup
and time-based refreshes; BB adds no timer, text length limits, or server calls.

Core caller: the inline message time in the hover action row
(`apps/app/src/core-contributions/message-time.tsx`) registers
through this slot with `placement: "actionRow"` and renders through the same
`MessageMetadata` host as plugin contributions.

Before stabilizing, audit compact and embedded placement, variable-height
metadata and scroll anchoring, unmount cleanup, asynchronous updates,
origin filtering, and render isolation during streaming and across messages.

## `PluginMessageActionRegistration.experimental_surfaces` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.161.

`app.slots.messageAction({ ..., experimental_surfaces })` limits the action to
some thread timelines. `"thread-view"` is bb's thread view, including split panes;
`"embedded-chat"` is an embedded `ThreadChat` in any variant. Omitted, the action
shows on both. An empty array or any other value fails registration. Type:
`ExperimentalMessageActionSurface`.

Each `ThreadScreen` host states its surface (`ThreadScreenTimelineHost.messageActionSurface`),
and the timeline reads the slots through `useSurfaceMessageActionSlots`
(`apps/app/src/lib/message-action-surface.tsx`), so every surface filters the same way.

Caller: the bundled Side chat plugin's "Reply in side chat" declares
`["thread-view"]`. Its side chat tab only exists in the thread view's panel, and a
side chat is itself an embedded `ThreadChat`, so the action stays out of side
chats and other plugins' embedded chats.

Before stabilizing, decide whether surfaces should instead follow panel
capability (whether the surface's panel can host the tab the action opens), and
whether more surfaces (New thread previews, plugin documents) need names.

## `app.commands.register`

Unprefixed by explicit request. Registers frontend commands
(`{ id, title, defaultShortcut?, isAvailable?, run }`) for the quick palette
and keyboard bindings; the deprecated `app.slots.commandPaletteAction` alias
shares its validation and per-plugin id namespace.

Docs: `frontend-renderer-slots.md`.

Audit command identity, availability outside the palette, shortcut conflicts,
and saved binding lifecycle before stabilizing the keyboard shortcut
contract. Audit cross-platform conflicts and plugin lifecycle before
extending the context model or default binding policy.

## `ExperimentalPluginActionContext` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.167.

`{ sdk, navigate, panel, composer, threadRequests }`: the registering
plugin's `useSdk()` client, its `useBbNavigate()`, the panel controller of the
surface that invoked the callback, the composer it acts on (see the
`ExperimentalPluginActionContext.composer` entry), and bb's Archive and Delete
flows (see the `ExperimentalThreadRequests` entry). Members are handles, not
verbs: a new core flow joins the handle it belongs to, such as
`threadRequests`, instead of the top level. Every plugin callback context extends it:
`PluginCommandContext`, `PluginMessageActionContext`,
`PluginThreadActionItemInput`/`PluginThreadActionBulkItemInput`,
`ExperimentalThreadTabActionContext` (which also carries the tab's
`ExperimentalThreadTabProps`, `threadId` and `environment`) and nav-panel
action tabs' `run`,
`PluginNewThreadPanelActionContext`, `PluginSidebarFooterActionContext`,
`ExperimentalSidebarFooterActionContext`, and
`ExperimentalComposerActionContext` (composer commands, `plusMenu` and
`sendMenu` rows). `navigate` and `panel` act on the focused
surface for commands, thread actions and sidebar footer actions; on the
thread view that showed the message for message actions; on the launching
surface for panel actions; and on the composer's surface for composer
callbacks. Commands and message actions gained `sdk`/`navigate` here; thread
actions already had them under the same names. `experimental_panel` is renamed `panel`;
`withRetiredPanelAlias` (`apps/app/src/lib/plugin-panel-controller.ts`) keeps
the old name on every context at runtime, and
`packages/plugin-build/src/retired-sdk-members.ts` warns plugins that still
use it.

Docs: `frontend-hooks-and-ui.md#callback-context`.

Core callers: `usePluginActionContextBinder`
(`apps/app/src/lib/plugin-navigation-hooks.ts`) is the one implementation
behind `useBbNavigate` and every callback context, including bb's own thread
actions (`thread-action-registry.tsx`). `PluginActionContextProvider`
(`apps/app/src/lib/plugin-action-context-provider.tsx`, mounted in
`main.tsx`) binds it once for `CommandPalette`, `ThreadTimelineRows`, panel
action launchers, sidebar footer items and composer callbacks, so they do not
subscribe to the router. Panel action launchers read their surface's host
through `AppNavigationHostCapture`. Contract tests: the panel controller
contract table in `ThreadDetailView.contract.test.tsx` runs the terminal,
file preview and URL cases against message actions and palette commands.

Plugin caller: Conductor's Run command and "Fork to new workspace" message
action, which replaced an invisible `experimental_appOverlay` that copied
`useSdk()`/`useBbNavigate()` into module globals.

Before stabilizing, remove the runtime `experimental_panel` alias once
marketplace plugins have moved to `panel`, and decide whether `BbContext`
should describe the invoking surface too.

## `ExperimentalPluginActionContext.composer` and `experimental_useActiveComposer` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.177.

`context.composer` is the composer a callback acts on: the handling composer
for composer commands and menu rows, the message thread's composer for message
actions (`PluginMessageActionContext` keeps its own meaning), and the focused
surface's active composer, or null, for every other callback.
`experimental_useActiveComposer()` returns that active composer to app-wide
components such as overlays and plugin pages. The active composer is the one
holding the caret. Focus that moves into an app-wide layer, meaning anything
outside the app shell (`data-app-shell` on `AppLayout`'s `SidebarProvider`
root: the command palette, dialogs, popovers, plugin overlays and
content-script layers), does not count as leaving it. Failing that, it is the
focused surface's first primary composer (`data-app-composer-role`); failing
that, null. Handles are detached like `useComposers()` handles and name the
same composer by `key`.

Docs: `frontend-renderer-slots.md#active-composer` and the Plugin Guide's
composer card.

Core callers: `resolveActiveComposer` (`apps/app/src/lib/active-composer.ts`)
is the only owner rule. `ComposerRoot` (`composer-root.tsx`) uses it for
`composer.focus` and plugin composer commands, and `ModelReasoningPicker` uses
it for the model picker toggle and cycle chords, replacing the per-composer DOM
check in the deleted `composer-command-ownership.ts`.
`usePluginActionContextBinder` reads it for `context.composer` and
`useActiveComposer` (`plugin-sdk-hooks.ts`) for the hook. Keyboard and palette
dispatch pass their event target, which the resolver reads in place of
tracked focus. Contract test: `active-composer.test.tsx` checks that the hook,
the palette's `context.composer` and `composer.focus` agree across caret, app
layer, surface-focus and unmount cases.

Plugin caller: Conductor's New chat transcript chips, replacing a
`useComposers()` key match that never matched (the handle key is
URI-encoded). Community callers that can migrate: brsbl desktop's
library-bridge (needs Send to keep focus and a raised window to focus its
composer; its body-level notes pads render outside bb's tree, so they can't
call the hook), smsunarto vimium's `NavigationBridge`, and
vburojevic floating-terminal's `pick()`.

Before stabilizing, decide whether a pointerdown in an app-wide layer that
moves no focus should keep the caret composer too; today it clears it.

## `BbContext.experimental_pluginPanel` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.167.

`useBbContext().experimental_pluginPanel` is `{ pluginId, path, subPath }`
(type `ExperimentalPluginPanelPage`) when the route shows a plugin nav panel,
any plugin's, else null. `subPath` is percent-encoded like the panel
component's `subPath` prop.

Docs: `frontend-hooks-and-ui.md`.

Core callers: derived with `paneContentForPathname`
(`apps/app/src/views/thread-detail/splitThreadNavigation.ts`), the same parse
`AppLayout` uses to pick the plugin panel it mounts.

Plugin caller: Conductor's sidebar highlights the workspace whose Untitled
page is open, replacing its own store of mounted pages.

Before stabilizing, decide whether `BbContext` should describe every page
(thread, New thread, settings, plugin panel) as one union, and whether split
panes need the focused pane's page or every pane's.

## `experimental_matchesShortcutKey` (`@get-bb/plugin-sdk/app`)

`experimental_matchesShortcutKey(event, key)` says whether a keydown presses
`key`, compared the way bb compares keys for its own and plugins' keybindings.
The caller checks modifiers. Letter, digit and punctuation keys match by
physical position (`event.code`) when the layout types a non-Latin character
there (or, with Alt held, anything but an ASCII letter or digit); otherwise
they match the typed character with Shift removed from US punctuation, so
Latin layouts such as Dvorak and AZERTY keep their own letters. Without Alt,
the typed character also matches, which keeps shortcuts saved under a
non-Latin character working.

Docs: `frontend-renderer-slots.md`.

Core callers: `matchesAppShortcut` in `@bb/domain` (app commands, plugin
commands, the desktop embedded browser and shortcut conflicts), the desktop
reload shortcut and the terminal copy/paste keys all call the same
`matchesAppShortcutKey`; the SDK function is that function. Plugin callers:
the Composer's paste-as-plain-text check, Prompt Library's Mod+S and Tasks'
single-key shortcuts.

Before stabilizing, decide whether plugins also need a full-chord matcher that
resolves `mod` per platform, and whether settings should label shortcuts with
the active layout's characters (`navigator.keyboard.getLayoutMap()`).

## Plugin command shortcuts (`experimental_useCommandShortcut`, `PluginCommandRegistration.experimental_keyScope`)

- **Surface:** `experimental_useCommandShortcut(commandId): ExperimentalShortcutPresentation | null` on `@get-bb/plugin-sdk/app` returns the shortcut currently bound to the calling plugin's command `commandId`, as `{ label, ariaKeyshortcuts }` for this platform. `PluginCommandRegistration.experimental_keyScope?: "pluginPage"` limits a command's keyboard binding to the plugin's own pages and is the only way to give a bare-key `defaultShortcut` (such as `{ key: "c" }`). The testing harness's `renderSlot` takes `experimental_commandShortcuts`, the presentation per command id (omitted ids return null).
- **Behavior:** the hook follows rebinds, conflict demotion and platform: null when the command is unbound, its default was left unbound by a conflict, or the plugin registered no such command; it throws for an id that is not letters, digits, `-` and `_`. With `"pluginPage"`, the binding fires only while one of this plugin's nav panel pages is the focused surface (the focused pane in a split), never while focus is in a field or editor (including a split pane's composer) or a menu or listbox, or a modal is open; the desktop embedded browser never forwards plugin keys. Registration rejects a bare-key default without the scope. Keyboard settings list the command with its conflict check and let the user rebind a page-scoped command to another bare key. Two page-scoped bindings from different plugins never conflict, at load or in Keyboard settings, because their pages are never focused together; a page-scoped binding still conflicts with app-wide bindings, core question keys and the same plugin's other page commands. The palette still lists the command wherever `isAvailable` allows; omitting the scope keeps the app-wide, outside-modals rule.
- **Core callers:** the hook is `useAppCommandShortcut(pluginCommandId(pluginId, id))` from `apps/app/src/components/commands/AppCommandProvider.tsx`, the hook bb's own buttons and tooltips use for their labels (sidebar, panels, composer, browser tab). The scope maps in `usePluginCommandBindings` to the private `when` `{ all: [mainSurface, pluginPage], none: [modalOpen, editableFocus] }`, beside the composer target's mapping; `pluginPage` is satisfied when the command's own plugin page is focused, which `PluginPanelRightPanelHost` (the host of every plugin page, routed or split) registers with `useAppCommandFocusedPluginPage`. The dispatcher evaluates it in `matchesAppCommandContext` (`apps/app/src/lib/app-keybindings.ts`), the same evaluator as core's bare question keys (focus in a menu or listbox counts as `editableFocus` for both, via `isTypeaheadKeyboardTarget`), and Keyboard settings allow bare keys through `allowsBareKeyShortcut`, the rule that already covers question keys. Core's Settings page uses the same page rule: `settings.search` (`/`) has `when` `{ all: [mainSurface, settingsPage], none: [modalOpen, editableFocus] }`, the Settings sidebar registers `settingsPage` with `useAppCommandContext`, and `isPageScopedAppKeybinding` / `canAppKeybindingsFireTogether` in `apps/app/src/lib/app-keybindings.ts` treat `settingsPage` and each plugin's `pluginPage` as separate pages for the bare-key rule and both conflict checks (`resolvePluginCommandDefaults`, `getShortcutConflicts`). Plugin callers: Conductor's Run button label (`run`) and Tasks' bare `c` (`new-task`), which replaced its own window listener.
- **Other callers that can migrate:** `chug2k__bb-plugin-retitle` and `xkrsz__bb-model-presets` hardcode their own shortcut labels; `cristoslc__bb-plugin-focus-board` binds a bare key on `window`.
- **Stabilization:** decide whether other scopes are needed. Then rename project-wide and remove this entry.

## Discoverable RPC

`bb.rpc.register` accepts `experimental_discoverable` and
`experimental_description` options, and method definitions accept
`experimental_description`. A discoverable method publishes its wire schemas
(Standard JSON Schema) and description. Discovery does not change RPC
authorization or dispatch.
`bb.sdk.plugins.experimental_discoverRpc({ pluginId?, method?, signal? })`
lists the published methods of loaded plugins. Methods disappear on unload, so
callers handle the race between discovery and invocation. The fake host
exposes `experimental_publishedRpcMethods`.

The Plugin Guide lists only `experimental_discoverRpc`, and the authoring
skill names it only in a member list (`backend-sdk.md`). The
`experimental_discoverable` and `experimental_description` options appear in
neither, yet about 36 community
plugins publish discoverable methods (99Lys/bb-plugin-metadata-tags,
ai-ecoverse/bb-droid, ai-ecoverse/bb-gh-copilot among them), copied from
bundled code.

Before stabilization, audit schema export fidelity (especially refinements and
transforms), descriptor size and reference limits, lifecycle races, and
cross-plugin copied-schema compatibility. Verify `bb plugin rpc list|inspect`
is sufficient to implement a consumer without a shared contract package.
Method names carry optional versions; there is no negotiation.

## Plugin safe mode

`bb.sdk.plugins.experimental_getSafeMode()` returns `{ enabled }`.
`experimental_setSafeMode({ enabled })` returns `{ enabled, problems }`, where
`problems` names each plugin that did not start when safe mode ended. While
safe mode is on, only plugins included with bb run: `builtin` provenance, or
an auto-installed bundled source. Every other plugin stays unloaded with
status `disabled`. Each plugin's own `enabled` flag is untouched. Enable keeps
an affected plugin unloaded, reload reports a failure, and install and update
are refused. The flag persists on the server and backs
`bb plugin safe-mode [on|off]`.

Before stabilization, audit whether official store plugins should count as
included, whether a plugin calling `experimental_setSafeMode` should be
allowed to stop itself and others, whether the toggle should run
asynchronously for installs with many slow plugins, and whether startup needs
an out-of-band override (env var or flag) for a plugin that breaks the server
before the toggle is reachable.

## Queued message edit holds

`bb.sdk.threads.queuedMessages.experimental_holdForEdit({ threadId, queuedMessageId })`
(`POST /threads/:id/queued-messages/:queuedMessageId/edit-hold`) holds a
queued row while someone edits it and returns `{ leaseMs }`. While the hold
is live, no automatic dispatch (idle drain, schedule, plugin recheck, host
reconnect, failed-retry) claims the row, and the idle drain also keeps the
drainable rows behind it queued; rows waiting on a schedule or plugin are not
held back, and explicit send-now still claims it. Calling again renews the
lease; an unrenewed hold lapses after `leaseMs` and the periodic sweep
dispatches the row. It answers 409 once a dispatch claimed the row and 404
for a missing row. Holding never changes `updatedAt`, so a pre-hold
`expectedUpdatedAt` stays valid; a successful `queuedMessages.update` that
changes `input` clears the hold, while one that changes only `sendAt` or the
execution options keeps it, so a plugin moving a row cannot release someone's
edit. `experimental_releaseEditHold` (`DELETE`, same path) cancels
without saving and is a no-op for an unheld row; releasing or saving
re-attempts dispatch immediately. The app's inline editor holds on open,
renews every quarter lease, and releases on close. Any client may renew or
release a hold.

Before stabilization, audit whether holds need an owner token so two clients
editing the same row cannot release each other's hold, whether queue DTOs and
`bb thread queue list` should show that a row is being edited, and whether
the lease length suits throttled background tabs.

## Plugin cache pruning

`bb.sdk.plugins.experimental_pruneCache({ dryRun? })`
(`POST /plugins/cache/prune`) deletes cached git and npm plugin versions
under `<data>/plugins/cache` that no installed plugin uses and returns
`{ dryRun, removed, bytes }`; each removed entry has `pluginId` (null for an
unrecorded directory), `version`, `path`, and `bytes`, counting a shared
monorepo checkout once. It removes every non-active version regardless of
age and keeps active versions, versions a pending or restoring rollback
needs, directories containing or inside an installed plugin's root, and
in-flight staging directories. It runs under the plugin registration lock.
Removing a plugin deletes its cached versions at once, and a successful update
deletes replaced versions once activation stabilizes (its state snapshot
stays for the 7-day retention window). It backs `bb plugin prune [--dry-run]`
and the palette's Clean up plugin cache.

Before stabilization, audit whether the response should report
retained-but-unused sizes so a UI can show reclaimable space without a dry
run, and whether stale `.staging`, `.promoting`, and `.corrupt` directories
left by crashes should be collected too.

## RPC caller identity (`ExperimentalPluginRpcHandlerContext.experimental_caller`)

Every `bb.rpc.register` handler receives a context whose `experimental_caller`
is `{ kind: "plugin", pluginId }` for a loaded plugin's
`bb.sdk.plugins.callRpc` and `{ kind: "client" }` for everyone else. A
per-load token makes the identity unforgeable by clients.

Docs: `backend-events.md`, `backend-sdk.md`.

Before stabilizing, audit whether other surfaces (HTTP routes, agent tools,
CLI commands) need the same identity, whether a plugin needs to know the
calling app window or thread, and whether in-process plugins that read other
plugins' memory make the token a meaningful boundary for third-party plugins.
bb account relies on it to keep `/api/connect/` requests, credential reads,
refused-credential reports, and credential adoption to the connect plugin.

## RPC cancellation (`ExperimentalPluginRpcHandlerContext.experimental_signal`)

Every `bb.rpc.register` handler receives an `experimental_signal` that aborts
when the HTTP request disconnects (including a `bb.sdk.plugins.callRpc` caller
giving up after its 75 s timeout) or when the plugin instance that registered
the handler is reloaded, disabled or removed. Callers of a disposing instance
still waiting when the dispose drain ends are released with an error; the
handler keeps running until it observes the signal, and later use of its API
handle throws a contained stale-handle error.

Core path: the same per-instance lifetime drives CLI `ctx.signal` and the
release of disposed instances' route, RPC, CLI and event-handler callers.
bb's own RPC callers (connect revoke and status, git reads) pass no request
signal and get only the lifetime part.

Docs: `backend-sdk.md`, `backend-ui-lifecycle.md`.

Before stabilizing, audit whether HTTP route and thread event handlers need
the same signal in a typed context, and whether a deadline (not only
cancellation) belongs in the context.

## Mention search cancellation (`PluginMentionSearchContext.experimental_signal`)

Every `bb.ui.registerMentionProvider` search receives an `experimental_signal`
that aborts when the search request disconnects (the composer cancels a query
the person has typed past), when the 2s time box runs out, or when the plugin
instance is reloaded, disabled or removed. Each provider runs one search at a
time; only the newest query typed meanwhile waits, and a waiting query whose
request disconnects never starts. Aborting a running search lets that waiting
query start as soon as the provider settles. The host ignores whatever an
aborted search returns.

Core path: `GET /api/v1/plugins/mentions/search` forwards its request signal to
the plugin service, which links it with the time box and the instance
lifetime through the same `invokeWrapped` caller signal as RPC handlers. Docs
checks the signal between vaults.

Docs: `backend-ui-lifecycle.md`.

Before stabilizing, audit it together with the RPC handler signal: whether
every host-called handler should take one typed context with the signal, and
whether a deadline belongs next to it.

## `bb.http.experimental_websocket`

Registers an exact-path WebSocket upgrade in the plugin's
`/api/v1/plugins/<id>/http/` namespace. It shares HTTP route auth modes.
Sockets from a replaced or disabled plugin generation close with code 1012.
The test harness drives it with `experimental_openWebSocket`.

Docs: `backend-events.md`, `testing.md`.

**Audit before stabilizing.**

1. Confirm the HTTP namespace and exact-path rule cover plugin proxy use cases
   without a separate WebSocket namespace or parameterized routing.
2. Decide whether subprotocol negotiation belongs in the context or returned
   handler contract.
3. Confirm string and `Uint8Array` are sufficient for frame data and sends.
4. Confirm code 1012 is the right reload/disable signal and whether plugins
   need a distinct disposal reason.
5. Confirm the callback error policy should keep the socket open after an
   isolated message-handler failure.

## `bb.providers.experimental_contributeEnvHealth`

Registers one host-scoped readiness resolver beside a provider environment
contribution. When the bridge reports `unauthenticated` or `expired`, a
non-null answer presents the provider as ready with its label and status
message.

Docs: `providers.md`.

**Audit before stabilizing.**

1. Confirm readiness should override only `unauthenticated` and `expired`, not
   installation or unknown failures.
2. Decide whether the contribution should report account identity or usage in
   addition to a label and status message.
3. Confirm the first available resolver in plugin load order is the right
   arbitration when several credential proxies target one provider.
4. Confirm a five-second timeout is appropriate for host-scoped credential
   availability checks.

## `bb.providers.experimental_contributeEnv`

Registers one resolver per provider per plugin that returns up to 32
environment entries for each session and turn, and for model catalog listing
with a `null` thread and project. Each entry is a literal or a
server-relative path the host expands. Conflicts resolve in plugin load
order, and the values override the shell environment.

Docs: `providers.md`.

**Audit before stabilizing.**

1. Confirm one resolver per provider is sufficient when plugins need multiple
   independently disposable features.
2. Confirm plugin load order is the right deterministic conflict policy.
3. Confirm the 32-entry cap and five-second timeout fit providers that resolve
   short-lived credentials.
4. Decide whether `serverPath` needs structured query parameters or non-HTTP
   server endpoints before accepting more shapes.
5. Confirm `reason` should remain required and whether event consumers need a
   stable machine-readable purpose beside it.
6. Decide whether the context and entry types should stabilize with the method
   or remain experimental for a longer compatibility window.

## Compatibility windows

Open windows left by the SDK 0.4.16 stabilization renames. The bb-app
CHANGELOG records the renames themselves.

- Renamed declaration, tool and navPanel fields (`experimental_strings`,
  `experimental_presentation`, `experimental_fixedTabs`, …) are rejected at
  registration with a message naming the new field.
- Presentation-less `toolCall` rows pass through the legacy-data adapter
  (`upgradeLegacyToolItem` in `@bb/domain`). It renders Read/Grep/Glob and
  read/grep/find/ls as `fileRead`/`search` rows and suppresses
  Task*/Todo*/ToolSearch bookkeeping calls. The pi bridge's live generic
  `tool` rows still take this path. To close the window, pi stamps
  `fileRead`/`search` presentation, the `legacy-tool-item-backfill` migration
  stamps old rows, and `presentation` becomes required on
  `item.open`/`item.close`. Then the adapter and its tests are deleted.

## Scheduled removals (next major)

Unprefixed exports of `@get-bb/plugin-sdk/provider-bridge` with no consumer in
this repository. They stay because a third-party bridge compiled against an
SDK before 0.4.16 may import them, and dropping a published name is a
breaking change. Remove them at the next major version. The
`provider-bridge-scheduled-removals` SDK test holds the facade to this list.

Re-exported from `@bb/domain`, where each still has core consumers:

- `acpNativeReasoningSchema`
- `acpPermissionCliSchema`
- `acpReasoningCliSchema`
- `extensionKindSchema`
- `interactionRequestPayloadSchema`
- `isExtensionKind`
- `isUserQuestionPendingInteractionPayload`
- `isUserQuestionPendingInteractionResolution`
- `providerRecoveryKindValues`
- `threadEventItemPresentationSchema`
- `threadEventSearchModeSchema`

Aliases of moved definitions. The ACP pair aliases the ACP kit's
`experimental_acpLaunchSpecSchema` / `AcpLaunchSpec` and normalizer
(`@get-bb/plugin-sdk/provider-bridge/acp`). The task-tool pair has no
replacement.

- `hostDaemonAcpLaunchSpecSchema`
- `normalizeHostDaemonAcpLaunchSpec`
- `claudeTaskToolNameSchema`
- `claudeTaskToolOutputSchema`
- `HostDaemonAcpLaunchSpec`
- `ClaudeTaskToolOutput`

Also kept only until the next major:

- On `@get-bb/plugin-sdk/provider-bridge/acp`, `AcpAgentProfile`, a deprecated
  alias of `AcpLaunchSpec`.
- On `@get-bb/plugin-sdk/provider-bridge/testing`,
  `CONFORMANCE_ASSEMBLED_EVENT_METHOD`. The conformance kit assembles
  `thread/delta` itself and reads nothing under that method.
- The `disallowedTools` field of `threadStartParamsSchema`,
  `threadResumeParamsSchema` and `threadForkParamsSchema`. The runtime never
  populates it.

`experimental_useSidebarThreadActions` and `PluginSidebarThreadActions`
(`@get-bb/plugin-sdk/app`), with the testing harness's `SidebarActionCall` /
`inspection.sidebarActionCalls`, are superseded by the thread action
registry, `experimental_useThreadRequests()` (whose calls `archive` and
`requestDelete` now alias), `useSdk().threads`, and
`useBbNavigate().toThread` / `toCompose`;
`experimental_archiveEnvironmentThreads` moved to
`experimental_useArchiveEnvironmentThreads`. Like `useComposerView` they are
`@internal`: published declarations drop them, while the runtime keeps
implementing them for installed plugins. Nothing in this repository calls
them, but about 31 community plugins still call them at runtime
(ahmedhesham6/bb-plugin-treelanes, brsbl/bb-plugins, bitcomplete/bb-plugins
among them).

`useComposerView` (`@get-bb/plugin-sdk/app`) is `@internal` and superseded by
`useComposer()`. Core still uses the hook internally
(`PluginComposerActions.tsx`), but no plugin in this repository calls the
export. About 28 community plugins still do (bitcomplete/bb-plugins,
bottlebrushes/bb-simple-summaries, braedonsaunders/bb-plugin-ultragoal among
them), and nothing warns them at build time. Remove the export at the next
major.

The deprecated `app.slots.commandPaletteAction` is an alias of
`app.commands.register` with the same registration and command registry. No
bundled plugin calls it; about 22 community plugins still do
(architawr/bb-plugin-workbench-explorer, bottlebrushes/bb-simple-summaries,
calionauta/bb-plugin-stelow among them). Remove it at the next major; callers
switch to `app.commands.register`.

The composer handle's `@internal` aliases `experimental_submit`,
`experimental_setSelection`, `experimental_onSubmitted` and
`experimental_removeMention` (`PluginComposerApi` in `app-contract.ts`) warn
once at runtime (`internal/composer-handle.ts`) and forward to `submit`,
`setSelection`, `onSubmitted` and the legacy `removeMention`. No bundled
plugin calls them; about 5 community plugins do (MacHatter1/bb-plugin-souls,
SawyerHood/sawyer-plugins, VKirill/bb-plugin-project-folders among them).
Remove them at the next major; callers switch to `submit`, `setSelection`,
`onSubmitted` and `replace`.

`PluginThreadListProps.searchQuery` is `@internal` the same way. The sidebar
search field it carried is gone, so the host passes `""`. Lists built against
older SDKs still read it (often `searchQuery.trim()`), so the runtime keeps
passing it until the next major.

## Settings schemas and server writes

`PluginSettingDescriptor.experimental_schema` is a synchronous,
non-transforming Standard Schema validator. The server runs it on every
proposed value. `PluginSettingsHandle.experimental_set` validates and persists
the plugin's own fields, like a settings route or `bb plugin config` write.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

- Confirm synchronous, non-transforming validation remains sufficient.
- Decide whether settings errors need structured issue paths in addition to
  the first user-facing message.
- Confirm schemas should continue running for defaults at registration.
- Exercise concurrent route, CLI, and plugin-owned writes, including secret
  values and unsets, before stabilizing `experimental_set`.
- Decide whether schemas and server-side writes stabilize independently.

## `PluginSettingDescriptor` type `"number"`

A numeric setting descriptor stores a finite `number`, renders a number
input, converts CLI values, and reads legacy numeric strings as numbers.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

- Decide whether common minimum, maximum, and step metadata belongs directly
  on the descriptor instead of only in `experimental_schema`.
- Confirm clearing a number input should continue to unset the stored value.
- Decide how long legacy stored numeric strings should be coerced on read.
- Exercise decimal and exponent input across browser engines and the CLI.

## `bb.experimental_hooks` (`on`, `recheck`)

`on("message.dispatch", handler)` answers core's admission checkpoint before
every message reaches a provider. A handler returns `proceed`, `wait` (queue
the message with a reason and optional `sendAt`), or `reject` (409).
Handlers run as a fail-closed chain in install order under one server-wide
lock. `recheck("message.dispatch")` schedules a re-attempt of every
plugin-queued row and resolves when the walk is scheduled.

`on("thread.delete_finalize", handler)` runs before the `thread-purge` sweep
starts removing a deleted thread's rows. The context names the thread and its
project. `proceed` lets the purge start; `wait` keeps the rows, and core asks
again on every purge pass (about every 10 seconds) and after every restart.
A throw, a timeout or an unknown answer counts as `wait`. A disabled or
uninstalled plugin is not asked. No purge starts while the startup load pass
is still registering plugins, and core never asks again once a purge has
started (`thread_purges.started_at`). Until then the thread is hidden and
can no longer change, and `threads.experimental_export` still reads it.
`recheck("thread.delete_finalize")` schedules nothing. Core caller: every
purge, including the deletes a user makes. Plugin caller: Storage & retention
keeps a copy of the threads it moves to cold storage.

Docs: `backend-events.md`, `backend-sdk.md`.

**Audit before stabilizing.**

- **Grouped dispatch authors.** `initiator`, `senderThreadId`, `origin` and
  `originPluginId` summarize every row in `queuedMessages`, and report
  `mixed` when the rows disagree. Verify plugins handle mixed origins
  independently of authors.
- **`queuedMessage` is emitted but untyped.** Core still emits the first
  queued row or null under the old name for previously built handlers. Remove
  that field and its shim before stabilizing.
- **`startedOnBehalfOf` is emitted but untyped.** Core still sets it on the
  context for handlers built against an older SDK. Drop the context field and
  its shim before stabilizing. The queued row's internal
  `requested_by_initiator` / `requested_by_thread_id` are unaffected.
- **Two hooks, two rule sets.** `message.dispatch` is a fail-closed chain
  under one lock; `thread.delete_finalize` treats every failure as `wait` and
  takes no lock. Confirm one `on(hook, handler)` signature still reads clearly with
  rules this different.
- **A purge wait never expires.** A plugin that keeps answering `wait` keeps
  the thread's rows in `bb.db` for as long as it stays enabled. Decide whether
  core should cap it or surface stuck purges.
- **`wait` returns no row id.** The id arrives later on `message.queued`, so a
  plugin that must act on its own wait correlates by ordering or re-queries
  `threads.queue.list({ waitHolder })`. Decide whether the decision should be
  able to name a correlation key.
- **A wait has no plugin-driven release, only a plugin-driven re-ask.**
  `recheck` names no row, so one resolved condition wakes every plugin-queued
  row and every handler re-decides. Confirm the whole-queue walk is still
  right with many plugin waits and waiters, and decide whether a scoped
  variant is worth the correlation problem it reintroduces.
- **`recheck` is unauthenticated in both directions.** Any plugin can wake
  rows held by any other, and core does not tell a handler why it is being
  re-asked. Confirm no plugin needs to distinguish "core's clock" from
  "somebody asked".
- **Resolving on schedule is a contract.** A caller cannot await the walk, so
  it cannot observe whether its own row went. Confirm resolving on completion,
  with its lock-reentrancy hazard, is genuinely unwanted rather than merely
  unbuilt.
- **`wait`'s old `sendAt` name.** The re-ask instant was named `sendAt`,
  which read as the message's schedule. It is now `recheckAt`; the server
  still maps a `sendAt` from previously built plugins and refuses a decision
  that sets both. Remove the alias before stabilizing.
- **Send-now bypasses every plugin check**, including a content-policy
  `reject`. Confirm it, or split `wait` bypass from `reject` bypass.
- **"Never started" is a thread status.** Confirm `pending` is maintained
  everywhere the old event-log probe was consulted.
- **The context DTOs.** `thread`, `project`, `environment`, `host` and
  `queuedMessage` are public DTOs; confirm they are what a plugin should
  couple to.
- **The single server-wide lock.** One slow handler delays every dispatch in
  the server, up to its 10 s box.

## `interaction.pending` (`bb.events.on`)

Fires after core commits a pending interaction. It carries the public thread
and pending interaction DTOs and is observe-only.

Docs: `backend-events.md`.

**Audit before stabilizing.** Confirm that all plugins should receive provider
and plugin interaction details. Confirm that the full interaction DTO remains
the correct payload instead of an id that requires a fresh SDK read. Decide
whether this event needs matching resolved, cancelled, or interrupted events.

## `message.queued` / `message.dispatched` / `message.cancelled` / `turn.failed` (`bb.events.on`)

These are observe-only announcements. `message.queued` (on first queue and on
every rewritten wait) and `message.dispatched` carry the `ThreadQueuedMessage`
DTO. `message.cancelled` fires when a queued row is deleted before dispatch.
`turn.failed` carries ids and failure facts after a thread lands in `error`,
including `originPluginId`, the plugin that sent the failed message. Provider
retry uses it to decide and queue retries, then publishes the decision through
its `decision.get` RPC; Automations and Workflows wait for that decision before
re-running failed work.

Docs: `backend-events.md`.

**Audit before stabilizing.** These are not the only non-thread events on
`bb.events.on`: `interaction.pending`, `experimental_environment.removed`,
`experimental_terminal.input` and `experimental_host.deleted` share the same
`PluginThreadEventPayloads` map. Renaming `PluginThreadEventPayloads` and
`PluginThreadEventHandler` project-wide is part of stabilizing. Decide whether
every plugin should see every queued row (today it does, and filtering on
`entry.waitingOn` is the documented pattern) or only rows whose wait it owns.
Decide whether `message.queued` firing on every rewritten wait is what a
listener wants, or whether a separate `message.updated` belongs alongside it.
The timeline event already distinguishes the two. Rows that vanish with their
thread fire the thread event instead of `message.cancelled`. Confirm that
split is the teardown signal a plugin holding resources for a waiting message
needs. For `turn.failed`, confirm the payload answers every question a retry
policy asks without replaying the event log. Attempt caps are entirely the
plugin's; core enforces no ceiling beyond one live retry row per original
request.

## `bb.experimental_environments` (`register`, `recheck`)

Registers an environment provider: a named place threads run. Ids are flat
and first-wins, and the persisted owner plugin is the only one that can
recover or remove its resources. It declares `requires` eligibility facts,
Standard Schema `inputs`, optional `validate`, and durable `create`/`remove`
resource operations that core drives. `recheck` schedules another pending
launch attempt for every thread waiting on one of the calling plugin's
providers. No plugin calls it yet. The built-in checkout, worktree and
personal workspace behaviors are first-party plugins.

Docs: `backend-events.md`.

**Audit before stabilizing.**

1. **Requirement vocabulary.** `requires` has four booleans, each a fact core
   evaluates before the thread exists; everything else goes through `inputs`.
   Decide whether the next fact fits that shape, and whether `gitCheckout`
   should carry more than "a git repository with commits", before it is
   frozen.
   1a. **Inputs at the boundary.** The schema is plugin code core runs inside
   the request: a slow or throwing schema costs the request, and the JSON
   Schema conversion happens once at registration and may fail load. Decide
   whether core should bound the parse, and whether the row should store the
   raw request value alongside the parsed one so a schema change can re-parse
   it.
2. **Single-provider invocation.** Confirm asking the one named provider (vs.
   the `message.dispatch` chain) stays the right model once several provider
   plugins ship, and that the "not registered" wait + backoff is the right
   degradation for an uninstalled plugin.
3. **Undeclared facts: `branchName()` and `projectCheckout`.** Every create
   can ask for a branch name built from the thread title and
   `managedBranchPrefix`, and gets the project's checkout on its machine,
   whether or not the provider uses them. Decide whether both belong on the
   context for everyone or behind a declaration flag, and whether a path is
   all a provider needs to know about a checkout it did not make.
4. **Durable operations.** Audit cancellation races, provider reload during
   work, and restart checkpoints against the environment-provider contract
   below.
5. **Compatibility fields.** `managed`, `isWorktree`,
   `workspaceProvisionType` and the display kind carry no `@deprecated` tag
   and no removal cycle is defined. Core and bundled plugins still read them
   (`apps/app` `thread-screen-hosts.ts`, thread-list
   `project-thread-groups.ts`, storage-retention `storage.ts`); migrate those
   readers before deprecating the fields.
6. **Context versions (`apiVersion`).** The public types offer only version
   2: declarations require `apiVersion: 2`, and contexts carry
   `environment: { id, name, projectId }` instead of a thread. Providers
   built before it (no `apiVersion`) still run; their types live in
   `@get-bb/plugin-sdk/internal/host-policy` (`PluginEnvironmentProviderV1*`),
   and registering one reports a plugin problem asking the author to migrate.
   Core keeps one implementation and adapts at the call boundary
   (`invokeCreate`/`providerRestoreCall`/`versionOneOperation` in
   `apps/server/src/services/environments/environment-engine.ts`, the
   validate call in `thread-environment-placement.ts`, and registration in
   `host-policy.ts`). For version 1 it adds `thread`, sets
   `suggestedBranchName` to the awaited `branchName()`, adds
   `experimental_claimPath(path)`, shows `projectCheckout.ownsPath` as
   `experimental_ownsPath`, turns `experimental_existingPath(inputs)` into a
   `locate` that answers `{ path, reuse: true }`, and, as before, folds a
   version-1 create whose path another environment already has into that
   environment (version 2 must locate it instead); it refuses version-1
   providers for environments created without a thread. Path keys are derived
   the same way for both (thread-based when a thread drives the create,
   environment-based otherwise). Delete the version-1 adapter, its internal
   types, the `per-thread` path-key value and the migration problem when this
   API stabilizes; all first-party providers are on version 2. Core's thread
   creation and thread-less creation both go through the same adapter.

## `@get-bb/plugin-sdk/environment-provider`

Exports the resource-operation contract for
`bb.experimental_environments.register`. It also exports optional
`availability(context)` and `restore(context)`. `availability` is cached per
project and machine, re-checked at thread creation, and reported to pickers
as `machineAvailability`. `restore` is the only way core rebuilds a destroyed
environment.
Version-1 providers keep `experimental_claimPath(path)` at runtime, which
durably reserves a host path on the launch row before mutation and resolves
false for competing claims or stale attempts. Values keep their prefix, and
named types are unprefixed.

Docs: `backend-events.md`.

**Audit before stabilizing.** Verify monotonic attempts and path-key recovery
across cancellation/restart; per-environment removal serialization; retry
caps and timing defaults (5 minutes/60 seconds/30 seconds/3/per-thread/null);
resource privacy and the 16 KiB boundary; create-timeout aborts; and the
read-only lifecycle projection. Decide whether restore should stay a separate
method or become a create mode. Decide whether a provider needs a way to
decline before the restore button is offered (git worktree fails after the
click when no branch was recorded). Decide when to stop passing the retired
`rebuild: false` / `previous: null` create fields at runtime. Audit
availability message ownership, create-time error presentation, the
interaction between the `requires` floor and provider decisions, and whether
the current decision timeout is appropriate.

Providers call core's steps instead of core running them at fixed points. These are members of contexts that `bb.experimental_environments`
providers receive, so they carry no nested `experimental_` prefix.

- `branchName()` replaces `suggestedBranchName` and rejects when the
  operation aborts. Core starts title generation
  for every new thread and never waits for it; `branchName()` resolves to
  `<prefix><slug(title)>-<threadId>` once the title settles (generated,
  provided or fallback), and at once to `<prefix><slug(name)>-<id>` or
  `<prefix><id>` for an environment without a thread. Callers: Worktree
  (names the branch after setup starts) and Project checkout (new branch).
- `setup(path)` is a durable request: core claims and binds `path`, records
  it as provider-owned, and applies `provision.requested` (`creating` →
  `provisioning`). The thread attaches, and the existing attach operation
  runs setup through `runEnvironmentHook`. `environments.create_pending`
  marks a create that has not returned: the attach operation waits for create
  before it inspects the workspace, so the environment becomes `ready` and
  the thread starts only after create returns `created` with the same path.
  A restart with setup finished and create pending re-runs create and skips
  setup. Without a call, core runs setup after create, as before. Setup on
  the path of an environment `locate` named is refused before anything is
  bound. Stopping the only thread of an environment whose create has not
  returned aborts the create and removes the environment, and the thread
  goes back to its provider request. Caller: Worktree's cold create.
- `locate({ host, projectCheckout, inputs })` answers `{ path, reuse }` or
  null before create, replacing `experimental_existingPath`. Core checks
  path admission and claims the path on the reservation; `reuse: true` joins
  the environment at `path` as it is, otherwise create runs on a fresh
  reservation, core refuses it while another live thread uses that
  environment, and folds the result into it only when create returns the
  located path. A create that returns another environment's path it did not
  locate fails ("Workspace … already belongs to environment …"). Callers:
  Project checkout (`reuse` unless a branch is requested) and Worktree
  (adopting an existing worktree).
- `experimental_claimPath` is gone from the public contexts: core now claims
  the located path itself, which was the only reason Project checkout called
  it, and the post-create bind claims any produced path. Version-1 providers
  keep it at runtime through the adapter.
- `projectCheckout.ownsPath` replaces `experimental_ownsPath`:
  a provider decides `ownsPath` in its result from whether bb cloned the
  checkout, and only core knows that. Caller: Project checkout.

Before stabilizing, decide whether `locate` should also see the project and
machine selection, whether a failed create should be able to hand core a
resource (a provider that named a branch before failing must clean it up
itself), and whether core should record the branch a provider owns; today
the Worktree keeps it in its private resource and core has no reader.

## Environment folders (`PluginEnvironmentProviderCreateResult.additionalPaths`, `Environment.additionalPaths`)

A `created` result from `create` or `restore` may carry `additionalPaths`:
absolute host paths of the environment's own extra folders, such as sibling
checkouts the provider made next to `path`. Core canonicalizes them and fails
the create when one is relative, equals `path`, is inside `path`, contains
`path`, or repeats another entry (at most 64). They are stored on
`environments.additional_paths` and returned as `Environment.additionalPaths`
(`[]` when the provider sends none). Omitting the field on a reused
environment keeps the recorded list. At every session start, turn and steer
the server merges them after the project's folders for the thread's machine
(`bb project folder`), drops duplicates and the main folder, and sends the
list to the daemon, which grants the agent write access for that turn; the
agent's instructions list the folders as of its session start. The field is a member of a result type, so it carries no
nested `experimental_` prefix.

Core path: `environment-engine.ts` records the field for every provider,
including the built-in Worktree and Project checkout, which return none
today; `thread-runtime-config.ts` is the only reader.

Before stabilizing, decide whether a provider needs to change the list after
create (today only a restore replaces it), whether removal should be told
about the folders, and whether the Worktree should report worktrees it makes
of a project's folders.

## `app.slots.experimental_environmentProviderInputs`, `experimental_BranchPicker`, `experimental_useBranches` and `experimental_useCheckoutState` (`@get-bb/plugin-sdk/app`)

The slot registers `{ environmentProviderId, component }`, the control the
New Thread environment picker renders beside that provider. Its props are
`{ projectId, target, value, onChange }`. `target` is
`{ kind: "existing-host", hostId }` or `{ kind: "new-host" }`. The control
reports `{ status: "ready", value }` or `{ status: "blocked", reason }`.
Inputs are persisted and readable by every plugin, so they must hold no
secrets. The branch picker, branch hook and checkout-state hook are the host's
branch and checkout primitives for such controls.

Docs: `frontend-components.md` (environment row, branch and checkout
primitives). Only the API index names the slot registration itself.

**Audit before stabilizing.**

1. **Slot placement.** The control renders where the branch picker sits.
   Confirm that stays right for providers with larger configuration (a dialog
   escape hatch?) before freezing.
2. **Validity channel.** Confirm ready/blocked remains sufficient and decide
   whether the picker should run the published JSON Schema client-side before
   submit.
3. **Branch API breadth.** Confirm the picker props and branch-hook result
   stay sufficient for providers, with branch loading, search and remote
   refresh owned by the host and selection models owned by the plugin.
4. **Missing slot.** A provider whose schema requires non-empty input and
   whose app entry registers no slot cannot be picked from the app (the CLI
   can still send `--environment-inputs`). Decide whether load should refuse
   that pairing.
5. **Mount-time default.** A control that wants the row submittable at once
   reports ready from an effect on mount. Decide whether the registration
   should instead declare a default value.

## `app.slots.experimental_machineProviderInputs` (`@get-bb/plugin-sdk/app`)

Registers `{ machineProviderId, component }`, a compact control for one
machine provider's inputs. It renders in the New Thread toolbar when a
selected composition declares machine inputs. The component receives
`{ value, onChange }` and reports ready JSON or a blocked reason. The value
must contain no secrets.

Docs: `frontend-components.md`.

**Audit before stabilizing.** Confirm the compact-chip and responsive-drawer
shape works across machine providers, that ready/blocked is sufficient, and
that provider changes and crashed controls cannot retain stale launch inputs.

## `bb.experimental_machines` (`register`)

Registers a project-independent machine provider: required id, displayName,
description, icon, `create`, `reconcileCleanup` and `remove`; optional
`ephemeral`, Standard Schema inputs, availability, validate, and paired
suspend/resume. Core owns enrollment, durable launches, cleanup retries and
lifecycle transitions. Plugins own allocation, filesystem preservation and
idle policy. The lifecycle context's `checkpoint(resource)` persists a
bounded (16 KiB), credential-free recovery record.

Docs: `backend-machines.md`.

Before stabilization, verify registration validation, creation-key ownership,
interrupted allocation cleanup, checkpoint rejection, resource privacy,
removal serialization and same-identity restoration. Machine lifecycle uses
removing; removal retry timing is internal, not a public retirement policy.
The checkpoint requires real-DB crash recovery after allocation and before
bootstrap, competing lifecycle operations, wrong-owner rejection and no
duplicate enrollment. Standalone SDK submit/launch/follow/cancel must match
CLI create/status/cancel.

## `@get-bb/plugin-sdk/machine-provider`

Exports the machine provider's definition, input, availability/validation,
create and lifecycle context, progress, and resource/removal types. These
supporting declarations belong to the experimental machine namespace, so
their unprefixed names do not mean they are stable.

Docs: `backend-machines.md`.

Stabilization follows `bb.experimental_machines` above.

## `bb.branding.experimental_icons` (manifest) and namespaced presentation glyphs

A manifest map from names to plugin SVG files. Timeline presentation glyphs
and provider `icon` may reference an entry as `"<pluginId>/<name>"`. The map
is validated at build and load. Ingest rejects a glyph that is not the
emitting plugin's own declared icon. `bb.branding.icon` refuses the namespaced
form.

Docs: `quickstart.md` (manifest and SVG rules), `providers.md` (provider
icons), `backend-cli-agents.md` (tool presentation).

**Audit before stabilizing.** Decide whether the key becomes `icons`. The
strict manifest schema makes that rename breaking, so the stabilization
release must accept both for one release. Decide whether `bb.branding.icon`
should resolve a self-referencing namespaced glyph through the map instead of
refusing it. **Open question for a major release:** whether to tighten logos
and provider icons at install and load, to the build rules or to the full
declared-icon rules. Today logos are checked only at build for script
vectors, and `nosniff` plus a `default-src 'none'` CSP keep served files
inert. Either tightening fails installed plugins whose artwork is an ordinary
tool export. It therefore needs an audit of installed marketplace and
third-party logos and a migration window first. Decide whether a full-colour
mode (`{ path, mode }` values) is wanted; today every icon is a monochrome
mask. Decide whether `toolUse` approval presentations are checked at ingest
too (today only timeline rows are). Settle whether a row persisted with a
namespaced glyph should ever be rewritten when the plugin renames or removes
the icon; today it simply falls back.

## `experimental_buildBridgeToolCallContent`

**Kept experimental (2026-08-22).** Drop the legacy input and settle the image
policy, then stabilize.

Converts a decoded bb tool-call response into the ordered text and
inline-image content blocks that MCP and Pi tool results accept. It takes
ordered `contentBlocks` or the legacy aggregate `{ content, images }`.

**Audit before stabilizing.** Confirm that MCP and Pi continue sharing this
content-block vocabulary; decide whether legacy aggregate fields still need to
be accepted; and define any image MIME validation, decoding, or payload-size
policy at the server boundary.

## The ACP bridge kit (`@get-bb/plugin-sdk/provider-bridge/acp`)

**Kept experimental (2026-08-22).** Five members remain, each with an open
question below. The kit grows with a consumer, not ahead of one.

`experimental_acpProviderBridge` is the generic Agent Client Protocol bridge a
plugin re-exports, backed by `packages/provider-bridge-acp` (the official
`@agentclientprotocol/sdk` transport, turns for agent-started work, slash
commands and session options as bb thread state, elicitation forms as
question cards, sign-in guidance from advertised auth methods). It launches
the agent named by `providerOptions.acpLaunchSpec` with the dialect named by
`acpDialect` in bridge options. `experimental_probeAcpAgent` asks an installed
agent for its `agentCapabilities`, and `experimental_acpAgentProbeSchema`
validates the answer across a host RPC boundary.
`experimental_acpLaunchSpecSchema` / `AcpLaunchSpec` is the launch spec the
bridge parses.

`experimental_registerAcpDialect` adds a dialect. A plugin calls it at module
load in its `bb.host` artifact with an `AcpDialect` and names the id as
`acpDialect` in its registration. Empty and built-in ids (`acp`, `cursor`,
`grok`, `omp`, `opencode`) throw, re-registering an id replaces it, and an
unregistered id resolves to the generic dialect. bb's own dialects resolve
through the same registry (`resolveAcpDialect`).

`@get-bb/plugin-sdk/provider-bridge/acp-next`, the subpath the kit was
previewed under (2026-10-09), re-exports this kit unchanged and is
deprecated. Each subpath is bundled with its own dialect registry, so a
plugin must import every member from one of them. Remove it at the next
major.

Docs: `providers.md` (ACP agents), `provider-bridge-api-index.md`. The Plugin
Guide lists the probe and launch-spec symbols, but no doc describes their
contracts.

**Audit before stabilizing.** Decide what `probeAcpAgent` owes a caller.
Today it spawns the agent with a caller-chosen `timeoutMs` (10 s when
omitted), advertises the bridge's own client capabilities, and answers
`-32601` to anything the agent asks. Settle whether the client capabilities
and the refusal are the caller's to choose. Decide whether `AcpDialect` is
the right shape for a third-party agent: its hooks are optional and unversioned, so a new one is a silent
capability change for every dialect. Decide whether a dialect should be named
by value in the provider registration instead of by id. Settle whether the
bridge and its dialect registry should be a factory rather than a module
singleton before a host artifact needs two configured differently. For
`acpLaunchSpecSchema`, the shape is stored in the ACP plugin's `customAgents`
setting and in registrations' bridge options. A change therefore migrates
stored agents; decide what a plugin is owed when the spec grows a field.

## `PluginProviderDeclaration.experimental_nativeSkillRoots`

**Kept experimental (2026-08-22).** No third-party agent has validated the
relative-path / 32-root rule or the per-root options, and the split from the
per-workspace resolver is new.

Names the directories a provider's agent reads skills from: `user` relative
to the host home, and `project` relative to the workspace. bb lists those
skills beside its own.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

Decided (2026-08-22): there is no `absolute` side; host-specific roots go
through `experimental_resolvesNativeRoots`.

**Audit before stabilizing.** Decide whether the two-bucket shape (`user`,
`project`) is the right vocabulary or whether a root should name its own base
explicitly. Confirm the 32-root cap and the relative-path rule against a real
third-party agent. Decide whether this belongs on the declaration at all or
should be reported per host by the bridge, since where an agent keeps its
skills can differ per machine (today that difference is the resolver's job).
Audit whether the per-root options and symlink boundary rule are the right
vocabulary, or whether a root should carry a shape like the resolver's answer
does.

## `PluginProviderDeclaration.experimental_nativeCommandRoots`

The same two-sided declaration, with the same per-root options, for flat
directories of `*.md` slash-command prompt files.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

**Audit before stabilizing.** Decide whether commands and skills should stay
two declarations or become one list of typed roots; confirm that a flat
`*.md` directory is the only command layout a third-party agent needs.

## `PluginProviderDeclaration.experimental_resolvesNativeRoots`

Declares that the plugin's `bb.host` entry serves
`resolveNativeRoots({ providerId, cwd })`. bb scans the answer beside the
declared roots (cached ten seconds). A failed answer yields no resolved roots
and never fails the listing.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

**Audit before stabilizing.** Decide whether the flag should exist at all or
whether the server should detect the method on the host entry; and settle
the cache TTL and the invalidation set against a real multi-host setup.

## `experimental_nativeRootsHostContract` (`@get-bb/plugin-sdk/host`)

The one-method host RPC contract (`resolveNativeRoots`). Input is
`{ providerId, cwd: string | null }`. Output is `{ skills, commands }`, each a
list of host-absolute roots with `origin`, `recursive`, `ancestors`,
`namePrefix`, and a `shape` that tells the daemon how to read the root.
The two Zod schemas are exported too
(`experimental_nativeRootsResolveInputSchema`,
`experimental_nativeRootsResolveOutputSchema`); the first-party providers'
resolver tests validate against them.

Docs: `providers.md`.

**Audit before stabilizing.** Confirm the shape vocabulary covers a
third-party agent's layouts; decide whether the contract should accept a
relative path the daemon resolves (so a plugin need not know the host home)
and whether the 256-root cap per side is right.

## `experimental_filterResolvedNativeRoots` (`@get-bb/plugin-sdk/host`)

Checks a `resolveNativeRoots` answer root by root against the contract. It
drops each failing root with a warning, and truncates a side past 256 roots,
so one bad root cannot void the whole listing.

Docs: `providers.md`.

**Audit before stabilizing.** Decide whether the per-root leniency belongs in
the contract's output schema itself (drop at the boundary, report the drops
in the answer) so a plugin cannot forget to call the helper, and whether
`dropped[].reason` is a contract a resolver's test may pin or free text for
the log.

## Vendor plugin roots (`experimental_resolveClaudePluginRoots` and `experimental_resolveVendorPluginRoots`, `@get-bb/plugin-sdk/host`)

`experimental_resolveVendorPluginRoots({ plugins, layout })` walks vendor
plugin directories into native roots with `namePrefix: "<plugin>:"`.
`layout: "claude"` reads each plugin's root `SKILL.md`, `skills/`, `commands/`,
then its manifest `skills` and `commands` entries. `layout: "grok"` reads only
the manifest entries, each recursive.
`experimental_resolveClaudePluginRoots({ cwd, homeDir, env })` reads Claude
Code's installed-plugin registry and enablement settings and runs the walk.
Its answer also carries `claudeDir`. Two shared rules apply. User-origin
plugins follow skill symlinks, project-origin plugins do not, and command
components never follow links. Within an answer each path appears once per
side, and the first root to claim it wins.

**Audit before stabilizing.** Decide whether the walk should keep taking a
layout name (`claude`, `grok`) or the two facts behind it (conventional roots
on or off, directories recursive or flat) once a third vendor layout appears;
whether `claudeDir` belongs on the answer or the reader should also answer the
config directory's own roots; whether a skills-only caller should be able to
ask for one side; whether the repeated-path rule should be the contract's
(drop at the boundary, first root wins) rather than each helper's; and whether
a plugin's `name` should be validated as a name prefix here instead of at
`experimental_filterResolvedNativeRoots`.

## `PluginSettingDescriptor.experimental_multiline`

A `type: "string"` descriptor flag that renders a multi-line monospace editor.
The stored string is unchanged. A descriptor that combines it with
`secret: true` is refused.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

1. **Name and shape.** Decide whether to stabilize as a boolean `multiline`
   or replace it with a `json` descriptor type that validates at the boundary
   (pretty-printing, parse errors shown in the form, a typed value from
   `settings.get()`), which would make this flag redundant for its first
   consumer. A `multiline` boolean still has a use for plain lists, so the two
   may coexist.
2. **Mobile.** Confirm that phones need the editor at all (a JSON array is
   hard to type on a soft keyboard), or whether the mobile form should show
   the value read-only with an "edit on desktop" note.
3. **Unknown descriptor fields.** The strict client schema turns every new
   presentation hint into a client release. Decide whether descriptor schemas
   should tolerate unknown fields so a hint degrades to the one-line input on
   an older client instead of failing the whole settings view.

## `bb.sdk.threads.experimental_listPluginMetadata`

`POST /threads/plugin-metadata` with `{ pluginId, threadIds }` (1–200 ids)
returns `{ threads: { threadId, metadata }[] }` for each thread holding that
plugin's namespace, archived and deleted threads included, in one indexed
query; threads without a namespace and corrupt namespaces are omitted. The
plugin-bound SDKs default `pluginId` to the caller. First caller:
push-notifications' Notifications thread action.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Route binding.** Any caller can read any plugin's namespace, as with
   the single-thread metadata routes. Decide whether plugin requests should
   carry an identity the routes can enforce.
2. **Batch size.** 200 ids per request; callers chunk. Revisit if the
   attributes layer replaces per-registration reads.

## `experimental_useExperiment` (`@get-bb/plugin-sdk/app`)

`experimental_useExperiment(key)` returns whether the bb experiment `key` is
on, from the same live system config core reads (Settings → Experiments,
`bb settings experiment`). It is false while config loads and for unknown
keys. No core caller reads it now that push notifications' focused-thread
skip graduated; decide whether to keep it before stabilizing.

**Audit before stabilizing.**

1. **Key type.** Keys are plain strings so the SDK does not ship bb's
   experiment list; decide whether to export a typed key union instead.
2. **Plugin-owned experiments.** Decide whether plugins should declare their
   own experiments in Settings → Experiments rather than only read bb's.

## `bb.sdk.threads.experimental_headState`

`GET /threads/:id/head-state` returns the thread's head state:
`{ activePromptMode, contextWindowUsage, extensionStates, modelFallback,
pendingTodos, providerCommands, sessionOptions }`. `readThreadHeadState` reads
each field from its latest stored state events, so the cost does not grow with
turn or thread length. The latest timeline page embeds the same result instead
of deriving these fields from its rows. `pendingTodos` and `activePromptMode`
are null unless the thread is active. Core callers: the timeline build, `bb
thread show`, `bb thread commands`, `bb thread options`, and `sdk.status`.
It replaced the timeline's `summaryOnly` query, which built the whole latest
page and dropped its rows; that parameter no longer exists.

Docs: `backend-sdk.md`, `docs/timeline-pagination.md`.

**Audit before stabilizing.**

1. **Page-derived fields.** Active thinking, active workflows, and active
   background commands still come from projecting the latest page, so reading
   them still needs a timeline page. Decide whether they become head state.
2. **`threads.context`.** It returns `contextWindowUsage` alone through the
   same read. Decide whether to keep it as a narrow read or retire it.
   Retiring it is a breaking change: `bb thread context` calls it, and so do
   about 15 community plugins (amrtawfik160/bb-plugin-firstmate,
   cristoslc/bb-plugin-focus-board, gpambrozio/bb-plugins among them).

## `bb.sdk.threads.experimental_listAncestors`

`POST /threads/ancestors` with `{ threadIds }` (1–200 ids) returns
`{ threads: { threadId, ancestorIds }[] }`, parent first up to the root,
for every existing thread including archived and deleted ones, in one
recursive primary-key query. First caller: push-notifications, so a parent's
level follows the current tree. The bundled thread-list plugin's Move to
section for a multi-selection also reads it from the browser SDK to move only
the topmost selected threads
(`plugins/thread-list/app/rows/moveThreadAction.ts`).

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Shape.** Decide whether callers also need each ancestor's thread
   (title, status) rather than only ids, and whether it should merge with
   `experimental_listDescendants` into one tree read.
2. **Batch size.** 200 ids per request; callers chunk, like
   `experimental_listPluginMetadata`.

## `bb.sdk.threads.experimental_listDescendants`

`POST /threads/descendants` with `{ threadIds, includeArchived?,
includeHidden? }` (1–200 ids) returns `{ threads: { threadId, descendantIds
}[] }` in breadth-first order for every existing, non-deleted thread.
Archived and hidden descendants are omitted unless flagged, matching
`threads.count`, but the walk passes through them; anything reachable only
through a deleted thread is omitted. One recursive query over
`threads_parent_idx`. First caller: push-notifications, which republishes a
subtree's levels when a thread's level or parent changes and on
`thread.unarchived`.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Shape.** Decide whether callers need the tree's edges (each
   descendant's parent) or thread fields rather than a flat id list, and
   whether it should merge with `experimental_listAncestors`.
2. **Size.** A subtree of live threads has no cap, and the query walks
   archived threads even when it omits them. Decide whether to page.
3. **Omitted threads.** Unlike `experimental_listAncestors`, deleted threads
   are always omitted and archived and hidden ones by default. Confirm that
   callers never need deleted ones. No event announces a hidden thread
   becoming visible, so a caller that skips hidden threads cannot refresh
   one when it appears; decide whether visibility changes need an event.

## `bb.sdk.threads.experimental_listCascade`

`POST /threads/cascade` with `{ threadIds, action }` (1–200 ids, `action`
`"archive"` or `"delete"`) returns `{ threads: { threadId, cascadeThreadIds
}[] }` for every existing, non-deleted thread: the visible threads that
archiving or deleting it would also affect. Archive follows the same
candidates `archive-all` archives (children, lifecycle dependents and hidden
source threads) and omits threads already archived, so its count equals
`childSummary`'s `unarchivedDescendantCount`. Delete follows the deletion
tree (parent and lifecycle-owner links) and includes archived threads. Hidden,
deleted and unknown threads are omitted. Core's archive and delete dialogs
(`apps/app/src/lib/thread-selection-plan.ts`) read it to find the topmost
selected threads and to count the threads that go with them, for one thread
or a selection, so single and bulk dialogs count the same way.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Per-thread cost.** Each id runs its own cascade walk. Decide whether a
   batched recursive query is needed for large selections.
2. **Shape.** Decide whether callers need the cascade's structure (which
   thread pulled each one in) or counts alone, and whether `childSummary`
   should be retired in its favor.
3. **Actions.** Confirm `archive` and `delete` are the only cascading
   actions worth previewing.

## `bb.sdk.threads.experimental_export` / `experimental_import`

A thread file (`application/zstd`) is zstd-compressed JSONL. The first line is
a header (`format: "bb.thread"`, `formatVersion`, thread id, title, project,
provider, and created, archived and exported times). Then come the thread's own
rows (`threads`, plugin metadata, tabs, prompt history, search segments,
conversation outline, dynamic context file states) as `row` lines, every event in sequence order with its
retained outputs, and the thread's attachments as base64 `attachment` lines.
A seek table sits in a zstd skippable frame.

- `GET /threads/:id/export` writes one for a thread in the database, including
  a deleted thread whose purge has not started; 409 `thread_being_purged`
  after that. The export holds the purge until it finishes.
- `POST /threads/import` takes a file as the multipart `file` field and
  recreates a deleted thread in its project: the thread row goes in hidden with
  a purge queued,
  then its rows, attachments and events, and one transaction unhides it,
  cancels the purge and restarts an archived thread's archive clock. A
  recreated thread's storage counts as not yet deleted. Its links to
  environments and sections that are not on this server are dropped, and so
  are its links to threads (parent, source, lifecycle owner) that are not on
  this server or are deleted when it unhides, so a deleted thread's purge never
  waits on a restored one. An import
  that fails or is cut off leaves the hidden thread to that purge. It answers
  `{ threadId, rows }`: 404 when the project is not on this server, 400 for a
  file that is not a thread file, is damaged, has rows from another thread or
  project, or uses a newer format version than this bb reads (it reads every
  version from 1 up to its own), and 409 when the thread still exists, is still being deleted, or
  another import or export of it is running.

Core callers: `bb thread export` and `bb thread import`. Plugin caller: the
Storage & retention plugin exports a thread from its `thread.delete_finalize`
hook and imports it back when someone restores it, restoring the cold-stored
threads it links to first so its links survive.

Stabilization: decide what a cross-server import does with projects,
environments and provider sessions (it is refused today), commit to reading
every shipped format version, then rename project-wide and drop this entry.

Docs: `bb guide thread-lifecycle`, `backend-sdk.md`.

## `bb.sdk.threads.experimental_regenerateTitle`

`POST /threads/:id/title/regenerate` asks the thread-title AI service for a new
title built from the thread's first task message, up to eight of its latest
user messages, and the first 125 columns of the agent's final reply in each of
its latest thirty-two turns, in the task's language. The prompt includes the
current title so the service can keep it; a changed title replaces the current
one and syncs to providers that support renaming, like a manual rename. When
no title service is available, generation fails, or the thread has no task
message, the call fails with the reason and the title is unchanged. Core
callers: the thread menu's Regenerate title action and
`bb thread regenerate-title`.

Docs: `backend-sdk.md`, `bb guide thread-messaging`.

**Audit before stabilizing.**

1. **Context.** Subagent replies, queued messages, and attachments are not
   sent; decide whether any of them should inform the title.
2. **Result shape.** The call returns the updated thread; decide whether callers
   need the generating service or a preview that does not apply the title.

## `PluginSettingDescriptor.experimental_optionLabels`

A `type: "select"` descriptor record from option value to display label,
shown in the settings form. Stored values, defaults, `settings.get()` and
`bb plugin config` keep the option values, and labels for values outside
`options` are refused at define time. First consumer: push-notifications'
level settings.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

1. **Shape.** Decide between this parallel record and `options` accepting
   `{ value, label, description? }` objects; the object form keeps labels
   beside their values and makes per-option descriptions possible, but every
   reader of `options` (host policy, server contract, CLI, settings form) has
   to handle both forms.
2. **CLI.** `bb plugin config <id>` still lists raw option values, which is
   what `set` accepts; decide whether it should also print labels.

## `bb.server.experimental_dataDir`

**Kept experimental (2026-08-22).** A bare data-directory path does not
stabilize.

The server's data directory. Its JSDoc limits it to read-only use: migrating
off files bb used to manage, and comparing paths. A plugin's own files go in
`bb.storage.experimental_directory()`. First-party callers: storage retention
compares it with a path to recognize the running instance's own data directory,
and Account Pool reads it once to move its credentials out of the legacy
`plugins/account-pool/secrets/accounts` folder. In the 503-repo community
corpus, 32 repos mention it and about 22 write their own files under
`plugins/<id>/` with it (OXI-717 account-pool-balanced, nfour performance,
architawr diagram-fences, ComicBit nudger, sajov recall, g4f4r0 voice-tools,
smsunarto agent-instructions among them); those can move to
`bb.storage.experimental_directory()`.

Docs: `backend-foundation.md`.

**Audit before stabilizing.** Decide whether the remaining community readers
need a bare path or named read-only accessors for the bb-managed files they
migrate from (several read core's `bb.db`, which needs its own SDK reads).
Retiring the member is a breaking change for them.

## `bb.storage.experimental_directory()`

Returns `<dataDir>/plugins/<id>/files` and creates it (mode 0700) on each call
if it is missing. Its lifetime matches `secrets/`: the update snapshot copies
it and rollback restores it, and uninstall deletes it. `data.db` and `logs/`
keep theirs (they survive uninstall). Core resolves the folder with the same
`pluginDirectory(dataDir, id, part)` helper it uses for `data.db`
(`bb.storage.database()`), `logs/` (plugin logs) and `secrets/` (secret
settings and the HTTP token), in `apps/server/src/services/plugins/plugin-directory.ts`;
plugin ids that would collide with core's folders under `plugins/` are refused
by `derivePluginId`. First-party caller: Account Pool keeps account
credentials and machine tokens in `files/accounts`.

Docs: `backend-foundation.md`, `quickstart.md`.

**Audit before stabilizing.**

1. **Snapshot size.** Update snapshots clone the whole folder (`cp -c` on
   macOS, `COPYFILE_FICLONE` elsewhere), which costs no extra space on APFS,
   btrfs and XFS but is a full copy on other filesystems. A successful update
   deletes its snapshot. A rolled-back one is kept until it is 7 days old or
   the server restarts, one per rolled-back update and with no count cap.
   Decide whether that needs a per-plugin cap, and whether plugins with large
   files need a way to keep part of the folder out of snapshots.
2. **Lifetime split.** Decide whether `data.db` should follow `files/` and
   `secrets/` and be deleted on uninstall, so a plugin's state has one
   lifetime.
3. **Remote hosts.** The folder is on the server's machine. Confirm no caller
   needs a per-host equivalent before stabilizing.

## `bb.server.experimental_appUrl`

The operator-configured public app URL from `BB_APP_URL`, or `null`.

Docs: `backend-foundation.md`.

**Audit before stabilizing.** Decide whether `BB_EXTERNAL_URL` or the bb
connect URL should supply this value when `BB_APP_URL` is empty. Confirm that
one public URL has clear behavior when a server has several access paths.

## `bb.internal_DO_NOT_USE_recordPluginUse`

Internal to bb's first-party plugins whose meaningful use happens in their own
UI rather than through an agent tool or CLI command: `monaco-editor` (a saved
file), `prompt-library` (an inserted prompt) and `agent-annotations` (a saved
annotation). It takes no arguments. The server counts it as one `plugin_use`
of the calling plugin, exactly like a successful tool call or CLI command, and
sends nothing for non-public plugins or when usage data is off. Each plugin's
use is sent at most once per day. Forks of these plugins inherit the call, so
removing it later means leaving a no-op stub.

## `app.slots.internal_DO_NOT_USE_setupGuideSection` (`@get-bb/plugin-sdk/app`)

Internal to bb's bundled `connect` plugin: the `internal_DO_NOT_USE_` prefix marks members that are not part of the plugin API and may change or disappear in any release. They are left out of the Plugin Guide and the API index, but nothing enforces this at runtime: any plugin that calls one is accepted.

`internal_DO_NOT_USE_setupGuideSection({ id, component })` registers one row
for the first-run setup guide's "Where you use bb" group. Core renders the
group heading and the `<ul>`; the component renders the `<li>` (the connect
plugin uses `SetupOptionRow` from `@bb/shared-ui/setup-option-row`). The
component receives `InternalDoNotUseSetupGuideSectionProps`:
`{ onPhone, onSetupStarted, onSetupFailed }`. `onPhone` is true when the guide
is open on a phone, so the row hides install links and phone pairing. The row
calls `onSetupStarted()` when the user starts setting it up and
`onSetupFailed(stage, detail?)` (`InternalDoNotUseSetupFailureStage`:
`sign_in`, `pairing`, or `turn_on`; `InternalDoNotUseSetupFailureDetail`: a
fixed error code such as `expired` or `invalid_code`, never a message) when an
attempt fails, so the guide can record the step and why. Core's `PluginSetupGuideSections` renders a plugin's rows through
the ordinary plugin slot boundary.

Callers: the bundled `connect` plugin only. Core caller: the onboarding
Devices step, which renders `PluginSetupGuideSections` for `connect`.

**Audit before stabilizing.** Decide whether other plugins should contribute
setup guide rows, which groups they may target, and whether the guide should
own the row chrome instead of the plugin rendering `SetupOptionRow`.

## `PluginProviderDeclaration.internal_DO_NOT_USE_guidedSignIn` and `SystemProviderState.internal_DO_NOT_USE_guidedSignIn`

Internal to bb's own provider plugins: the `internal_DO_NOT_USE_` prefix marks members that are not part of the plugin API and may change or disappear in any release. They are left out of the Plugin Guide and the API index, but nothing enforces this at runtime: any plugin that calls one is accepted.

A provider declaration sets `internal_DO_NOT_USE_guidedSignIn: true` when the
first-run setup guide should run its sign-in in the guided panel:
the guide runs the provider's login command, keeps its terminal behind Show
terminal, reads the sign-in link and code from the output, and shows them in
the row. Every other provider is terminal-first: the guide opens the login
terminal in the row. The validator fills `false` when the field is absent and
refuses a non-boolean. The server keeps it on the provider registration and
projects it onto every provider-states row (`GET /system/provider-states`) as
a required boolean, so the Agent step's row and its sign-in mode come from the
same response. It is not part of `ProviderInfo`.

Callers: `provider-claude-code`, `provider-codex`, and `provider-acp` for its
Cursor agent only. Core caller: the onboarding Agent step
(`OnboardingFlow`), which reads `SystemProviderState.internal_DO_NOT_USE_guidedSignIn`
instead of a list of provider ids.

**Audit before stabilizing.** Decide whether the provider should describe its
sign-in output itself (link and code patterns, or a structured sign-in
request from the bridge) instead of core parsing terminal text, and whether
Pi's terminal `/login` flow belongs in the same declaration.

## `ProviderHealth.internal_DO_NOT_USE_setupGuidePlanLabel` and `SystemProviderState.internal_DO_NOT_USE_setupGuidePlanLabel`

Internal to bb's own provider plugins: the `internal_DO_NOT_USE_` prefix marks members that are not part of the plugin API and may change or disappear in any release. They are left out of the Plugin Guide and the API index, but nothing enforces this at runtime: any plugin that calls one is accepted.

A provider bridge's health result may set `internal_DO_NOT_USE_setupGuidePlanLabel` to a plan name (for example "Plus") that only the first-run setup guide shows next to the account on a ready agent row. `planLabel` keeps its existing meaning, so every other surface shows what it showed before. The field is optional on the bridge result and passes through older daemons unchanged; the server fills `null` when it is absent, so provider-states rows always carry it.

Callers: `provider-codex` only (its ChatGPT plan). Core caller: the setup guide's Agent step (`OnboardingFlow`), which prefers it over `planLabel`.

**Audit before stabilizing.** Decide whether the plan should become part of `planLabel` everywhere (such as Settings) and the field be removed.

## Bridge record mode (`experimental_recordProviderChildIo` and `experimental_isProviderBridgeRecording`)

**Kept experimental (2026-08-22).** The recording entry shape is a de-facto
fixture format consumed by the testing kit, so it must be frozen together
with `experimental_readBridgeRecording` / `experimental_replayRecording`. The
`{ threadId | null }` scope is untested against a multiplexing bridge.

`experimental_recordProviderChildIo` tees a provider child's stdio into record
mode and is a no-op when record mode is off.
`experimental_isProviderBridgeRecording` reports whether record mode is on.

Docs: [provider-bridge-protocol.md](provider-bridge-protocol.md) "Record
mode", `providers.md`.

**Audit before stabilizing.** Decide whether the bridge kit should own the
spawn itself (one helper that spawns and records) instead of a post-spawn
hook; confirm the `{ threadId | null }` scope is the right key once bridges
multiplex several threads over one child; and settle the recording entry
shape (`{ ts, run, seq, dir, line }`) as a documented fixture format.

## Provider CLI environment (`experimental_buildProviderCliEnv`) (`@get-bb/plugin-sdk/provider-bridge`)

`experimental_buildProviderCliEnv(envVars)` returns the environment for a
provider CLI the bridge starts: the bridge process environment without
`ELECTRON_RUN_AS_NODE` and `BB_PROVIDER_BRIDGE_RECORD_DIR`, plus the request's
`envVars` filtered to valid shell names. Request `envVars` win. Core callers:
the Claude Code, Codex, Pi and ACP bridges build their session, model-list,
health and installation-probe envs with it, and read their launch overrides
(`BB_CLAUDE_CODE_EXECUTABLE`, `BB_CODEX_BRIDGE_APP_SERVER_COMMAND`,
`BB_PI_BRIDGE_COMMAND`) from its result.

**Audit before stabilizing.** Decide whether inherited `BB_*` names other than
the declared passthrough should be dropped here rather than relying on the
runtime's bridge allowlist, and whether the result should carry the
HostToolchain PATH merge so callers that do not spawn through
`experimental_spawnPortableProcess` get the same PATH.

## Portable provider spawn (`experimental_spawnPortableProcess`, `experimental_killPortableProcess`) (`@get-bb/plugin-sdk/provider-bridge`)

`experimental_spawnPortableProcess({ command, args, cwd?, env?, stdio?, detached? })`
returns a `ChildProcess` launched the way the daemon launches one. On Windows
it resolves PATH/PATHEXT, runs npm `.cmd` shims, and hides the console;
elsewhere it behaves like `spawn`. `experimental_killPortableProcess(child, signal)`
terminates the whole process tree on Windows and sends `signal` to the child
elsewhere.

**Audit before stabilizing.** Decide whether bridges should receive the managed
process handle (an awaited stop that reports whether the tree is confirmed
gone) instead of a raw `ChildProcess` plus a fire-and-forget kill. Confirm
argument quoting for `.cmd` targets with untrusted arguments, and whether
`detached` belongs in the public shape.

## `experimental_serializeJsonRpcLine` (`@get-bb/plugin-sdk/provider-bridge`)

`experimental_serializeJsonRpcLine(message)` returns `JSON.stringify(message)`
unless the line holds an escaped lone surrogate; then it serializes again with
every lone surrogate in a string replaced by U+FFFD. A lone surrogate is
valid in JavaScript but not in UTF-8, and Codex's serde-based app-server
rejects its `\ud83d` escape and drops the whole message without answering,
so a bridge writing to a provider's stdin uses this instead of
`JSON.stringify`. The result has no trailing newline.

Core callers: `bridge-kit/runtime-json-rpc.ts` serializes every request,
result and error the daemon sends to a bridge with it, and the ACP message
stream writes to ACP agents with it. Plugin callers: the Codex provider's
app-server writer. Docs: Plugin Guide, Agent providers
(`plugins/plugin-api-docs/src/surfaces.ts`).

Before stabilization, decide whether bridges should get a whole stdin writer
(newline, closed-stdin handling) instead of a serializer, and whether the
Claude Code bridge's SDK transport needs the same guard.

## `experimental_BridgeRecoveryError`

**Kept experimental (2026-08-22).** It stabilizes together with
`experimental_defineProviderBridge` / `experimental_apiVersion` in the
bridge-kit audit.

A request handler throws it to reject the request with a JSON-RPC `code` and
`error.data.recovery { kind, message, retryable }`.

Docs: [provider-bridge-protocol.md](provider-bridge-protocol.md) "Recovery
hints".

**Audit before stabilizing.** Confirm the five kinds cover what third-party
bridges need to say about a rejection (installation was deliberately left to
`provider/installation/*`). Decide whether `retryable` should be per kind
(only `sessionArchived` and `rateLimited` read it today) and whether the
runtime should bound the `rateLimited` ladder from the hint rather than from
a constant.

## Provider maintenance toolkit (`experimental_resolveExecutablePath`, `experimental_readCliVersion`, `experimental_commandOutput`, `experimental_versionFrom`, `experimental_compareVersions`, `experimental_formatCommand`, `experimental_npmCommand`, `experimental_npmGlobalInstallCommand`, `experimental_npmLatestVersion`, `experimental_probeNpmGlobalPackage`, `experimental_npmGlobalInstallSource`, `experimental_installationVerification`, `experimental_downloadedInstallerCommand`, `experimental_clampPercent`) (`@get-bb/plugin-sdk/provider-bridge`)

These are the host-local probes and install commands behind a bridge's
`provider/health`, `provider/usage` and `provider/installation/*` answers for
a user-installed CLI.

- Probes: `resolveExecutablePath` returns an absolute path or null, and on
  Windows prefers a PATHEXT match such as an npm `.cmd` launcher.
  `readCliVersion` runs `--version` with stdin closed and returns the first
  valid SemVer token or null. `commandOutput` returns trimmed stdout+stderr
  or null. `versionFrom` is a pure parser that returns a SemVer token, or null,
  from a string. The others are `npmLatestVersion` and
  `probeNpmGlobalPackage`. Every probe except `versionFrom` takes an optional
  env to search and run with; without one it uses the bridge's own
  environment, as before. First-party
  bridges pass `experimental_buildProviderCliEnv(params.envVars)` so a probe
  sees the same CLI a session starts.
- Decisions: `compareVersions` uses SemVer precedence and throws `TypeError`
  on invalid input. `npmGlobalInstallSource` returns `npmGlobal`, `external`
  or `notInstalled`. `installationVerification` passes an install on
  existence, and an update on reaching the latest version (or any change
  when the registry was unreachable).
- Actions: `npmGlobalInstallCommand`; `downloadedInstallerCommand`, which runs
  a vendor script from a temp file and, given `powershellUrl` on Windows,
  returns `irm <url> | iex`; `npmCommand`; `formatCommand`; and
  `clampPercent`.

**Audit before stabilizing.**

1. **Timeouts are fixed.** 5 s for `which`/`--version` and 15 s for npm and
   self-diagnostics, so a bridge whose CLI is slow to start (a JVM, a
   first-run download) cannot lengthen them. Decide whether the budgets
   become arguments before the signatures are a promise.
2. **`compareVersions` throws.** Confirm the throwing contract for invalid
   inputs before stabilization.
3. **The npm helpers assume a global install.** `probeNpmGlobalPackage` and
   `npmGlobalInstallSource` model npm's global prefix only; pnpm, volta and
   corepack shims read as `external`. Decide whether the source enum should
   grow before it is relied on.
4. **`downloadedInstallerCommand` without `powershellUrl` is POSIX.** On win32
   it still returns `sh -c` with `mktemp`, `curl` and `bash`. Decide whether it
   should refuse there rather than hand the daemon a command that cannot run.

## Presentation builders (`experimental_presentationTitle`, `experimental_presentationDetail`, `experimental_withTitle`, `experimental_presentationFileName`, `experimental_COMPACTION_PRESENTATION`, `experimental_REASONING_PRESENTATION`, `experimental_fileReadPresentation`, `experimental_searchPresentation`, `experimental_webSearchPresentation`, `experimental_webFetchPresentation`, `experimental_planStepsPresentation`, `experimental_toolPresentation`) (`@get-bb/plugin-sdk/provider-bridge`)

These build the grammar-v3 `presentation` a bridge stamps on every item
([provider-plugin-api.md](provider-plugin-api.md) §3 owns the vocabulary).
`presentationTitle` takes the first non-empty line capped at 160 characters,
or undefined. `presentationDetail` caps a detail at the persisted schema's 280
characters. `withTitle` stamps a title only when there is one, and
`presentationFileName` returns the last path segment. The two constants carry
bb's fixed wording for compaction and reasoning rows. The five builders shape
file read, search, web search, web fetch and plan-steps rows, and
`toolPresentation` is the generic "Running/Ran <tool>" row.

**Audit before stabilizing.**

1. **The wording is a product decision.** A bridge that adopts the constants
   inherits bb's English labels and glyph names. Decide whether the labels
   should come from the host (localized, themed) rather than be persisted from
   the bridge before the constants are a promise.
2. **The caps are the schema's.** Stabilizing the helpers freezes the
   160-character headline cap (a kit convention) and the 280-character detail
   cap (the persisted schema's) as public behavior.
3. **Plan-steps rows collapse by default.** `experimental_planStepsPresentation`
   sets `suppress: true` (the todo banner reads the snapshot); codex keeps its
   own uncollapsed variant. Decide which default a third-party bridge should
   get.

## `experimental_unansweredInteractionWarning`, `experimental_unansweredInteractionErrorMessage` (`@get-bb/plugin-sdk/provider-bridge`)

`experimental_unansweredInteractionWarning` builds the `provider.warning` delta
a bridge sends whenever it answers a provider question or permission request
with something the user did not choose, whatever the provider receives.
`experimental_unansweredInteractionErrorMessage` is the matching JSON-RPC error
or deny text for the agent. The five causes are an unshowable request, a
runtime error (bb stopped waiting), an unreadable resolution, an answer that
does not fit the question, and a question the bridge withdrew. The `answer`
names what the provider got (an error or a protocol value such as `cancel`).
Summary and details wording is bb's, and the delta is vouched to the open turn.
Core callers: the ACP bridge (`packages/provider-bridge-acp`), the Pi
extension-dialog coordinator, every Codex question request, and Claude Code's
canUseTool denials. The `unanswered-interactions` contract test in
`@bb/provider-bridge-protocol` runs each bridge's question kinds (ACP, Pi and
Codex rows come from the kinds each bridge routes) through every cause and a
stopped turn.

**Audit before stabilizing.**

1. **The cause list is closed.** A third-party bridge with a sixth way to
   answer without the user has no cause to name. Decide whether `cause` takes
   free text before freezing the union.
2. **The wording is a product decision**, as with the presentation builders:
   English summary and details persist on the warning row, and the error text
   reaches the model.
3. **Error versus cancel stays the bridge's call.** Decide whether the kit
   should pick the provider answer too (it cannot without knowing each
   protocol) or keep only the warning and the message.

## `experimental_readBoundedLines` (`@get-bb/plugin-sdk/provider-bridge`)

A newline-delimited line reader. It frames on LF only (never `readline`, which
also splits on U+2028/U+2029) and strips a trailing CR. A line over
`maxLineBytes` (default 64 MiB) is discarded up to its terminator and reported
through the required `onOverflow` with its byte count. The optional `onClose`
fires after a final unterminated line is emitted.

**Audit before stabilizing.**

1. **The default cap is the wire's.** `maxLineBytes` defaults to the JSON-RPC
   line bound the runtime applies to the bridge itself; a provider child's
   payloads may deserve a different bound. Decide whether the default should
   be an explicit argument for child pipes.
2. **`onOverflow` is required.** A bridge might reasonably want to fail the
   session instead of logging the drop. Decide whether the reader should offer
   a fail-closed mode before the signature is a promise.

## Live-file navigation (`experimental_FileLink`, `BbNavigate.experimental_openFilePreview`, `BbNavigate.experimental_openFileExternally`, and `experimental_useCanOpenFileExternally`)

**Kept experimental (2026-08-22).** Windows/UNC paths were never verified.

`experimental_FileLink` and `experimental_openFilePreview` open explicit live
workspace, host and thread-storage file targets through the current surface's
shared file-tab controller. `experimental_openFilePreview`'s optional
`opener` (`ExperimentalFilePreviewOptions`) names one of the calling plugin's
`fileOpener` registrations to show the file with for that open; it becomes
the same one-off viewer override the file-link "Open with" menu passes, and an
unregistered id falls back to BB's preview. A `fileOpener` with
`extensions: []` is never chosen by extension or listed under "Open with", so
it shows only files its plugin opens this way; Inline visualizations' expanded
page is the first caller. `experimental_openFileExternally` opens a target
in the client's preferred external app. The boolean results report host
acceptance, and malformed targets stay inert.
`experimental_useCanOpenFileExternally(target)` is a hook that reports
whether that open can succeed now: the target resolves to a path on its host
(a ready environment on an active host, a host, or thread storage) and this
client has an external file target for that host. It is false while either is
loading, and the component re-renders when the answer changes.

**Core callers.** `usePanelFiles` owns file opening on the thread view, New
thread screen, and plugin page: core's workspace, host, and storage opens and
`openFilePreview` build the same tab requests under one scope rule, which
`usePanelFiles.test.tsx` checks against every surface. Links route through
`usePanelBrowser` on every surface. `useCanOpenFileExternally` is the only
availability check for external opening: the file-link menu's Open
externally item and the thread and New-thread file previews' Open in editor
buttons use it. It resolves targets and checks the preferred file target with
the same hooks the external-open dispatcher uses, and those buttons open
through the same host intent as `experimental_openFileExternally`.

Docs: `frontend-components.md`, `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Verify strict target/path/location validation on POSIX, Windows drive, and
   UNC paths, including stale environment, host, and thread identities.
2. Confirm preview identity, persistence, opener preference, one-off Open with,
   disabled opener fallback, and explicit-host migration on Thread, New-thread,
   Settings, and plugin-page surfaces.
3. Audit external opening across local and remote clients, disconnected hosts,
   missing preferred apps, and targets with line but not column support.
   Decide whether `experimental_useCanOpenFileExternally` should also report
   disconnected hosts as unavailable.
4. Confirm link anchor behavior, unavailable menu states, copy semantics, and
   whether per-app external choices should remain host-owned menu affordances
   rather than become plugin-selectable API.
5. Measure the lazy boundary: mounting a file link must not start file reads,
   preview imports, editor discovery, or panel-destination loading.
6. Audit `experimental_ref` (below) with the rest of the target before
   stabilizing either.

## Workspace file revisions (`ExperimentalLiveFileTarget.experimental_ref`)

A workspace target's optional `experimental_ref` names a Git revision:
`"HEAD"` or a 4–40 character commit SHA, the forms the revision file route
accepts; anything else makes the target invalid.
`experimental_openFilePreview` and `experimental_FileLink` then open a
read-only preview of the file at that revision, labelled with the ref and read
through `GET /environments/:id/revisions/:ref/files/*`. The link menu hides
plugin file openers, which only read the working copy, and Open externally
ignores the ref and opens the working copy. A ref preview shares the
working-copy tab for the same path. The panel tab persists the ref in the
existing `head`/`merge-base` sources because shipped mobile builds parse the
synced tab schema strictly.

**Callers.** The bundled Git plugin's changed-files lists (its Info tab
sections and the composer's Changed files segment) open a deleted row's HEAD
or merge-base content through the public `navigate.experimental_openFilePreview`
with this field (`plugins/git/ui/changed-files.tsx`).

**Audit before stabilizing.**

1. Decide whether a ref preview should get its own tab instead of replacing
   the working-copy tab for the same path.
2. Decide whether the persisted tab source should become a single revision
   variant once shipped clients accept it.
3. Decide whether branch names and revision expressions should be accepted,
   and confirm error states for unknown SHAs and paths missing at the
   revision.

## Terminal navigation (`BbNavigate.experimental_openTerminal`)

Shows a terminal the plugin created with `useSdk().terminals.create` in the
current surface's terminal panel. A thread surface accepts only that thread's
terminals, the New thread screen only its current terminal scope, and a
plugin page any terminal. It resolves false for unknown or exited terminals
and surfaces without a terminal panel, and closing the tab closes the
terminal. Requested in #1132.

**Core callers.** This API calls `usePanelTerminals`'s `open`; core's Start
terminal row, the `terminal.open` shortcut, and terminal tab selection use
its `select` on every surface. `usePanelTerminals.test.tsx` runs one contract
table against the thread view, New thread screen, and plugin page.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Decide whether plugins need tabs that hide without closing the terminal
   (#1132's `closeBehavior: "detach"`). Thread and New-thread surfaces derive
   tabs from live sessions, so this needs a hidden-session notion in panel
   state rather than a flag on the call.
2. Confirm the per-surface acceptance rules with a real consumer, including
   environment terminals opened from a thread view and host-path terminals
   whose cwd differs from the New thread screen's target.
3. Verify compact-viewport drawer reveal, split panes, and opening a terminal
   whose host is disconnected.
4. Decide whether a nav panel should also declare a default terminal scope so
   the native "+ Terminal" button follows the page's worktree.

## Thread, message and settings locations (`BbNavigate.experimental_toSettings`, `BbNavigate.experimental_threadHref`, `BbNavigate.experimental_settingsHref`, and `ExperimentalMessageMetadataContext.messageSeq`)

`toThread(threadId, { messageSeq })` opens the thread's message link,
`…/threads/<id>#msg=<seq>`, through the same placement as `split`, so bb
loads older history, scrolls to and highlights the message, or toasts
"Message not found"; a repeated call reveals it again. That option is stable
and unprefixed, so it matches the href option below; this entry covers the
experimental members around it.
`experimental_toSettings()` opens the calling plugin's settings page, and
`experimental_toSettings({ section })` a bb section
(`ExperimentalSettingsSection`). Settings replaces the whole window, panes
included. `experimental_threadHref(threadId, { messageSeq? })` and
`experimental_settingsHref(target?)` take the same arguments as the call
they mirror and return the app-relative location it opens. The thread href
resolves the project from bb's loaded threads, as `toThread` does; otherwise
it is `/threads/<id>`, which bb redirects to the project route and keeps
`#msg=`. bb's plugin slot root
routes plain clicks on those hrefs in place (Cmd/Ctrl-click opens a split,
middle-click a new tab). A seq that is not a non-negative integer, or an
unknown section, throws `RangeError`. Message metadata components receive
the same seq as `message.messageSeq`. Requested by the API
audit: 6 community plugins rebuilt the reveal from the DOM, 13 forged
history state to reach settings, and about 50 built `/threads/` or
`/settings/` paths by hand.

**Core callers.** `getThreadLocationPath` (`@bb/client-core`) is the only
thread path builder in the web and mobile apps: every thread link, Copy link,
Copy message link, mention, pane route and notification target, plus
`toThread` and `experimental_threadHref`. `openThread`
(`split-layout/openThread.ts`) is the only way to open a thread for the user,
with or without a split: `toThread`, `experimental_useSidebarThreadActions`'
`open`, the search palette, sidebar Open in split and keyboard navigation,
`bb thread open`, mention links, the archived-thread toast, and new threads
after creation. Pane bookkeeping (closing, replacing or reconciling panes)
uses only the path builder. The palette keeps its `searchMessageSeq` state
because its hits can be non-message events. Every reveal of a message in the
timeline, whether from a message link, the palette or the thread outline,
runs through `useScrollToSearchedMessage`: it loads older pages, keeps the
target rendered, waits for its position to settle, highlights it, and toasts
when it is missing. The outline sends an in-place request with the
message's seq instead of a URL, so it adds no history entry. `getSettingsTargetPath`
(`settings-sections.ts`) is the only settings path builder: sections, plugin,
machine and project pages, including `experimental_toSettings` and
`experimental_settingsHref`. The sidebar footer's `openSettings` /
`openPluginDetails` call `navigate.experimental_toSettings()`. The generic
Settings button, nav rail button and "Open settings" command reopen the last
settings page visited, which is a stored location, not a target.

Docs: `frontend-navigation.md`.

**Audit before stabilizing.**

1. Decide whether plugins need other plugins' settings pages or project and
   machine settings pages; each had one community caller.
2. Confirm copied absolute URLs from desktop, which point at the local
   server origin like core's Copy link does.

## Host plugin foundation (`bb.hosts.experimental_client`, `ExperimentalHostClient.experimental_onWorkerExit`, `ExperimentalHostClient.experimental_onSignal`, `ExperimentalHostRpcContext.experimental_retainWorker`, `ExperimentalHostRpcContext.experimental_paths`, `ExperimentalHostRpcContext.experimental_emitSignal`, `ExperimentalHostRpcContext.experimental_watch`, `experimental_defineHostEntry`, `experimental_killProcessesWithCwdUnder`, `experimental_readProcessIdentity`, and `experimental_createHostEntryHarness`)

**Kept experimental (2026-08-22).** At that date, signals and watches had no
consumer (decide whether to delete them or keep them experimental separately
from calls). Both now have consumers. The Worktree and Project checkout hosts
emit `progress` signals. The 2026-11-06 marketplace audit found
`experimental_emitSignal` in 30 repositories and `experimental_watch` in 15,
so deleting them is no longer an option. None of the lifetime/limit numbers has been measured against a plugin
other than keep-awake. The artifact-contract names (`experimental_apiVersion`,
`experimental_signals`, the injected context members) are read by the daemon
from installed artifacts, so renaming them needs a dual-name window plus a
protocol bump.

A plugin declares one `bb.host` Node entry with
`experimental_defineHostEntry`, shares a Standard Schema contract with its
server, and calls methods on an explicit enrolled host through
`bb.hosts.experimental_client`. The client can observe unexpected worker exits
and ephemeral host signals. Handlers can hold retention leases, and idle
workers are evicted after five minutes. `experimental_killProcessesWithCwdUnder`
reaps processes working under any of the given directories before they are
deleted (the SDK still accepts the pre-0.6.27 `{ directory }` shape at
runtime), and `experimental_readProcessIdentity(pid)` returns
`{ command, startedAt }` so a caller can confirm a recorded PID before
signalling it.

Docs: `backend-foundation.md`, `testing.md`.

**Audit before stabilizing.**

1. **Process reap and identity.** Confirm
   `experimental_killProcessesWithCwdUnder`'s platform coverage (Linux
   `/proc`, macOS `lsof`) and whether the grace should be per call. Confirm
   `experimental_readProcessIdentity`'s start-time precision per platform and
   whether a combined verified-stop helper should replace it.
2. **Call timeout.** `ExperimentalHostCallOptions.timeoutMs` defaults to 30 s
   and is capped at 30 minutes. Confirm the cap, and whether the default should
   be declared per method on the contract instead.
3. **Contract shape.** Confirm Standard Schema values remain the right runtime
   boundary and decide whether method-specific typed errors are necessary.
4. **Targeting.** Confirm explicit host ids are enough for V1 and add an
   environment-aware primitive only alongside a plugin that proves its
   locking and workspace semantics.
5. **Process lifetime.** Measure whether five idle minutes is the right timeout,
   whether watches should continue retaining automatically, and whether leases
   acquired only during active handlers are expressive enough. Confirm there is
   no need for manifest lifetime flags, plugin-selected timeouts, a global
   worker limit, or plugin-specific restart policy. Confirm unexpected-exit
   notification is the right generic repair trigger, remains suppressed for
   graceful and idle disposal, and does not create crash loops.
   Verify reconnect generation reconciliation covers disable/uninstall during
   an outage without stopping a still-current worker on every transient drop.
6. **Signals and watches.** Confirm host signals should remain private,
   ephemeral invalidations rather than a durable event log. Audit native-watch
   coalescing, backpressure, rescan/error events, per-worker limits, and cleanup
   against a plugin that watches real workspace state.
7. **Paths.** Confirm the stable host data path layout and generation-temporary
   cleanup behavior across crashes and daemon restarts.
8. **Limits.** Audit the common call duration, startup/cancellation grace, 8
   MiB JSON payload cap, 256 MiB artifact cap, and per-plugin admission limits
   (256 active calls / 32 MiB of active inputs) against real plugins. Confirm
   retaining only the most recently materialized artifact digest per plugin is
   sufficient.
9. **Environment.** Confirm executable discovery through normalized `PATH`
   and stripping all daemon-owned `BB_*` variables.
10. **Trust and dependencies.** V1 host plugins are trusted Node programs that
    may use `child_process`, filesystem, and network APIs. Decide whether later
    permissions, native artifacts, or an explicit dependency installer can be
    layered on without changing the RPC contract. Confirm rejecting all private
    `@bb/*` imports from host bundles is the correct permanent boundary, and
    audit the builder-supplied public SDK runtime against future host exports.
11. **Composition boundary.** Confirm host RPC methods and signals should remain
    private to the owning plugin while allowing another daemon subsystem to
    consume the same `bb.host` artifact through its own bootstrap and lifecycle.
12. **Test harness.** Audit both layers. The server harness has the
    `experimental_callHostRpc`, `experimental_hostEntry` and
    `experimental_declaredIconNames` options, the `experimental_hostRpcCalls`
    inspection list, the `experimental_emitHostWorkerExit` and
    `experimental_emitHostSignal` drivers, and `experimental_watchRpc(method,
read)`, which runs a method's `experimental_whileWatched` producer as a
    client watch would and returns the unwatch function; plugin disposal aborts
    the watches still running, as the real host does. The Git plugin's server
    tests use it to check that ended turns cost nothing while no environment is
    watched. The host-entry harness has
    `experimental_call`, `experimental_getSignals`,
    `experimental_getRetainedWorkerLeaseCount`, `experimental_lifecycleSignal`,
    path/watch options, and `experimental_dispose`. Confirm the host harness
    should continue simulating validation, cancellation, lifecycle, JSON, and
    size limits without pretending to model process startup, crashes, native
    watcher recovery, or reconnect behavior.

## `PluginRpcMethodContract.experimental_retryable` (host contracts)

A host contract method can declare `experimental_retryable: true`. When the
daemon's response to such a call has not arrived within half of its transport
timeout, the server cancels that call and sends it once more with a new call
id. This is core's own retry: `callPluginHostRpc` goes through
`callHostRetryablePluginHostCall`, which runs the same
`callHostOnlineRpcWithRetry` path core uses for daemon commands marked
`retryable: true` in `hostDaemonCommandRegistry`, and differs only in giving
the second attempt a fresh `callId`, because the daemon rejects a duplicate id
while the first call is pending. No daemon wire change. Client RPC
registrations ignore the field.

Callers: the Git plugin's host `status`, `diff`, `files`, `patches` and
`branches` (base marked `workspace.status`, `workspace.diff`,
`workspace.diffFiles`, `workspace.diffPatch` and `host.list_branch_options`
retryable; its `fileSide` reads through `bb.sdk.files.read`, which still uses
the retryable `host.read_file`), and the GitHub PR Status plugin's batched
`views` read (core marked `workspace.pull_request` retryable; `act` is not).

Docs: `backend-foundation.md`.

**Audit before stabilizing.** Decide whether retryability belongs on the
contract or should be inferred from a read/write method kind, whether one
retry is enough for plugin calls with long timeouts, and whether the
cancelled first attempt should count against worker lifetime.

## Fixed-tab targets (`experimental_target`, `experimental_useAppPanel`, and `experimental_useFixedTabTarget`)

**Kept experimental.** Fixed tabs now register through `experimental_tab`; the
legacy navigation-page field remains a runtime adapter only. The target trio's
consumers are the bundled Git plugin's Diff tab (`plugins/git/app.tsx`,
`plugins/git/ui/diff/DiffTab.tsx`), the `examples/plugins/thread-chat-demo`
example and about 3 community plugins (danielbachhuber/bb-plugins,
MateoCerquetella/bb-plugins, nathancolgate/bb-plugin-agent-graph); validator,
survival and cross-thread items remain.

A fixed tab's `experimental_target` validator owns a JSON-safe target type;
thread and navigation-page fixed tabs may both declare one.
`experimental_useAppPanel().openTab()` selects one of the calling plugin's
eligible tabs on the current surface and can submit a target.
`experimental_useFixedTabTarget()` returns the validated current-session
target with a sequence and `clear()`. Targets are memory-only: they survive
remounts but not a refresh. In tests, `renderSlot`'s
`experimental_fixedTabTarget: { panelId?, tabId, target }` option seeds the
target the hook returns (omit `panelId` for a thread fixed tab).

Docs: `frontend-core-slots.md`, `frontend-components.md`.

**Audit before stabilizing.**

1. Audit registration objects as references: identity is scoped to the mounted
   plugin and current nav panel, with no cross-plugin addressing or global ids.
2. Confirm sync type guards remain the right owner validation contract and
   define error reporting if a validator throws or becomes stale after reload.
3. Exercise repeated equal targets, explicit clearing, crashes, inactive-tab,
   panel, and route remounts, refresh, and compact drawer animation. Targets
   must survive remounts in the current app session, never survive refresh, and
   never reappear after their owner clears them.
4. Decide whether a future cross-thread surface should navigate before opening;
   the initial public surface intentionally supports only `{ kind: "current" }`.
5. Keep core and plugin destinations on the same resolver and verify the
   controller never learns Changes, file, task, or document target shapes.

## `PluginNavPanelRegistration.experimental_useBadge`

**Added 2026-10-15 (SDK 0.6.53), replacing `experimental_sidebarAccessory`.**
One consumer: the Tasks plugin's open-task count.

A nav panel hook returning `ExperimentalBadge`
(`{ count?, text?, tone?, label }`) or `null`. `count` and `text` are
exclusive; `text` is at most 8 characters; `tone` is `neutral` (the default),
`warning`, or `critical`, and bb owns the colors. The sidebar navigation model
runs the hook once per registered panel in the plugin's slot scope and crash
boundary and hands the value to every navigation provider as `item.badge`.
The bundled Navigation plugin's Rail draws a count (capped at `9+`) or a dot
on the icon, and does not draw `text`; its Top list and More menu draw the count
(capped at `99+`), the text, or a dot. Both add `label` to the accessible name
and put a dot on More, in the strongest hidden tone, while a badged panel is
hidden there.

The fields follow the 30 bb-community plugins that drew
`experimental_sidebarAccessory` (October 2026): 12 drew one count, 8 several
numbers or a fraction, 5 a short status word, 3 a percentage, and 18 used
red, amber, or an accent color for state. A plugin that still passes
`experimental_sidebarAccessory` keeps loading; the field is dropped with a
warning. Remove that compatibility once released plugins have migrated.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Core parity.** Decide whether a core destination needs a badge and, if
   so, route it through the same `item.badge` path the Navigation plugin
   draws.
2. **Tone and text.** Confirm three tones and an 8-character `text` cover
   migrated plugins, including the six that drew several colored counts and
   now draw one badge.
3. **Hook lifetime.** The hook runs for every registered panel while the
   sidebar is mounted, including hidden ones. Confirm that cost is acceptable for
   plugins with expensive queries, or add visibility to the hook's inputs.
4. **More summary.** The More button's accessible name lists every hidden
   badge. Check that this stays usable with many badged hidden panels.

## `PluginNavPanelRegistration.experimental_headerTitle`

An optional component receiving `PluginNavPanelProps` (`{ subPath }`).
`PluginPanelHeaderCenter`
(`apps/app/src/components/plugin/PluginPanelHeader.tsx`) renders it in the
page's shared title bar in place of the panel icon, `title` and
`experimental_usePageTitle` text, in the routed page header (`AppLayout`) and
in plugin-panel split panes (`SplitThreadArea`). It is wrapped in
`PluginContext` and a `data-bb-plugin-root` element like `headerContent`, and
contained by the same error boundary: a throw logs a warning and shows the
default icon and title. The window title still comes from
`experimental_usePageTitle` or the panel title. Before the plugin loads, the
header shows the remembered default title.

**Core callers.** None: core pages render `PageTitleHeader`. The motivating
caller is the Conductor layout plugin's "new chat in this workspace" page,
which shows the same `project › workspace` breadcrumb as its thread header
title. Tests: `plugin-slot-mounts.test.tsx` (render with subPath, crash
fallback) and `plugin-app-nav-sidebar.test.ts` (registration).

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Shared title component.** Decide whether core should expose its
   `PageTitleHeader` so plugins can compose rather than replace it.
2. **Split panes.** In a split pane the pane drag starts from the title area
   except on links and buttons; confirm that is enough for rich titles.

## `PluginNavPanelRegistration.experimental_hideFromNavigation`

An optional boolean. When true, `createSidebarNavigationRows`
(`apps/app/src/components/sidebar/sidebarNavigationItems.ts`) leaves the panel
out, so it has no rail or list entry, no More entry, no place in the user's
navigation arrangement and no badge; `buildPluginPagePaletteActions` leaves out
its "Plugin pages" palette entry. The plugin's capability list describes it
as a page the plugin opens itself. Its route `/plugins/<pluginId>/<path>/*`
renders as usual, with its title bar, App panel, right panel and splits; a
plugin opens it with `useBbNavigate().toPluginPanel(path, { subPath })`.

Navigation renders from the last-known chrome cache
(`apps/app/src/lib/plugin-nav-panel-chrome.ts`) before plugins load, so the
cache stores `hideFromNavigation` per panel. Its version went from 1 to 2, so a
profile's first boot after the upgrade starts with no remembered panels rather
than showing a hidden one.

**Core callers.** None. The motivating caller is the Conductor layout plugin's
"new chat in this workspace" page, reached from its tab strip. Tests:
`SidebarNavigationRail.test.tsx` (rail and More, remembered and live),
`palette-plugin-page-actions.test.ts`, `plugin-nav-panel-chrome.test.ts`
(cache), `plugin-slot-mounts.test.tsx` (route renders) and
`plugin-app-nav-sidebar.test.ts` (registration).

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Discoverability.** A hidden page is reachable only from plugin UI and
   links. Decide whether Settings or the plugin's detail page should list it.
2. **Settings toggle.** Decide whether users can show a hidden page in
   navigation, which would make this a default rather than a rule.

## `app.slots.experimental_sidebarNavigation` (`@get-bb/plugin-sdk/app`)

**Restored 2026-10-15 (SDK 0.6.53) with `placement`.** It was removed in
#5229 (0.46.0); the names are unchanged so plugins built before 0.46, such as
Compact Nav 0.1.x and Sidebar Sections, load again.

**What it does.** Draws the sidebar navigation: New thread, Search threads,
Plugins, Skills, Automations, plugin panels, and More, plus optional controls
in the sidebar header. Exclusive.
`sidebar.navigationProvider` picks the provider by plugin key: the bundled
Navigation plugin's `navigation/rail` or `navigation/top-list`, another
plugin's key, or `__automatic__` (the default: the first registered provider
from another plugin, else `navigation/rail`). Legacy `__builtin__` and
`navigation/navigation` read as `__automatic__`.

The registration declares `placement`, `rail` or `list` (the default). bb lays
the sidebar out from the placement before the provider renders, and keeps the
layout around it: for `rail`, a fixed-width column that stays when the sidebar
collapses and Settings at the bottom of the column; for `list`, the area
above the thread list, a Settings footer action,
Back to app rows on the Settings, Plugins, and Skills lists, and a collapse
that hides the whole sidebar. Both placements use the same framed macOS
window chrome on wide viewports, so changing placement does not move the
window controls, history controls, or the vertical position of Settings search.
The component receives `isCompactViewport`,
`placement`, and the deprecated `experimental_Original`, which renders the
Navigation plugin's provider for the same placement, or nothing when that
plugin is disabled.

The optional `headerComponent` renders in the sidebar header row while the
navigation is active. On wide macOS desktop windows, this row sits below the
window title bar; elsewhere it sits between the sidebar toggle and bb's back
and forward buttons. It receives `width`, `controlSize`,
and `isCompactViewport`. The host clips it to the row, keeps the macOS drag
region for non-interactive space, aligns it with the macOS window controls,
and on a crash draws the header of the Navigation plugin's provider for the
same placement, with one toast. It replaces the separate
`experimental_sidebarHeader` slot and its `sidebar.headerProvider` setting,
which let users pair a header with a navigation it did not belong to. That
slot remains as an untyped runtime alias: a plugin's header joins each of its
navigations that has no `headerComponent`.

Before plugin frontends settle, a pinned provider, or the provider Automatic
last chose, reserves the placement it last had and draws nothing until it
registers; Automatic with nothing remembered reserves the rail. Once
frontends settle, a missing pinned provider falls back like Automatic, and
with no provider at all the sidebar uses the list placement and says no
navigation plugin is enabled. A crashing provider is replaced by the
Navigation plugin's provider for its placement, with one toast.

**Core callers on the same path.** bb's Rail and Top list are the bundled,
default-enabled Navigation plugin (`plugins/navigation`), which is on the
forkable list. It registers both through this slot with no host-only API:
the host owns only the placement layout, Settings, the customize editor, and
the navigation model. Rail's header is its New thread button, registered as
`headerComponent`; it does not read the size props.

**Audit before stabilizing.**

1. **Placements.** Confirm two placements cover real providers, or whether a
   rail provider needs a declared width.
2. **Boundary.** Verify providers can express useful navigation without the
   drawer, thread list, footer, resize handle, Settings, or shortcuts.
3. **Arbitration.** Confirm Automatic preferring the first installed
   provider from another plugin over the bundled Rail is right, including
   when several are installed.
4. **Loading.** Confirm an empty region in the remembered placement, now
   also for the bundled Navigation plugin at every boot, is acceptable.
5. **Original.** Remove `experimental_Original` once released plugins stop
   rendering it.
6. **Header alias.** Remove the `experimental_sidebarHeader` alias once
   released plugins pass `headerComponent`.

## `experimental_useSidebarNavigation`, `experimental_useSidebarNavigationSplit`, `experimental_SidebarNavigationIcon` (`@get-bb/plugin-sdk/app`)

**Restored 2026-10-15 (SDK 0.6.53).**

**What it does.** `experimental_useSidebarNavigation()` returns
`{ items, activeItemId, isHomeActive, isShortcutModifierHeld, actions }` from
one model mounted above the sidebar. Items arrive in the user's saved order
with `isVisible`, `isLoading`, `pluginId`, shortcut metadata, and `badge` (the
panel's `experimental_useBadge` value). Plugins written before 0.46 that drew
the removed `experimental_Accessory` item field show no counts until they read
`badge`. Item ids are the keys stored in
`sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`, and items keep
their identity while unchanged. `actions` covers
`activate(id, { target })`, `goHome({ target })`, `setVisible`,
`setOrder` (unknown
ids are dropped and omitted ids keep their relative order at the end),
`openCustomize()` (bb's editor in a popover beside the navigation, after open
menus close, returning focus to the opener), `openDetails`, and
`disablePlugin`. `target` is `current`, `split`, or `tab` and the host handles
the navigation: `split` opens or focuses a pane, replacing the focused pane
at the pane limit. It opens a browser tab instead when the destination cannot
be a pane, splitting is disabled, the viewport is compact, or no split layout
exists. `tab` always opens a browser tab. Both require a synchronous user
gesture. Home accepts `current` or `tab`, with `tab` opening the new thread
screen. `goHome()` without options navigates in place. The bundled Navigation
plugin requests `split` on Cmd/Ctrl-click; the host owns the fallback.
Search remains a command at every target. Native shells
retain their window-open policy.
Existing plugin bundles using `activate(id, { openInSplit })` map `true`
to `target: "split"` and `false` to `target: "current"`, using the same
fallback rules. The SDK types only accept `{ target }`, so rebuilt plugins
must migrate. An explicit `target` takes precedence.

Calls after the caller unmounts do nothing; outside the
sidebar the hook returns no items and inert actions.
`experimental_useSidebarNavigationSplit(id, options?)` mirrors
`experimental_useSidebarThreadSplit` and accepts `activation: "distance"` and
`onDragStart` for rows in menus. `experimental_SidebarNavigationIcon` renders
bb's glyphs and panel icons with plugin branding as fallback.

**Core callers on the same path.** The bundled Navigation plugin's Rail, Top
list, and header New thread button use these hooks; the Settings → Appearance →
Navigation picker reads the same registrations.

**Audit before stabilizing.**

1. **Semantic items.** Confirm the action and icon variants cover current
   navigation without exposing routes or host elements.
2. **Home.** Confirm `isHomeActive` and `goHome({ target })` are the
   right Home contract for rail providers, including after Settings closes the
   compact drawer.
3. **Order semantics.** Confirm `setOrder`'s partial-order rule works for
   drag-and-drop providers.
4. **Accessibility.** Validate labels, badges in accessible names,
   `aria-current`, shortcut metadata, and focus return from Customize in
   third-party markup.

## `PluginContentScriptContext.experimental_setThreadRowStatus`

**Kept experimental (2026-08-22).** The collapsed-section status rollup
consumes it.

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and
clears when that frontend generation deactivates.

Docs: `frontend-core-slots.md`.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration across plugins, frontend generations, and native thread
  statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal;
- the name of `PluginComposerThreadRowStatus.tone`. The field is a state the
  plugin reports (`default | running | success | error`) that the host maps to
  both a color and an animation, so `state` is the candidate rename. Nothing
  under `plugins/*` sets a status today, but about 13 community plugins do
  (bitcomplete/bb-plugins, brsbl/bb-plugins, IMPOSTOR15/bb-plugin-omp-subagents
  among them), so the rename is a breaking change.

## `bb.providers.register` (`experimental_bridgeOptions`, `experimental_visibility`, and the `experimental_providerBridge` artifact export)

**Kept experimental (2026-08-22).** `bb.providers.register` and the
declaration's target-state fields are stable. `experimental_bridgeOptions` and
`experimental_visibility` are used by the bundled ACP plugin
(`plugins/provider-acp/src/declaration.ts`) and by about 21 and 15 community
plugins (Alg0rix/bb-plugin-devin, aqidd/bb-plugin-command-code among them);
decide whether static options survive beside `deriveProviderOptions` before
naming them. The
daemon bootstrap reads the `experimental_providerBridge` export name from
every installed plugin. Renaming it needs a dual-name acceptance window plus a
protocol bump, so it stabilizes with the bridge kit once that deprecation
policy exists.

`experimental_bridgeOptions` is bounded JSON, opaque to core, delivered to
every bridge launch as provider-scoped static options.
`experimental_visibility: "installed"` withholds a provider from unscoped
listings until its `provider/health` is not `not_installed`. The bridge is the
`experimental_providerBridge` export of the plugin's `bb.host` artifact.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1–2.

**Audit before stabilizing.**

1. **Install-order ranking.** Bundled plugins rank by their position in
   `BUNDLED_PLUGINS`; other plugins by `installedAt`. Confirm that a
   reinstalled builtin (tombstone then reinstall) keeping its bundled rank is
   right, and that `installedAt` is the fact users expect for third-party
   order (vs. first-load time). The user overlay (`providerOrder`) is an
   ordered id list that ignores unknown ids; decide whether stale ids should
   be pruned on write.
2. **Icon URL shape.** A path or declared icon is snapshotted at registration
   and served from `/api/v1/system/providers/<id>/logo` (with `?h=<icon
hash>` when the icon has one); a host glyph name
   yields a null `logoUrl` and no server-side resolution. Decide whether the
   host should resolve declared glyph names for providers the way it does for
   plugin branding, and decide the logo route's cache policy, before either
   freezes into clients.
3. **Collision semantics.** Ids are first-come collision-rejected: a staged
   collision fails the whole plugin load; a post-activation registration
   throws to the plugin. A disabled first-party plugin leaves its id claimable
   by anyone until it is re-enabled (which then fails to load). Confirm
   first-wins is right across plugin load order, and decide whether a
   namespace rule (plugin-scoped id prefixes) is wanted before third-party ids
   proliferate.
4. **Bridge delivery.** Every provider bridge arrives as the plugin's one
   `bb.host` artifact. Confirm one artifact per plugin survives (a plugin
   declaring several providers ships one bridge for all of them, and there is
   no way to name a second), confirm the single-bundle shape survives
   per-platform needs, and decide whether a router-kind declaration (a picker
   entry resolving to another provider at submit time) returns as its own
   surface.
5. **What a capability may be.** Apply this test to every remaining
   capability before stabilizing: a declaration may assert what the provider
   itself implements and an external consumer needs pre-session, never what
   bb or its daemon can do with it.
6. **Static bridge options and visibility.** Confirm 64 KiB remains a suitable
   declaration-time limit, that opaque options should continue to be shared by
   every host rather than resolved per host, and whether deep-frozen plain JSON
   is the right stable value contract. Confirm `"always" | "installed"` is
   enough listing policy, that health failure should continue to hide an
   installed-only provider, and that targeted requests may continue resolving
   a registered provider even while discovery says it is absent.

## `@get-bb/plugin-sdk/provider-bridge` (the provider-bridge authoring surface)

**Kept experimental (2026-08-22).** `experimental_defineProviderBridge` /
`experimental_apiVersion` are an artifact↔daemon contract (the bootstrap
refuses anything but version 1 by name), and the deprecation window between
independently-updating artifacts and daemons (item 2) is undecided.

The published module a provider bridge compiles against. It holds
`experimental_defineProviderBridge`, the Provider Bridge Protocol's methods,
the `thread/delta` grammar and param schemas, the bridge kit's helpers, and
the `@bb/domain` command-plane vocabulary those params reference. It is
curated by hand with named exports only, and bundled into the plugin's
artifact rather than stubbed at runtime.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §2,
[provider-bridge-protocol.md](provider-bridge-protocol.md).

Decided (Aug 2026): bridges emit the protocol's own `thread/delta` grammar,
and the `@bb/domain` command-plane, interaction and enum types they reference
stay re-exported through the facade permanently.

**Audit before stabilizing.**

1. **Surface size.** 191 runtime values (314 names with types). Any further
   shrink is a per-name product decision, not a mechanical move.
2. **`experimental_apiVersion` 1.** The bootstrap accepts version 1 only and
   refuses anything else by name. Decide the deprecation window for a version
   bump (a plugin's artifact and the daemon update independently) before the
   first third-party bridge ships.

## `@get-bb/plugin-sdk/provider-bridge/testing` (the provider-bridge testing kit)

**Kept experimental (2026-08-22).** Items 2 and 5 below change the public
shape (a pluggable replay child, pinning a grammar version in the exports).

The published kit a bridge author proves a bridge with, with no private
`@bb/*` package in reach. It contains the conformance runner
(`experimental_runBridgeConformance`), the real delta assembler, the
delta→event collector, the in-process JSON-RPC harness, the calibration
normalizer, and the recorded-replay harness and readers. It is
framework-agnostic and exports named members only:

- conformance: `experimental_runBridgeConformance`,
  `experimental_formatConformanceReport`,
  `experimental_checkRecordedCellReplay`;
- assembly: `experimental_createDeltaAssembler`,
  `experimental_createBridgeDeltaEventCollector`,
  `experimental_assembleCapturedThreadEvents`;
- JSON-RPC harness and calibration: `experimental_createBridgeJsonRpcTestHarness`,
  `experimental_captureBridgeJsonRpcOutput`,
  `experimental_normalizeCalibrationEvents`,
  `experimental_describeCalibrationEvents`;
- recordings: `experimental_readBridgeRecording`,
  `experimental_listRecordedCells`, `experimental_assembleRecordedEvents`,
  `experimental_replayRecording`, `experimental_compareParity`,
  `experimental_resolveProviderBridgeLaunch`,
  `experimental_rerecordCurrentBridgeLane`, `experimental_withCurrentBridgeLane`.

Docs: `providers.md`.

**Audit before stabilizing.**

1. **Calibration normalizer scope.** `experimental_normalizeCalibrationEvents`
   interns the id fields the first-party goldens needed (`turnId`, `itemId`,
   `id`, `parentToolCallId`) and drops `providerCheckpointId`. Confirm the
   defaults against a third-party bridge's goldens before fixing them. The
   JSON-RPC harness duplicates a little of the bridge kit's envelope parsing;
   fold or keep it deliberately.
2. **Replay profile shape.** `ReplayProviderProfile` is the three seams the
   first-party bridges needed (`env`, `rewriteRuntimeLine`, `prepareState`)
   and `ReplayDialect` is the three protocols the replay child speaks
   (`json-rpc`, `claude-cli`, `pi-rpc`). A third-party bridge whose CLI
   speaks none of them cannot replay its provider lanes. Decide whether the
   dialect set grows, or whether the child becomes pluggable, before the
   profile is a promise.
3. **Two shipped programs.** The kit's bundle spawns
   `provider-bridge-worker-entry.mjs` and `replay-provider-child.mjs` from
   beside itself, so the published package carries both under `dist/`.
   Confirm the bundled bootstrap tracks the daemon's; a drift would make a
   replay differ from production in argv or framing.
4. **Workspace-path restoration.** `experimental_replayRecording` rewrites the
   replay's temp workspace back to the recorded `cwd` in every line the bridge
   emits, by textual substitution. Confirm no bridge emits that path in a form
   the substitution misses (URL-encoded, JSON-escaped backslashes on Windows).
5. **The canonical event vocabulary by name.** The kit exports `ThreadEvent`,
   `ThreadEventItem`, `ThreadEventItemPresentation` and the named item kinds as
   types only. The persisted vocabulary therefore has a second public home
   beside `ProviderInfo`, and a breaking change to an item shape is a breaking
   change to the kit. Decide whether the kit should pin a grammar version in
   its exports (the assembler already names `ASSEMBLER_GRAMMAR_VERSIONS`)
   before stabilizing.

## `experimental_scanPublicSdkOnly` (`@get-bb/plugin-sdk/testing`)

Scans a plugin package for imports outside the public SDK and an allowlist.
It returns the files read and each offending specifier: a private `@bb/*`
package, `outside-package`, `dynamic-specifier`, and `@bb/*` package.json
dependencies. The suite asserts on the result.

Callers: no first-party plugin. The in-repo caller is the
`examples/plugins/echo-provider` example (`public-sdk-only.test.ts`); core
checks forkable plugins by building an out-of-repo copy instead
(`scripts/check-plugin-forks.mjs`).

Docs: `testing.md`.

**Audit before stabilizing.**

1. **The allowlist is bb's.** The default admits every published SDK subpath
   and `vitest`; a plugin on another runner or another schema library must
   name it in `allow`. Decide whether the defaults should read the plugin's
   own package.json dependencies instead of a fixed list.
2. **Tokenizer, not a parser.** A dependency-free tokenizer skips comments,
   strings, template literals, regular expressions, and JSX text, then reads
   `import`/`export … from` declarations and `import()`/`require()` calls that
   are not property accesses or method definitions. Lexing is heuristic where
   JavaScript is ambiguous without a grammar: a `/` after `)` is read as
   division, and a `<` in a `.tsx` expression position is tried as JSX and
   falls back when no closing tag matches. Decide whether a full parser is
   owed before the scan is a promise.

## `experimental_trackChildProcesses`, `experimental_createProcessLifeline` and `experimental_createDescendantPipe` (`@get-bb/plugin-sdk/testing`)

Test fixtures for observing processes by handle instead of by PID. A PID check
answers for whichever process holds the number now, and Windows reuses PIDs
quickly.

- `experimental_trackChildProcesses()` records each `ChildProcess` spawned in
  the test process through Node's `child_process` diagnostics channel. It
  offers `children`, `running()`, `waitForExit()`, `killRunning()` and
  `dispose()`.
- `experimental_createProcessLifeline()` opens a local socket (a named pipe on
  Windows). A descendant joins by running `holdSource(label)`. Each holder's
  `exited` and `alive()` follow its connection, and `kill()` signals only while
  that connection is open. `close()` kills the holders still connected.
- `experimental_createDescendantPipe()` makes a POSIX named pipe for shell
  descendants that cannot run Node. A descendant redirects into it, which
  costs no startup time. `opened` and `closed` follow that write end.

All three are wrappers over `@bb/test-helpers/child-processes`, the module core
tests use. The repository rule `scripts/check-test-process-identity.mjs`, run
in CI's plan job, rejects signal-0 probes, PID-argument liveness helpers and
PID inequality assertions in test code. Forkable first-party plugins call
these exports from their tests: Automations, Browser Automation, Codex, Git
worktree, MCP, Pi and Storage retention.

Docs: `testing.md`.

**Audit before stabilizing.**

1. **Holder kinds.** A lifeline holder must be a Node process, because
   `holdSource` is a JavaScript statement. A descendant pipe is POSIX-only,
   and nothing can signal its writer. Decide whether one primitive should
   cover both, and how Windows shell descendants are observed.
2. **Connection lifetime versus process lifetime.** A holder that closes its
   socket early reads as exited, and one that hands the socket to a child stays
   alive through that child. Confirm no caller needs exact process lifetime.
3. **Diagnostics channel coverage.** The tracker sees only `child_process`
   spawns made in this process, not `worker_threads` or processes from native
   addons. Confirm that matches what plugin tests need.

## `app.experimental_useProviders` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** The hook returns `ProviderInfo`, which
carries the unresolved `icon` / `logoUrl` pair and `maintenance`. Stabilizing
the hook freezes that shape.

Returns `{ status, providers }`: every registered provider's `ProviderInfo`
in picker order, whichever machine has it installed, read from the provider
catalog with shared cache, last-known replay and realtime invalidation. Core's
home Recents list reads the same directory (`useProviderDirectory`).

Docs: `frontend-registration.md`,
[provider-plugin-api.md](provider-plugin-api.md) §5.

**Audit before stabilizing.**

1. **Routing.** The hook lists every registered provider, including
   installed-only providers no connected machine has installed and providers
   the user disabled; `available` is the registry's flag, not a per-machine
   check. Decide whether plugins also need a host-scoped roster before
   freezing the signature.
2. **Icons.** A provider's SVG asset arrives as `logoUrl` (drawn as a
   `currentColor` mask) and a named glyph as `icon: { glyph }`; at most one is
   set. Decide whether `icon` and `logoUrl` fold into one `{ glyph } | { url }`
   field when `ProviderInfo` stabilizes, and whether the monochrome mask
   rendering is the contract or a full-color logo path is owed.

## `app.experimental_useCodeTheme` (`@get-bb/plugin-sdk/app`)

Returns `{ mode, name, theme }`: the active light/dark mode, the code theme
name bb renders it with, and the resolved VS Code theme document, for plugins
that render code with their own engine.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Shape of the document.** `PluginCodeThemeData` mirrors Shiki's
   `ThemeRegistrationResolved` minus the fields bb does not promise. Decide
   whether freezing a Shiki-shaped payload is right, or whether the contract
   should be bb's own normalized token model; a Shiki major that changes
   `settings` normalization changes what plugins receive.
2. **Both modes at once.** The hook serves only the active mode. Decide
   whether the state should carry the light/dark pair.
3. **Where the resolve happens.** The document is resolved in the app window
   and cached per theme name for the window's lifetime, so a custom palette
   edited on disk keeps its old document until reload. Confirm that matches
   what the built-in surfaces do.
4. **Consumer count.** One in-repo consumer (Monaco editor). The 2026-11-06
   marketplace audit found it in 22 repositories, which feed it to Monaco,
   Shiki and terminal renderers. Confirm the payload serves the terminal
   engines before the prefix drops.

## `app.experimental_copyToClipboard` (`@get-bb/plugin-sdk/app`)

A plain function, `({ text, html? }) => Promise<boolean>`, over the writer
bb's own copy actions use: bb Desktop's native clipboard, then the Clipboard
API, then `execCommand("copy")`. It resolves true only once a path wrote the
content and never rejects. The test harness records writes in the most
recently rendered slot's `inspection.experimental_clipboardWrites` and
resolves with that slot's `experimental_copyToClipboard` render option
(default true).

**Core callers.** The export is `copyToClipboard` from
`apps/app/src/lib/clipboard.ts`. Core copies call it directly or through
`copyToClipboardWithToast` and `useClipboardCopy`: `CopyButton`, the message
action bar, file preview, terminal, and the Copy thread link thread action.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Content shape.** Only plain text and HTML are supported. bb's message
   copy also writes an image, through its own path with Android and browser
   variants. Decide whether images belong in this contract or stay core-only.
2. **Harness scoping.** The clipboard is global, so the harness routes writes
   to the most recently rendered slot. Confirm that is enough for tests that
   render several slots, and decide whether content-script tests need their
   own capture.
3. **Desktop bridge failures.** A rejected bridge write falls through to the
   browser paths, which can then fail for the reasons the bridge avoids.
   Confirm on Linux Wayland and X11 that the bridge write lands.
4. **Feedback.** Every caller pairs the result with a toast or a manual-copy
   fallback. Decide whether a shared toast helper belongs in the SDK.

## `app.experimental_showErrorToast` (`@get-bb/plugin-sdk/app`)

A plain function, `({ error, fallbackMessage }) => void`, that shows the error
toast bb's own actions show when a request fails. The parameter names are
those of core's `showMutationErrorToast`, which it is. What it shows:

- An `AbortError` (`error.name === "AbortError"`) shows nothing.
- A lifecycle error from the server (`environment_not_ready`,
  `thread_environment_unavailable`, `thread_not_writable` and the other codes
  `apps/app/src/lib/lifecycle-errors.ts` parses) shows bb's own title and body
  for that code.
- Otherwise the title is `fallbackMessage` and the description is the
  failure's message. For an SDK error (`experimental_BbHttpError`) that is the
  message in the server's response body, else the error's message without its
  `HTTP <status>:` prefix. A request that never reached the server ("Failed to
  fetch", "Load failed", "NetworkError") gets "Could not reach the server.
  Check that it is running and try again." Any other error gives its
  message, or `fallbackMessage` when it has none.
- The title and description drop a trailing period. The description is left
  out when it equals the title. A message of "Request failed" shows the title
  "Request failed" with "Please try again".

The toast is an ordinary bb toast with no plugin attribution and lands in the
notification center. The test harness shows nothing and records each call in
`inspection.experimental_errorToasts` of the most recently rendered slot or
mounted content scripts.

**Core callers.** The export is `showMutationErrorToast` from
`apps/app/src/lib/mutation-errors.ts`, which core's mutation hooks and error
paths call directly. bb's thread actions
(`apps/app/src/core-contributions/thread-actions.ts`: Mark read/unread, Pin,
Notify parent, Regenerate title, Unarchive and the bulk forms) reach it
through this export.

**Callers that can migrate.** Each shows an SDK error today with a hand-written
message, and migrating changes the visible toast (the fallback becomes the
title, the server's message the description):

- thread-list: `plugins/thread-list/app/ui/mutation-errors.ts` is a hand copy
  of core's `getMutationErrorMessage`, used as `toast.error(message)` in
  `app/list/ProjectList.tsx` and `app/list/ProjectRow.tsx`;
  `app/rows/moveThreadAction.ts` and `app/dnd/useSectionThreadDnd.ts` drop the
  server's message.
- side-chat (`app.tsx`), push-notifications (`notificationsAction.ts`) and
  drafts (`app.tsx`) show `error.message`, which for an SDK error reads
  `HTTP <status>: ...`.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Lifecycle codes.** The list of codes with their own title and body is
   core's. Decide whether it is part of the contract or may change freely.
2. **Toast options.** There is no id, action or duration. Decide whether a
   caller needs to replace a loading toast or offer Retry, as some core
   mutation paths do.
3. **Message without a toast.** Plugins that show errors inline (memory,
   scheduled-send, concurrency-limit) hand-write `error.message` too. Decide
   whether the message alone belongs in the SDK.

## `app.experimental_saveFile` (`@get-bb/plugin-sdk/app`)

`experimental_saveFile({ fileName, url } | { fileName, blob })` starts a
download through the same function bb's own downloads use. It clicks a
temporary download anchor, using an object URL for a blob. The bb iOS shell
downloads through `WKDownload`, keeping the WebView's request context, then
presents the share sheet; file bytes and cookies do not cross the JavaScript
bridge. The promise resolves `started` once the link is clicked or `failed`,
with an error toast, if it could not start. Completion and share-sheet
cancellation are not reported. The test harness resolves `started` and records
nothing.

**Core callers.** The export is `saveFile` from `apps/app/src/lib/save-file.ts`,
which file preview downloads, chat attachment links in the native shell
(`ConversationAttachments`), and voice-input recording downloads call. The
Tasks plugin's attachment cards call the SDK export.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Outcome shape.** Decide whether callers need completion or cancellation
   beyond the browser-compatible `started` result.
2. **Android.** The native download implementation is iOS only. Decide on
   Android file sharing and browser-created blob download support.
3. **Harness inspection.** Decide whether the harness should record requests
   the way it records clipboard writes.
4. **Link helper.** Decide whether the repeated click handler belongs in a
   shared link component.

## `app.experimental_usePluginId` (`@get-bb/plugin-sdk/app`)

Returns the id of the plugin that owns the calling component, the same value
as `bb.pluginId`.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Hook or setup value.** Code that runs in `definePluginApp`'s setup, not
   in a component, cannot call a hook. Decide whether the builder should carry
   the id as well, or instead.
2. **Scope.** The hook throws outside a plugin slot component. Content scripts
   already receive `context.pluginId`; confirm no other frontend entry point
   needs it.
3. **Consumer count.** Settled. Five in-repo plugins call it (Agent
   Annotations, GitHub Star, Prompt Library, Provider usage, Thread list), and
   the 2026-11-06 marketplace audit found it in 37 repositories.

## `app.experimental_useQuestionFormHost` (`@get-bb/plugin-sdk/app`)

Returns the remappable answer shortcuts bb binds while a pending interaction is
open, keyed by option index, and `registerChoiceHandler` for a chosen index.
`actionShortcuts` and `registerActionHandler` do the same for the form actions
`submit`, `previous`, `next`, and `cancel` (`question.submit`,
`question.previous`, `question.next`, `question.cancel`); action shortcuts also
fire from text fields inside an element marked `data-question-form`. Core's
card uses `actionShortcuts` only for `aria-keyshortcuts` and shows no action
shortcut labels.
Core's own question card (`@bb/shared-ui/question-form`, rendered by
`UserQuestionAnswerForm`) reads the same host through `ThreadQuestionFormHost`.
Outside a pending interaction the maps are empty and handlers never run.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Props or hook.** Decide whether the shortcuts belong in
   `PluginPendingInteractionProps` instead of a hook any component can call.
2. **Scope.** Only pending interactions bind the shortcuts. Confirm no other
   surface (a message action form, a panel) should get them.
3. **Focus marker.** Action shortcuts reach a form's text fields only through
   the `data-question-form` attribute. Decide whether a ref or wrapper
   component should replace the attribute before the prefix drops.
4. **Consumer count.** Two first-party consumers (Ask User Question, pi's
   extension dialogs), through the shared question form. The first
   third-party form is koenvg's pi-subagents provider (2026-11-06 marketplace
   audit); audit items 1–3 against it.

## `app.slots.experimental_providerIcon` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** No first-party plugin registers one,
because declared glyphs and SVG assets cover every first-party provider
without a frontend bundle. About 12 community plugins do
(ai-ecoverse/bb-droid, amrtawfik160/bb-plugin-antigravity,
hxy91819/bb-plugin-acp-profile-icons among them), so the items below can be
audited against them. The remaining questions concern bundle loading cost and
rendering behavior.

Registers `{ providerKind, providerId, icon }`, a React component that draws
one agent, environment, or machine provider's icon in place of its served
`logoUrl`. Exact-kind registrations beat all-kind ones.

Docs: `frontend-renderer-slots.md`, `frontend-components.md`.

**Audit before stabilizing.**

1. **Scoping and overrides.** Cross-plugin icon overrides are allowed. Within
   each kind/id pair, the first claim by sorted plugin id wins and later
   claims warn. Verify kind isolation, specific-over-all precedence, and
   fallback after unload.
2. **Bundle size and boot ordering.** An icon costs a frontend bundle. Every
   enabled plugin's bundle loads after app boot (`fetchFrontendCandidates` in
   `apps/app/src/lib/plugin-frontend.ts`), so until it has loaded the icon is
   absent from the picker and sidebar. Confirm the
   cost is acceptable for third-party icon-only plugins, or add a lighter
   delivery path (e.g. a declared inline SVG string sanitized by the host)
   before freezing the shape.
3. **Disposal and identity.** Audit that a crashing plugin icon is contained
   the way other slot components are (it renders inside host chrome, sometimes
   outside a slot error boundary), and that no host surface caches the
   resolved component across a reload.
4. **Rendering contract.** The host promises only `className` and expects
   inline markup. Decide whether to enforce that (no fetches, no portals, no
   interactive content) before plugins rely on richer components, and confirm
   the accessible label story: the host derives `ariaLabel` from its own
   provider data, falling back to the provider id, and the slot supplies none.

## `experimental_ProviderModelPicker` (`@get-bb/plugin-sdk/app`)

bb's execution picker as a controlled
`{ providerId, model, reasoningLevel, serviceTier? }` component. It has
optional host/environment `routing`, `allowProviderChange`, `align` and
`disabled`, and the composer's catalog and normalization policy.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **Atomic controlled contract.** Confirm the four execution fields should
   remain one value and that selecting a provider should immediately choose its
   verified default rather than wait for an explicit model click.
2. **Routing.** Omitted `routing` follows the server's primary-machine routing;
   `{ kind: "host", hostId }` and `{ kind: "environment", environmentId }`
   cover machine- and workspace-dependent catalogs. Confirm those two routes
   are sufficient before stabilizing the discriminated union.
3. **Capability policy.** Confirm an unsupported provider should omit
   `serviceTier` while supported providers retain the controlled tier, and that
   reasoning should continue using the composer's closest-supported policy.
4. **Catalog failure and normalization policy.** Placeholder, failed, and empty
   catalogs never change the controlled value. A verified catalog, possibly
   the machine's stored one while a refresh runs or keeps failing, normalizes
   stale values while selected-only retired models survive. Confirm silent
   retention on failure and automatic correction on success are preferable to
   explicit callbacks.
5. **Scope.** Validate settings and compact-form usage in external plugins,
   especially whether they need an explicit loading/error callback. Tasks and
   Automations currently rely on the picker-owned loading/error UI.

## `experimental_PermissionModePicker` (`@get-bb/plugin-sdk/app`)

bb's permission picker as a controlled
`{ providerId, value, onChange, routing?, align?, disabled?, className? }`
component. It applies the composer's supported modes, fallback order and the
routed machine's permission ceiling.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **Controlled reconciliation.** Confirm automatic `onChange` after an
   authoritative capability/ceiling change is preferable to a separate
   invalid-state callback, and that provisional failures should remain
   read-only without changing the caller's value.
2. **Routing and provider coupling.** Confirm requiring both `providerId` and
   the shared host/environment routing is the right composable boundary. A
   provider switch across two sibling controls settles in two controlled
   updates rather than one combined execution tuple.
3. **Single-mode presentation.** Confirm compact/settings consumers should
   see a locked summary when only one mode is supported, while first-party
   composer call sites may continue hiding a non-choice.
4. **Permission ceiling behavior.** Audit hosts whose ceiling is below every
   mode a provider supports and decide whether the picker should render an
   explicit unavailable state instead of the controller's existing fallback.

## `app.slots.experimental_timelineRenderer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** No first-party plugin registers one. Two
community plugins do: dpolishuk/bb-zcode renders its `zcode/workflow-graph`
extension rows, and gpambrozio/bb-plugins' learning-exercises renders a form's
history. Every item is about the prop shape, so audit it against those
renderers before stabilization.

Registers `{ kind, component }` to render the expanded body of the plugin's
own extension rows (`"<pluginId>/<name>"`), of `"tool"` rows from its
providers, or of a `requestInput` form's history (`"<pluginId>/<rendererId>"`).
The row header stays host-rendered, and a crash falls back to the declarative
base.

Docs: `frontend-renderer-slots.md`, `backend-cli-agents.md` (form rows),
[provider-plugin-api.md](provider-plugin-api.md) §5.

**Audit before stabilizing.**

1. **Body versus whole row.** Decide whether a plugin may also replace the
   header (an inline widget with no disclosure, e.g. a goal card) before
   freezing the prop shape, and whether `suppress` should stay a bridge-only
   decision or the renderer may opt a row back in.
2. **Tool-row payload.** A `"tool"` row hands the renderer
   `{ arguments, output }` where `output` is the server's inline preview for
   long outputs. Decide whether the renderer gets the full output on demand or
   only the preview.
3. **Provider ownership source.** `"tool"` scoping reads the thread's
   `ProviderInfo.pluginId` from the nearest thread provider context. A host
   surface that renders rows with no such context, and a provider whose plugin
   was uninstalled, both resolve to "unknown owner", so no renderer applies;
   confirm that is the right failure mode for both.
4. **Legacy rows.** `presentation` is null on a tool row persisted before
   bridges attached one. Decide whether the renderer should see such rows at
   all, or only rows with a presentation.
5. **Mobile parity.** Mobile renders the declarative base and loads no plugin
   JS (by design). Confirm the base (label, glyph, tint, title, detail) is
   sufficient for the first-party extension kinds before a third party
   relies on a web-only upgrade.
6. **Form rows.** Decide whether form and extension rows need distinct `kind`
   values.

## `experimental_NewThreadComposer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** Items 1 (a newly required create-thread
field going missing silently) and 6 (projectless switching) were waiting for
a consumer. The 2026-11-06 marketplace audit found it in 32 repositories, so
both can be validated against them.

The host-owned new-thread compose surface. It calls `onSubmit` with a
`NewThreadRequest` carrying every resolved selection (including
`sessionOptions` when the user changed a provider's agent option), and the plugin then
creates the thread with `bb.sdk.threads.spawn`, which owns filing and
attribution. A submission from a plugin's `useComposer().submit({ experimental_data })`,
such as Drafts' "Save draft" send-menu row, also carries
`pluginSubmission: { pluginId, data }`, the field `threads.spawn` already
accepts, so forwarding the request unchanged keeps the row working; the
server hands it to dispatch hooks as `experimental_submission`. The New thread
screen submits the same `NewThreadRequest` type (`RootComposeView`), so core
and plugins share one declared request. Conductor's `NewChatPage` forwards it
to `spawn`; community embedders that rebuild the request field by field drop
it and turn "Save draft" into an ordinary send.

**Core callers.** The New thread screen (`RootComposeView`) renders the same
`apps/app/src/components/promptbox/NewThreadComposer.tsx`;
`PluginNewThreadComposer` adapts it for the SDK, and its round-trip tests
(`PluginNewThreadComposer.test.tsx`, `new-thread-environment-seed.test.ts`)
guard the seed mapping against the root composer's environment resolution.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **`NewThreadRequest` vs. what `threads.spawn` accepts.** Confirm every
   field still round-trips through `bb.sdk.threads.spawn` unchanged, that
   `executionInputSources` still means the same thing to the server, and that
   no newly required create-thread field is silently missing. The adapter
   stamps `executionInputSources.providerId: "explicit"` on every submit;
   confirm that provenance is right before freezing the shape.
2. **Page-level behavior the adapter skips.** Fork seeds, the guided
   machine-setup dialog, and codex-version submit blocking are deliberately
   absent; quick-create-project is passed through. Confirm
   none of them has become load-bearing for correctness on a plugin surface.
   Without codex-version blocking, a plugin can submit to a machine whose CLI
   the primary surface would have refused.
3. **Draft and selection scoping.** Drafts persist under `draftKey ?? pluginId`
   and execution selections are component-local, so a plugin panel never
   rewrites the user's root-composer defaults. Confirm that is still what
   plugin authors expect, and that `draftKey` is the right knob (versus a
   per-instance ephemeral draft).
4. **Plugin composer host binding.** It binds the same plugin composer host
   as the New thread screen (scope `{ kind: "new-thread", projectId }`), so
   plugin composer contributions and `useComposer()` writes reach a composer
   a plugin renders. Confirm that is wanted before stabilizing.
5. **Seeding props and the round-trip guarantee.** The `default*` props are
   uncontrolled seeds that re-seed on any value change, including
   user-touched selections. `defaultEnvironment` cannot represent
   `project-default`, `personal` without a `hostId`, or an `unmanaged` `path`.
   Confirm the seed mapping still inverts the root composer's environment
   resolution, and decide whether re-seed-on-change should instead be an
   explicit reset nonce.
6. **Projectless contract.** The picker always offers "Don't work in a
   project", even when a plugin seeds a specific project; that choice submits
   the personal-project id with a `personal` workspace. Confirm unconditional
   project switching is right for embedded plugin workflows, rather than
   adding an explicit project-locking policy.

## `app.slots.experimental_appOverlay` (`@get-bb/plugin-sdk/app`)

Mounts a no-props plugin component once per app window, outside route-owned
layout, with app-level SDK hook context. A crash hides only that overlay.

Callers: Browser Automation (preview lightbox), Conductor (`bridge`), Git
(commit dialog), GitHub Star (star prompt) and Push notifications
(`delivery`), plus about 128 community plugins. Three of the five bundled
overlays use it as an invisible host rather than a floating widget:
Conductor's bridge and Push notifications' delivery render no UI, and Git's
overlay hosts a dialog that a thread action opens through module state
(`plugins/git/ui/commit/commit-store.ts`).

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Name and boundary.** Confirm "app overlay" is broad enough for floating
   widgets, launchers, and transient app-wide UI without inviting plugins to
   replace host-owned navigation or layout.
2. **App-level versus pane-level context.** Define the selected route in split
   layouts and document which pane-local capabilities remain unavailable to a
   once-per-window owner, including composer and side-panel hosts.
3. **Host-owned layer.** Decide whether arbitrary fixed/portalled content is
   sufficient or bb should provide a named overlay root, z-index band,
   collision area, docking, or drag persistence.
4. **Responsive and accessibility policy.** Audit keyboard access, focus
   restoration, escape behavior, compact drawers, reduced motion, and whether
   any of those must become host-owned rather than plugin-owned.
5. **Multiplicity and budgets.** Registrations are additive with no cap.
   Measure startup, query fan-out, visual collisions, and several plugins
   mounting persistent widgets in one window.
6. **Lifecycle.** Verify exact once-per-window mounting across route changes,
   split changes, frontend reload, disable, uninstall, app teardown, and
   multiple desktop windows or browser tabs.
7. **Crash and stylesheet lifetime.** Confirm a hidden crash fallback and the
   standard slot-owned CSS retention are the right failure semantics for UI
   that may have no in-layout representation.

## `app.slots.experimental_newThreadPanelAction` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** Item 5 was deferred until an external
plugin adopted the slot. That has happened: the 2026-11-06 marketplace audit
found registrations in 16 repositories, among them taskboard, aura,
bookmarks, git-deck, jira and file-manager. Item 5 can now be audited against
them. No in-repo plugin registers it.

Adds a row to the root New thread screen's right-panel Actions list. The row
can open a closable tab with `{ projectId: string | null, params: JsonValue | null }`.
It is separate from thread action tabs (`app.slots.experimental_tab` with a
thread context and `availability: "action"`), which require a `threadId`.

Docs: `frontend-core-slots.md`.

Before stabilization, audit:

1. **Surface naming.** Confirm "New thread" remains the product name and the
   slot should stay panel-specific rather than becoming a broader root-compose
   action surface.
2. **Context breadth.** Confirm the selected `projectId` is sufficient. A
   plugin can use the composer hooks for the live draft, but the slot does not
   expose the root composer's selected host, environment, provider, or model.
3. **Project changes.** An open tab receives the current project on every
   render, while `run` receives the project selected when the row was
   activated. Confirm that distinction is intuitive and whether changing
   projects should close or re-key open tabs.
4. **Persistence.** Tabs and JSON params persist in the root panel's fixed
   state. Confirm restoring a plugin tab before registrations load, after a
   plugin is removed, and in projectless compose has the right fallback.
5. **Relationship to thread action tabs.** Confirm separate opt-in remains
   preferable to a unified discriminated context. Every external registrant
   also registers a thread-context tab: 13 repositories through the retired
   `threadPanelAction` adapter (taskboard, file-manager, project-files,
   Connected Files and others), and 4 through `experimental_tab` (maxwell,
   bureaucat, todo, jira; rebryk's repository has one of each). Check whether they
   pass the same component to both, which would favor merging. Decided: both
   contexts open tabs through `panel` (see Panel controller),
   where a thread-context action reference resolves against this slot on the
   New thread screen. Audit only whether the two contexts should merge.

## `app.experimental_sidebarFooter` (`@get-bb/plugin-sdk/app`)

Registers host-rendered icon items in the sidebar footer: an `action` with
`onActivate`, or a `disclosure` whose component is revealed above the row and
receives `dismiss()`. A disclosure registration returns an
`open`/`close`/`toggle` controller, and only one disclosure is active across
all plugins.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Naming and shape.** Confirm `sidebarFooter`, `action`, and `disclosure` are
   the durable concepts, and whether the managed namespace should keep one
   discriminated `register` method or split registrations by behavior.
2. **Imperative controller.** Validate real plugins can issue open requests
   without leaking subscriptions across frontend generations. Decide whether
   a declarative external-store contract would be safer.
3. **Programmatic opening.** Confirm `open()` should remain available. The
   intended policy is direct user-driven flows; background changes should not
   surprise-open sidebar content.
4. **Disclosure lifecycle.** Components currently mount only while open and
   remount after dismissal. Confirm plugins do not require retained hidden state,
   or add an explicit retention policy before stabilizing.
5. **Footer capacity.** Establish overflow behavior when several plugins
   register items, including compact viewports and icon-collapsed sidebars.
6. **Compatibility.** Migrate representative users of
   `sidebarFooterAction`, then decide whether stabilization replaces and
   deprecates that method or keeps action registration in both surfaces.
7. **Focus and dismissal.** Validate icon toggling, Escape, focus return,
   disclosure replacement, plugin reload, crash isolation, and removal while
   open across desktop and compact sidebar layouts.

## `app.slots.experimental_threadList` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** bb's own sidebar list (the bundled
`thread-list` plugin) and Conductor ship through it, as do the
replacement-lab examples and about 36 community plugins. No shipped consumer
has tested the arbitration/fallback model or the accessibility contract.

An exclusive slot that replaces the sidebar's scrolling thread list. bb's own
list is the bundled `thread-list` plugin. Automatic selection prefers another
registered list, and the user can pin one with `sidebar.threadListProvider`.

Docs: `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned, with installed lists preferred
   over the bundled one, is the right long-term selection model and
   alphabetical plugin-id order is an acceptable default tie-breaker when
   multiple replacements are enabled.
2. **Fallback discoverability.** Confirm one toast plus the placeholder's
   Reload button is the right signal when the list crashes.
3. **Region boundary.** The plugin gets the scrolling list and nothing else:
   the New-thread button, the navigation rail, and the footer stay
   host-rendered. Confirm no real sidebar needs to claim more, and that
   passing those regions down as props (letting a plugin place them, at the
   risk of dropping them) stays the wrong trade.
4. **Accessibility.** Confirm the host can still guarantee list semantics,
   focus order, and the mobile close behavior when a plugin owns the markup;
   `onNavigate` is currently the plugin's responsibility to call.

## `PluginThreadListProps.experimental_scrollElement` (`@get-bb/plugin-sdk/app`)

The sidebar element that scrolls an `experimental_threadList` component:
core's `SidebarContent`, owned by `SidebarThreadListContent`
(`apps/app/src/components/sidebar/PluginThreadList.tsx`), which `AppSidebar`
renders. Core mounts the list only after that element exists, so the prop is
never null; it changes only when the list remounts (desktop to compact
viewport). Lists window rows, root an `IntersectionObserver`, and
drag-autoscroll against it instead of `closest('[data-sidebar="content"]')`
or walking up to the nearest `overflow: auto` ancestor.

Core caller on the same path: the bundled `thread-list` plugin reads only this
prop, through `SidebarScrollAreaProvider` (`plugins/thread-list/app/ui/sidebar.tsx`),
for windowing (`SidebarWindowedItems`), "is the list shown"
(`useSidebarListShown`), and visible-row order for Shift-click selection
(`ThreadSelectionStore`). Community callers that can migrate: the
`closest()` forks (bb-tinted-threads, oxi-thread-list) and the drag
autoscroll walkers (thread-tree, switchboard, chat-sidebar, recent,
bb-sidebar, cursor-suite project-sort).

Docs: `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **Migrated callers.** At least two community lists window or autoscroll
   against the prop, with no remaining DOM walk for the sidebar scroller.
2. **Scroller opt-out.** nested-sidebar and cursor-sidebar override the host
   scroller with CSS to run their own. Decide whether a list may declare its
   own scroller, or whether the host element stays the only one.
3. **Identity.** Confirm the element still changes only together with a list
   remount if the sidebar layout changes (placement, framed sidebar, split
   panes).

## AI services (`bb.experimental_aiServices.register`)

Registers `{ id, displayName, complete?, transcribe?, status? }`. `complete`
serves thread titles and commit messages, `transcribe` serves voice input,
and `status` feeds pickers and Automatic. The user selects per task
(`automatic`, `off`, or `{ pluginId, serviceId }`), and an explicit pick
never falls through to another service.

Docs: `backend-cli-agents.md`, [provider-plugin-api.md](provider-plugin-api.md) §7.

**Audit before stabilizing.**

1. **Structured input.** Confirm a bare prompt string stays enough, or whether
   services need the task (title vs commit) or a length hint without breaking
   the "plugin owns the model" split.
2. **Status freshness.** The picker and the microphone can show a status up
   to 10 s stale, and a task past that age waits up to 2 s for a fresh one; a
   plugin whose readiness flips (sign-in, quota) might want to push a change
   instead of waiting for the next poll.
3. **Voice payloads.** `transcribe` receives the whole `File` in process
   (25 MB cap). Decide whether streaming matters for long recordings.
4. **Automatic order as policy.** Core prioritizes bb cloud, then sorts
   by plugin id and service id, including third-party plugins. Decide whether
   this order and automatic inclusion should become user-editable settings.
5. **Several services per plugin.** Confirm the id-per-registration shape and
   the per-plugin id scope (plugin id plus service id).

## `PluginFileOpenerSource.experimental_hostId` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** It is persisted in opener-tab `paramsJson`,
so a rename needs a read-compat shim. Items 3–4 decide whether the stable name
is `hostId?` or a required field.

Names the explicit host for a project-backed workspace file that a file opener
cannot route through a thread or environment. It is omitted for the other
source kinds and for the primary host.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. Confirm an explicit host id is the minimum missing project-routing context,
   rather than exposing the whole project workspace routing union.
2. Verify project-compose file tabs retain the selected host across reloads,
   host changes, plugin fallback, and per-open viewer overrides.
3. Decide whether host identity should be present for every source kind or
   remain project-specific once more file opener plugins exercise the API.
4. Confirm omission should continue to mean primary-host resolution, that this
   remains compatible with persisted opener tabs created before the field
   existed, and whether it can become a stable required `hostId` without
   breaking older opener implementations.

## `experimental_VoiceInputTextarea` (`@get-bb/plugin-sdk/app`)

**What it does.** A host-owned controlled textarea with bb's voice input. It
takes `value`, `onValueChange`, and an optional `onVoiceInputActiveChange`;
every other textarea attribute, including `ref` and `className`, reaches the
underlying `<textarea>`. The caller styles the textarea; the host wraps it in
a relative container and, when the browser supports voice input, adds bottom
padding and the microphone, waveform, cancel, and stop controls. Finished
transcripts are appended to `value` through `onValueChange` and stay editable;
nothing is submitted. `onVoiceInputActiveChange` is true from the start of
recording until transcription finishes or is cancelled, and false on unmount,
so a form can hold navigation and submission. Unmounting discards late
transcripts. It uses the same microphone preference, transcription service,
and error handling as the prompt box. Without voice support it renders the
plain textarea; the test harness renders that plain textarea too.

The registry's `voice-input-textarea` item re-exports it, and the registry's
`question-form` renders its free-text answer with it. Inside bb, the built-in
Ask User Question and pi plugins and bb's own question form reach the same
component through the `@bb/shared-ui/voice-input-textarea` module the build
shims.

**Audit before stabilizing.**

1. **Prop surface.** Every textarea attribute passes through. Decide whether a
   narrower explicit list is the better contract, and whether callers need to
   style the host's wrapper (it is a plain block today, so a flex child cannot
   stretch it).
2. **Voice lifecycle.** Verify cancellation, microphone permissions, mobile
   capture, and late transcription isolation when the component unmounts or
   its `value` changes mid-transcription.
3. **Unsupported hosts.** The textarea renders without controls when voice is
   unsupported, with no reason shown. Decide whether callers need the
   unsupported reason or a way to hide the controls.
4. **Consumer count.** One in-repo form (the shared question form, used by Ask
   User Question, pi, and bb's own questions). The 2026-11-06 marketplace
   audit found three third-party consumers (pr-xray, shipyard,
   inline-comments).

## `experimental_SourceCode` / `experimental_Diff` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** The GitHub plugin renders `Diff`, and
about 17 community plugins render `SourceCode` and 32 render `Diff`
(abdoutelb/bb-plugin-files-editor, ahkohd/bb-box, AdzeB/bb-plugin-pr-notes
among them). Items 2–4 all change the prop surface.

Host-owned renderers for supplied code. `experimental_SourceCode` takes text
and a path. `experimental_Diff` takes a single-file patch, a path and
optional `experimental_fullFileContents` (`{ old, new }`). They are the same
components bb's own surfaces use, so an active renderer replacement covers
both.

Docs: `frontend-components.md`.

Decided (Aug 2026): context expansion takes caller-resolved contents, not a
loader callback.

**Audit before stabilizing.**

1. **Prop surface.** Confirm content + path + presentation plus optional full
   diff sides is the right minimal contract, and decide whether `className`
   belongs in it at all. A replacement never receives it, so a `className`
   that only styles bb's renderer is a quiet inconsistency.
2. **Diff input shape.** Confirm single-file patch text is the right currency.
   Multi-file patches, pre-parsed input, and per-hunk rendering are all things
   callers have wanted; none are expressible now.
3. **Language selection.** Highlighting is inferred from `path` only. Confirm
   an explicit language override is not needed before the names freeze, and
   that no implementation-library language union leaks in when it is added.
4. **Worker pool.** Thread panes and plugin nav panels provide bb's
   highlighting worker pool; homepage and settings sections do not, so a diff
   rendered there is unhighlighted. Decide whether the host should provide the
   pool at the component instead of the surface.
5. **Selection to chat.** Inside a thread view both components offer Add to
   chat from the host's selection context, with no prop. Confirm plugins
   should not control it through a prop or `useComposer()`.
6. **Size and virtualization.** Neither component caps input size or
   virtualizes. Audit against a plugin that renders a very large file or patch.

## `experimental_FilePreview` (`@get-bb/plugin-sdk/app`)

Host-owned side-panel preview of one live file target. bb loads the file and
draws its usual preview header (path, Preview/Raw toggle, open in browser,
Open in editor, download, and the file menu with copy and refresh) and its
loading, empty, missing and error states. `renderPreview({ content, url })`
draws the Preview body of an HTML, Markdown or CSV file in place of bb's;
`url` is the absolute raw-file URL. Raw mode and every other file type keep
bb's rendering, and a refresh passes the new text. Inside a panel tab it
loads only while the tab is showing, the visibility `experimental_useTabVisible`
reports; elsewhere it loads at once.

**Core callers.** It renders the same workspace, thread-storage and host file
tab contents the side panel renders, so the header, loading and refresh are
core's own; core's previews reach `FilePreview` through those components with
no body override. Open in editor uses `useLiveFileOpenTargets` and the
`openFileExternally` intent, the path core's file previews use. The first
plugin caller is the Inline visualizations `page` file opener, which draws the
themed inline-vis frame as the body.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. Decide whether the body override should also cover files without a
   Preview mode (plain text, images), and what the toggle shows for them.
2. Confirm surface-specific header behaviour: core's thread view passes its
   own Open in editor handlers and a line number for host files; the
   component passes none, and Add to chat comes only from the surrounding
   `SelectionAddToChatContext`.
3. Decide whether `renderPreview` should receive the line range a file open
   requested.

## `experimental_ImageLightbox` (`@get-bb/plugin-sdk/app`)

bb's full-screen image and video viewer, shipped with the forkable composer
(#6122). The caller owns the item list and the open state: it passes one
`imageSrc`, `imageAlt`, a screen-reader `title` for the dialog, and an
optional `mediaType` (`"image"` by default). The viewer is open while
`isOpen` is true, or, without `isOpen`, while `imageSrc` is non-null; open
with a null `imageSrc`, it shows a loading state. With `hasMultipleImages` and
both `onPrevious` and `onNext`, it draws previous and next buttons, and
ArrowLeft/ArrowRight call them unless `previousDisabled` / `nextDisabled` is
set. `navigationStatus` is drawn as a caption when given. Escape, a backdrop
click, a click on an unzoomed image and the close button call `onClose`.
Images zoom and pan (up to 8x). The test harness renders a plain `<img>`
while the viewer is open.

**Core callers.** The runtime member is core's `ImageLightbox`
(`apps/app/src/components/ui/image-lightbox.tsx`), the viewer behind the
timeline image gallery, message attachments, Markdown previews and image file
tabs. The bundled composer's attachment previews reach it through this export.
Outside plugins: three repositories in the 2026-11-06 marketplace audit
(asana, mattermost, and smsunarto's html and t3-composer plugins), some of
them outside any composer.

Docs: `frontend-renderer-slots.md`.

**Audit before stabilizing.**

1. **Ownership of the list.** Callers with several images implement index
   wrapping and the status text themselves. Decide whether the component should take the item list
   and current index instead of single-item props plus navigation callbacks.
2. **Open state.** `isOpen` and `imageSrc !== null` both control visibility.
   Decide whether one of them should go.
3. **Media scope.** Confirm `mediaType` should stay limited to image and video,
   and whether video needs its own controls in the contract.
4. **Documentation home.** It is listed with the composer's host components
   but is used outside composers. Decide whether it belongs in
   `frontend-components.md`.

## `app.slots.experimental_sourceCodeRenderer` / `app.slots.experimental_diffRenderer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** `experimental_diffRenderer` has one
community registration (image-diff); `experimental_sourceCodeRenderer` has
none, and bb bundles neither. "Two slots or one" changes the registration
shape.

Exclusive slots that replace bb's source or diff renderer everywhere it draws
supplied content, including other plugins' calls to the public components.
Selection follows the shared exclusive-slot rule (`resolveExclusive`); the
picks are the synced `sourceCode.provider` and `diff.provider` UI preferences
(Settings → Appearance, `bb settings ui`), and
`__builtin__` keeps bb's renderer. A crash falls back to bb's renderer.

Docs: `frontend-renderer-slots.md`.

Decided (Aug 2026, revised Nov 2026): the pin is a synced UI preference like
every other exclusive slot (device-only picks migrate to it once); a crash swaps back to bb's
renderer silently and disables the slot for the session; the replacement is
global, other plugins' surfaces included; replacements receive
`experimental_fullFileContents` like the public component.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned/built-in is the right long-term
   selection model. The two renderers pin independently; confirm users do not
   instead expect one "code rendering" choice.
2. **Global reach as precedent.** No other slot lets a plugin reach into
   another plugin's rendered output. Audit that before it is copied.
3. **Capability parity.** Selection-to-chat and the deleted-file gate remain
   host-only. Confirm that asymmetry is acceptable, or promote either
   capability before stabilization.
4. **Two slots or one.** Confirm source and diff should stay separately
   replaceable rather than one "code renderer" registration.

## `app.slots.experimental_codeFenceRenderer` (`@get-bb/plugin-sdk/app`)

Renders fenced code blocks of the claimed `languages` in assistant and
nested-agent message Markdown, where `messageDirective` activates. The
component receives `{ code, language, status, index, message, Original }`,
mounts once per fence, and survives streaming: the host owns the instance and
portals it to a placeholder keyed by the fence's source offset, keeping
iframes alive where `Element.moveBefore` exists. A language several plugins
claim follows the shared exclusive-slot rule (`codeFence.byLanguage`, Settings
→ Appearance → Markdown, one row per set of languages with the same
claimants). A missing plugin and a throwing fence fall back to
`Original`. The harness
exposes `loadPluginApp(...).codeFenceRenderers`.

**Core callers.** `MarkdownPreview`'s code renderer
(`markdown-code-fence-renderers.tsx`), the pipeline that also resolves
`messageDirective`, hosts every claimed fence; the built-in `inline-vis`
plugin renders through it. BB's `mermaid` diagram stays a core special case
inside `Original`, because it renders on every Markdown surface and this slot
is scoped to messages.

Docs: `frontend-renderer-slots.md`, `testing.md`.

**Audit before stabilizing.**

1. **Collision model.** Confirm the per-language pick and the grouped
   Settings row are enough for real clashes (bang-shell and inline-terminal
   share six shell languages).
2. **Streaming contract.** Confirm `code`/`status`/`index` cover real
   generative-UI renderers (partial JSON/DSL parsing), and whether the rest
   of the info string should be exposed as `meta`.
3. **Scope.** Confirm the slot should stay limited to assistant and
   nested-agent Markdown, whether common languages (`json`, `ts`) should be
   claimable, and whether `mermaid` should be claimable or reserved for BB.
4. **Identity.** Confirm keying a fence by source offset holds for every
   path that rewrites a message's text, and decide whether iframes must
   survive the tail-to-settled move in browsers without `moveBefore`.
5. **Source visibility.** Decide whether BB should offer its own "view
   source" control for claimed fences instead of leaving it to each plugin.

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** The hold was for a consumer, so item 4
(a paged or windowed read at 10k threads) could be resolved against one. The
read hook now has many: the 2026-11-06 marketplace audit found it in the
sources of 79 repositories. 29 of them replace the thread list through
`experimental_threadList`. The rest read it for boards, dashboards and
switchers, such as bb-office, agent-graph and agent-tv. Item 4 can now
be measured against them, and it changes the contract. Item 5 (the draft
indicator gap) was closed by `useSidebarThreadDraft` (#4025).

The read hook returns the sidebar's live thread view (`PluginSidebarThread`
DTOs with a host-resolved `indicator`, plus `sections`) from the host's own
query and cache. The action hook is `@internal` and scheduled for removal
(see Scheduled removals). Neither
doc covers three September 2026 additions:

- `experimental_lifecycles` (active, archived, or both; active by default).
  With it, `PluginSidebarThreadsState.experimental_archived` exposes archive
  loading/error state, pagination flags and `fetchNextPage`; it is null for
  active-only reads.
- `PluginSidebarThreadsState.experimental_hosts`, the current machines in host
  query order, including those with no threads. Older hosts may omit it.
- `openNewThread({ hostId })`, unprefixed by request, preselects a machine for
  a new environment. `environmentId` takes priority.

Docs: `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **DTO scope.** Confirm every field earns its place and that the copy stays
   worth its maintenance over `ThreadListEntry`. `hasUnsubmittedDraft` is
   deliberately absent (client-local composer state); rows read it from
   `useSidebarThreadDraft(threadId)` instead. `status` and `runtimeStatus` freeze the domain enums into the
   contract the way `indicator` does, under the same treat-unknown-as-fallback
   rule. `host` is resolved to `{ id, name }`; confirm resolution belongs here
   rather than in a separate hosts hook, and that falling back to the id for an
   unknown host is the right failure.
2. **Indicator coupling.** `indicator` freezes bb's precedence into the
   contract. Confirm new kinds can ship without breaking plugins, and that the
   documented "treat unknown as none" rule is enough.
3. **Unread semantics.** `isUnread` is plain read state, so it is true for
   child threads and running threads that `isUnreadDoneThread` excludes by
   design. Confirm that is the more useful primitive for a replaced list.
4. **Scale.** Confirm one array of every thread is right at ten thousand
   threads, versus a paged or windowed read. Unchanged threads keep their DTO
   identity across refetches, but the host does not cap the array and plugin
   lists are expected to window their rows. Decide whether that expectation
   should be enforced by the contract before stabilizing.
5. **Draft indicators.** Decided (#4025): `indicator` still never reports
   "draft" or "working-draft". A row composes it with
   `useSidebarThreadDraft(threadId)`, and a collapsed group with
   `useSidebarThreadDraftIds()`, the client-local state bb's own rows read.
6. **Sections.** Section writes are plain public API calls rather than
   actions. Confirm that split holds once a replaced list ships section
   drag-and-drop, where the built-in list's optimistic cache transactions have
   no plugin equivalent. `openNewThread`'s `sectionId`, `environmentId` and
   `hostId` ride on router state; confirm that stays the right transport, and
   audit the `hostId` selection semantics.
7. **Pull requests on a row.** `experimental_useSidebarThreadPullRequest` was
   removed; rows render `experimental_ThreadRowMetadata` for bb's badge or read
   the GitHub PR Status plugin's keyed `pullRequests` method. See
   "Retired `experimental_useSidebarThreadPullRequest` runtime member".
8. **`experimental_useSidebarThreadSplit`.** Gives a custom row the built-in
   drag-to-split gesture, with every layout rule owned by the host. Confirm a
   list with its own pointer-drag (reorder, swipe) still composes with the
   host's engage threshold; that `splitProps` staying an open object is the
   right forward-compatible shape, or whether it should narrow to a named
   handler; and that exposing the full `panes` array does not leak more
   layout state than a row needs. `options.dragThreadIds` lets a row in a
   multi-row selection carry every selected thread: such a drag offers no
   split targets and drops onto a composer as one mention per thread (the
   built-in thread list is the caller). Confirm a mentions-only multi-drag is
   right, or whether it should open several panes.
9. **Archive selection and machine list.** Audit archive-only
   loading/errors, combined views, pagination retries, and archived row
   actions. Audit empty machine sections, machine removal, rename updates, and
   loading behavior for `experimental_hosts`.

## `experimental_useThread` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.190.

- **Surface:** `PluginSdkApp.experimental_useThread(threadId): ExperimentalThreadState`, `ExperimentalThreadState` and `ExperimentalThread`.
- **Behavior:** one thread by id. `ExperimentalThreadState` is `{ status: "loading" | "notFound" | "error", thread: null }` or `{ status: "ready", thread }`. A thread the sidebar's per-thread entry store holds (`useSidebarThreadEntry`, `apps/app/src/lib/sidebar-thread-entries.ts`) is ready at once with no request, and the component re-renders only when that thread's entry changes. Any other thread (archived, unloaded, or before the sidebar's first load) is read with the thread query behind `useSdk().threads.get` (`useThread`), then kept current by its realtime subscription. A 404 from that read, which covers unknown ids, deleted threads and threads in deleted projects, is `notFound`, also when the query still holds the thread's earlier data, as it does after a watched thread is deleted. Thread data with a non-null `deletedAt` from either source is `notFound` too. Any other failure with no data is `error`. A held thread that leaves the store (archived, for example) keeps its last held value as `ready` until the fetch answers, so the state goes ready to ready rather than through `loading`; that memory lives in the component's own store subscription (`useTrackedSidebarEntry`). An empty id is `notFound` with no request. `ExperimentalThread` is the domain `ThreadWithRuntime`: the fields `threads.get` returns without `activeBackgroundAgentCount`, `canRestoreEnvironment`, `canEditMessages`, `canSpawnChild` and `queuedMessageCount`, which only that request computes. Both sources are projected onto exactly those fields, so a held and a fetched thread have the same shape. The shape follows `threads.get` rather than `PluginSidebarThread`: it carries `deletedAt` and none of the row-only fields (`indicator`, `indicatorLabel`, `activity`, `queuedWork`, `hasPendingInteraction`, `pinSortKey`, the flattened `environment*` fields).
- **Core callers:** `useThreadState` (`apps/app/src/lib/thread-state.ts`) is the one implementation behind the SDK member. `useParentThreadSection` (`apps/app/src/views/thread-detail/useParentThreadSection.ts`) calls it for the current thread and for its parent or fork source, and has no fetch or fallback of its own. It feeds core's parent-thread segment (`ThreadPromptContextBanner.tsx`: summary, details and `useVisible`, in the writable and read-only banners) and the context card's parent row (`ThreadContextCardCore.tsx`). Tests: `thread-state.test.tsx` (a held thread: no request, re-renders only for itself against a whole-list subscriber; a fetched thread has a held one's shape; 404 against other failures; a fetched thread deleted while watched; data carrying `deletedAt`; a held thread leaving the store stays `ready` until its fetch answers; empty id), and `ThreadPromptContextBanner.test.tsx` (a parent the sidebar lacks shows nothing while it loads and stays hidden once it reads as archived; an archived thread's parent is read through the fetch).
- **Plugin callers:** none in-repo. Community plugins that run `threads.find((t) => t.id === id)` over `experimental_useSidebarThreads()` for one thread, such as work-map and attention-sidebar, can migrate.
- **Stabilization:** decide whether `ready` should also carry the five request-only fields, which would mean a request for held threads too; whether boards need a batched form (`ids[]`); and whether `error` should expose the failure. Then rename project-wide and remove this entry.

## `useSidebarThreadDraft` / `useSidebarThreadDraftIds` / `useSidebarThreadRowStatus` / `useSidebarThreadRowStatuses` / `useSidebarThreadShortcut` (`@get-bb/plugin-sdk/app`)

**Shipped without the `experimental_` prefix.** These hooks became public
`@get-bb/plugin-sdk/app` exports under final names in #4025, against the
prefix rule. About ten marketplace plugins import them by these names, so
Michael decided to keep the names. Do not rename them without
keeping the current names as runtime aliases. The unprefixed names do not
mean the hooks have been audited.

They expose the per-row facts that are client-local and therefore missing
from `PluginSidebarThread`:

- `useSidebarThreadDraft(threadId)` returns `{ hasUnsubmittedDraft }`, which
  is true while the composer holds unsent input for that thread. It is false
  for a thread that is not in the sidebar's thread view.
- `useSidebarThreadDraftIds()` returns the ids of every sidebar thread that
  holds an unsent draft, through one subscription, for collapsed-group
  rollups. It returns the same empty set whenever there are none.
- `useSidebarThreadRowStatus(threadId)` returns the status another plugin's
  content script set through `experimental_setThreadRowStatus`, or null.
  `useSidebarThreadRowStatuses()` returns every status that is set, by thread
  id, through one subscription.
- `useSidebarThreadShortcut(threadId)` returns `{ label, ariaKeyshortcuts }`
  for the jump shortcut bb assigns while the app command modifier is held.
  bb numbers rows carrying `data-sidebar-thread-shortcut-target` in DOM
  order. The hook returns null when the modifier is up and for rows without
  the attribute.

Docs: `frontend-thread-list.md`.

Core callers: the bundled Thread list plugin (`plugins/thread-list`) renders
bb's sidebar through all five. `ThreadRow` reads the draft, row status and
shortcut hooks, and the group rollups read `useSidebarThreadDraftIds` and
`useSidebarThreadRowStatuses`. The app implementations in
`apps/app/src/lib/plugin-sidebar-hooks.ts` wrap the primitives core's own
lists use. `usePromptDraftHasInput` and `usePluginThreadRowStatus` feed
`useThreadListEntryStatus`, which the thread search palette, mobile recents
and related-thread lists draw. Mobile recents also reads
`usePromptDraftInputThreadIds`.
`AppSidebar` provides the `SidebarThreadShortcutKeysContext` behind the
shortcut hook.

**Audit before calling these stable.**

1. **Hooks versus DTO fields.** Confirm that draft, row status and shortcut
   should stay separate per-row hooks rather than fields on
   `PluginSidebarThread`. `useSidebarThreadDraft` is the per-thread draft hook
   that item 5 of the `experimental_useSidebarThreads` entry asks about.
2. **Draft scope.** A draft is keyed by project and thread, and the hook
   reports false for threads outside the sidebar's view. Confirm callers never
   need drafts for archived threads, or for threads the view filters out.
3. **Row status contract.** `PluginSidebarThreadRowStatus` aliases
   `PluginComposerThreadRowStatus`, so the `tone` → `state` rename and the
   arbitration questions in the `experimental_setThreadRowStatus` entry apply
   to these hooks as well. A change there changes these return types.
4. **Shortcut targeting.** Shortcut assignment depends on a DOM attribute and
   DOM order. Confirm that holds for virtualized lists that do not mount every
   row, and decide whether the attribute name belongs in the typed contract.
5. **Whole-list subscriptions.** Confirm the set and map returned by
   `useSidebarThreadDraftIds` and `useSidebarThreadRowStatuses` keep their
   identity while nothing changes, at ten thousand threads.

## `app.slots.experimental_threadInfoRow` / `app.slots.experimental_threadInfoSection` / `experimental_THREAD_INFO_ROW_GROUPS` / `experimental_THREAD_INFO_SECTION_GROUPS` / `experimental_InfoSection` / `experimental_DetailRow` / `experimental_InfoList` / `experimental_InfoListRow` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, group, order?, component }`. The component receives
`{ threadId, projectId, environment }` and mounts once per visible thread's Info
tab. `environment` is `{ id }` taken from the thread, null only when the thread
has no environment; components read its state themselves (the Git plugin's
status row shows "Workspace not found" for a missing folder). Rows
render in the details block, sections below it, each sorted the way thread
actions are: by `group` (string compare), then `order` within the group (unset
last), then registration order with core first on a tie. bb's groups are the
two exported tables; core uses orders 10, 20, 30 within each. Groups draw no
separator. Each plugin
entry mounts in its own crash boundary keyed by thread, so a crash drops only
that row or section. The four components are the Info tab's own building
blocks: `experimental_InfoSection` (heading, count pill, collapse),
`experimental_DetailRow` (label/value row with an optional icon),
`experimental_InfoList` (the "N more" list), and `experimental_InfoListRow`.
Inside a section slot, `experimental_InfoSection` collapses, and the state is
stored in the `infoPanel.collapsedSections` preference under the core id or
`<pluginId>/<id>`. In a thread context card section it folds instead (see the
card's entry below).

**Core callers.** `ThreadMetadataContent` renders the Info tab only through
`ThreadInfoRows` and `ThreadInfoSections`
(`apps/app/src/components/secondary-panel/info/ThreadInfoSlots.tsx`), which
merge `CORE_THREAD_INFO_ROWS` and `CORE_THREAD_INFO_SECTIONS` with plugin
registrations. `experimental_DetailRow` is bb's only label/value row
(`DetailRow` in `apps/app/src/components/ui/detail-card.tsx`): all seven core
rows and the Git plugin's commit dialog draw with it, and core's three
sections draw with `InfoSection` and `InfoList`. The git and pull request
groups hold no core entries. The Git plugin registers the branch, merge-base
and git-status rows in the `git` group and the commits and uncommitted
changes sections (`plugins/git/app.tsx`). The Automations plugin registers
the Automations section, and the GitHub PR Status plugin registers the Pull
request row in the `pullRequest` group, reading its pull request through
`environment`. Contract tests: `ThreadInfoSlots.test.tsx`.

Docs: `frontend-registration.md`, `frontend-components.md`.

**Audit before stabilizing.**

1. **Props.** Components get `threadId`, `projectId` and `environment` (`{ id }`
   only), so a plugin row that needs the environment's state or the thread
   itself reads it through the SDK; core rows read the Info tab's host state
   instead. Decide whether the props should carry a thread snapshot.
2. **Group boundaries.** Rows are grouped thread, environment, git, pull
   request, lifecycle; sections related, changes, storage. Confirm these are
   the groups to freeze, since moving a core entry between groups moves the
   plugin entries that anchor to it.
3. **Empty state.** The Info tab still decides between its details, a loading
   skeleton, and "No thread details available." from core state
   (`hasAnyThreadMetadata`), so plugin entries never count toward it and are
   hidden with core's details. Decide whether registrations should report
   visibility.
4. **Separators.** The Info tab draws section separators on every
   `[data-info-section]`, so a section that renders without
   `experimental_InfoSection` gets no separator. Confirm that is acceptable.

## `app.slots.experimental_threadContextCardRow` / `app.slots.experimental_threadContextCardSection` / `experimental_ThreadContextCardRow` / `experimental_useThreadContextKind` (`@get-bb/plugin-sdk/app`)

A thread pane shows its thread context one of two ways, its
`ExperimentalThreadContextKind`: `banner`, the context row above the composer,
or `card`, the thread context card at the pane's upper-right.
`experimental_useThreadContextKind()` returns the kind of the pane the calling
component renders in, `banner` outside a thread pane. A pane is `card` for a
thread opened as a page whose pane is wide enough to fit the card beside the transcript (the `card` layout
`ThreadContextCard` measures), except on phones (a compact
viewport with a coarse pointer, the rule `MessageActionBar` uses). A narrower
pane is `banner` and its header button opens the card as a popover. Threads
shown inside a panel or as a transcript are `banner`: `ThreadScreen` wraps
those presentations in `WithoutThreadContextCard`.

The card's counterparts of the Info tab's row and section slots. A row
registration is `{ id, group, order?, component }` and draws in the card's top
block; a section is `{ id, group, order?, component }`, the same shape as an
Info tab section, and draws below the rows. Components receive
`{ threadId, projectId, environment }` (`environment` is `{ id }` from the
thread, null only without one). A row renders
`experimental_ThreadContextCardRow` rows (`{ icon?, leading?, label,
trailing?, title?, disabled?, onClick?, action? }`), or null; `action` is a
second control beside the main one, such as a menu. A section renders one
`experimental_InfoSection` (`label`, `count?`, `accessory?`, `trailing?`), or
null to hide it, with rows inside.

`ThreadDetailView` wraps each thread page and split pane in
`ThreadContextCardProvider`
(`apps/app/src/components/plugin/PluginThreadContextCard.tsx`), enabled only
where the pane's kind is `card`. Rows and sections each merge bb's with plugin
registrations and sort by `group`, `order` (unset last), then
registration order with core first on a tie. Rows share one block with no
heading; sections follow, each with a divider above it. In a section,
`experimental_InfoSection` (`SurfaceInfoSection`) draws the Info tab's
collapsible heading, open by default. Folds are stored in the synced
`threadContextCard.collapsedSections` preference under `pluginId/sectionId`, or
`bb--core/id` for bb's own, shared by every thread and separate from the Info
tab's. Every plugin row and section mounts in its own crash boundary keyed by
thread, and CSS `:has` hides a block whose components render no element.

Plugins built before SDK 0.6.163 pass a `title`, which the type no longer has.
The collector keeps it as `legacyTitle` and warns; bb then draws that title
itself, keeps the body mounted but `hidden` while folded so `:has` can still
hide an empty section, and renders an `experimental_InfoSection` inside it as
its children only. `ThreadContextCard` sits in
`ThreadScreen`'s scroll overlay, sibling to the scroll viewport, and measures
the overlay (`resolveThreadContextCardLayout`): `card` when the card's 312px
fits beside the 760px transcript column, `banner` otherwise. While
`threadContextCard.pinned` (a synced UI preference, default true) is on,
`card` shows the card in the pane; the transcript stays centered in panes
1384px and wider and slides toward the start below that
(`useThreadContextCardTranscriptCenteredMinWidth`). The header button
(`ThreadContextCardHeaderButton`) toggles the pin. In `banner` the header
button opens the same content in the shared Popover, which is the shared
bottom drawer in a compact viewport. Unpinning or closing the popover does not
change the pane's kind.

Context segments render in both kinds, so a plugin that has not added a card
row or section keeps its segment above the composer. A segment whose content is also a
card row or section hides itself in `useVisible` while the kind is `card`.

**Core callers.** bb's parent row (thread group) and its Child threads section
(related group) are `CORE_THREAD_CONTEXT_CARD_ROWS` and
`CORE_THREAD_CONTEXT_CARD_SECTIONS` in
`apps/app/src/views/thread-detail/ThreadContextCardCore.tsx`, drawn with
`ThreadContextCardRow` and `SurfaceInfoSection`, the components behind
`experimental_ThreadContextCardRow` and `experimental_InfoSection`.
bb's parent segment hides through `useThreadContextKind`, the function behind
`experimental_useThreadContextKind`. The Git plugin registers its `changes`
row (full `+N −M` counts; it opens the Diff tab, where the merge base is
picked) and GitHub PR Status its `pull-request` row (the banner's own label,
`PullRequestSummaryLabel`, after the GitHub icon that carries the checks,
opening the pull request; its `…` menu opens GitHub, copies the link, merges,
and marks it ready or draft, at the card's width, flush with its edges); both
hide their segments with `experimental_useThreadContextKind`. A row's `action`
replaces its `trailing` while the row is hovered or focused or the action's
menu is open, and always shows on touch screens. Contract tests:
`PluginThreadContextCard.test.tsx`,
`plugin-app-thread-context-card-section.test.ts` and
`ThreadPromptContextBanner.segments.test.tsx`.

Docs: `frontend-thread-context-card.md`, `frontend-registration.md`,
`frontend-hooks-and-ui.md`, `frontend-components.md`, `docs/configuration.md`
(experiment and preference).

**Audit before stabilizing.**

1. **Kinds.** Confirm `banner | card` covers the presentations bb plans, and
   that a pane's kind should not follow the pin or the popover.
2. **Context segments.** Decide whether `experimental_threadContextSegment`
   becomes the banner's slot under a matching name once the card stabilizes,
   and whether unmigrated segments should keep showing in card panes.
3. **Transcript slide.** Pinning or unpinning in a pane narrower than 1384px
   moves the transcript sideways. Confirm that is acceptable or reserve the
   space permanently.
4. **Row actions.** `action` takes any node; GitHub PR Status builds its own
   `…` menu from shared tokens. Decide whether bb ships the menu as a
   component, and whether menus should open beside the card instead of below.
5. **Emptiness.** When every row and section renders nothing for a thread, the card
   shows an empty state ("Nothing to show yet") instead of hiding, so the
   header button and the transcript's position do not depend on the thread.
6. **Groups.** Rows and sections reuse the Info tab's groups. Confirm the two surfaces
   should share one group vocabulary.
7. **Folding.** Sections start open and the person folds the ones they don't
   need. Decide whether a folded section needs a one-line summary beside its
   title, and whether a section that needs the person (a pending question) may
   unfold itself. The section's component stays mounted while folded, so its
   subscriptions run for every card, open or not.
8. **Legacy titles.** Once no maintained plugin passes `title`, delete
   `legacyTitle` and the collector's `readLegacyCardSectionTitle`.

## `app.slots.experimental_threadHeaderRow` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, order?, component }`. Every registered row renders
full width, stacked by `order` ascending (unset last, then registration
order), directly under `ThreadDetailHeader` and above the timeline, in every
thread page and split pane. The component receives
`ExperimentalThreadHeaderRowProps`: `{ threadId, projectId, environment }`,
where `environment` is `{ id }` from the thread, null when it has none. A
component that returns null takes no space; when no plugin registers a row,
the host renders nothing.

`ThreadDetailView` appends `PluginThreadHeaderRows`
(`apps/app/src/components/plugin/PluginThreadHeaderRows.tsx`) to the
`timelineHeader` it passes as `mainHeader` to `SecondaryPanelLayout`, inside
the thread's `AppNavigationHostProvider`, so `experimental_useAppPanel()` and
`experimental_usePanelTabs()` in a row act on that thread's side panel. Each
row mounts in its own `PluginSlotMount` crash boundary (`crashFallback={null}`),
keyed by plugin, id, generation and thread, so a crash removes only that row
for that thread.

**Core callers.** None: bb draws nothing between the thread header and the
timeline, so there is no core path to share. The bundled Conductor plugin
registers its workspace tab strip (`workspace-tabs`, the threads that share
the thread's environment) through it.
Contract tests: `ThreadDetailView.contract.test.tsx` (placement, order, props,
crash containment, plugin hooks, and the panel controller contract run from a
row).

Docs: `frontend-thread-header-row.md`.

**Audit before stabilizing.**

1. **Callers.** Conductor ships a row. Decide whether bb moves any of its own
   pane chrome (such as banners) into the slot.
2. **Compact viewports.** Rows take vertical space above the timeline on
   phones; decide whether bb hides or collapses them in a compact viewport.
3. **Ordering across plugins.** `order` is a bare number shared by every
   plugin; confirm that is enough, or add groups as the Info tab has.
4. **Transcript and panel presentations.** Rows render only on thread
   pages and split panes, not in threads shown inside a panel or as a
   transcript; confirm that scope.

## `app.slots.experimental_threadHeaderTitle` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, component }`. The component receives
`ExperimentalThreadHeaderTitleProps`, an alias of
`ExperimentalThreadHeaderRowProps` (`{ threadId, projectId, environment }`),
and renders in `ThreadDetailHeader` in place of the `ThreadTitle` text, in
every thread page and split pane. Only one title renders, chosen by the shared
exclusive-slot rule from the synced `threadHeader.titleProvider` pick
(`__builtin__` keeps core's title; Automatic is the first plugin the user
installed by plugin id, then bb's own (bundled or from bb's official marketplace)).

Core keeps the rest of the header: the Thread actions menu after the title,
plugin header actions, the open-in button, pane maximize and close, the context
card button, the right-panel toggle, the macOS drag region, and the split-pane
drag from the title area. While the inline rename editor is open (the
`thread.rename` command or the menu's Rename) the header shows core's editor
instead of the plugin title. Double-click does not start a rename on a plugin
title. The pane drag ignores pointer-downs on links, buttons, inputs, labels,
`role="button"`/`role="link"` and content-editable elements inside the title,
so a plugin title can be clickable. The plugin title renders in a `div`, not
core's `p`, so block content is valid. The document title stays the thread
title.

`PluginThreadHeaderTitle`
(`apps/app/src/components/plugin/PluginThreadHeaderTitle.tsx`) mounts the
component through `PluginSlotMount` keyed by plugin, id, generation and thread,
with core's `ThreadTitle` as `crashFallback`, so a crash shows the normal title
for that thread.

**Core callers.** None: core draws the thread title itself and has no
alternative title. The motivating caller is the Conductor layout plugin, which
shows the thread title as the active tab of an `experimental_threadHeaderRow`
tab strip and puts a `project › workspace` breadcrumb in the header instead.
Tests: `ThreadDetailHeader.test.tsx` (props, plugin order, crash fallback,
rename editor, pane drag from controls) and
`plugin-app-thread-header-title.test.ts` (registration).

Docs: `frontend-thread-header-row.md`.

**Audit before stabilizing.**

1. **Exclusivity.** First-wins by plugin id is silent. Decide whether users
   pick the title provider in Settings, as for the thread list and composer.
2. **Rename affordance.** A plugin title loses double-click rename; confirm
   the menu and shortcut are enough or let the component request a rename.
3. **Compact viewports.** Check how a long breadcrumb truncates next to the
   header actions on phones and in narrow split panes.
4. **Window title.** Decide whether a plugin should be able to set the window
   title for a thread, or whether it stays core-owned.

## `app.slots.experimental_threadRowMetadata` / `experimental_ThreadRowMetadata` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, order?, useData?, component }`. `useData` is a React
hook the host calls once for the whole app, never per row, with
`{ threads }`: bb's active sidebar threads in sidebar order, then any other
thread whose line is mounted, deduplicated. Rows a windowed list has not
rendered are included. The component receives `{ thread, data }`, where
`data` is what `useData` last returned (undefined without `useData`), and
renders a small item on that thread's metadata line, under the title; with
`useData` it first renders once `useData` has returned.
`experimental_ThreadRowMetadata({ thread })` renders every registration for one
row, sorted by `order` (unset last) then registration order, each in its own
crash boundary keyed by thread, left to right in one line container that fills
its parent, clips at the row's edge and is hidden while empty. It renders
nothing when no plugin registers an item.

`ThreadRowMetadataCollectors` (in `AppLayout`, loaded on demand) runs each registration's
`useData` while any line is mounted; with none mounted (the experiment or
Metadata off) it runs nothing and reads nothing. Because `useData` loads every
listable thread, a windowed list's rows find their data when they render, so
scrolling never changes a row's height. The container shows while any item
draws something (a MutationObserver keeps a `data-has-items` attribute
current). The GitHub PR Status plugin's `useData` reads every listed
environment in one `experimental_useRpcKeyedQuery`. The plugin answers app
reads from what it has and refreshes stale rows in the background, so rows
draw without waiting.

**Core callers.** bb's sidebar (`plugins/thread-list`, `ThreadRow.tsx`) renders
`experimental_ThreadRowMetadata` on a line under each row's title, the same call a
plugin-built list makes, when the user turns on Organize → Rows → Metadata (`showRowMetadata`); the preference is
off by default. The row grows to two lines only
while an item draws something, the line is hidden while the row is renamed or
customized, and clicks on it go through the row's own click handling. The
GitHub PR Status plugin registers the first item: the current-branch pull
request's `#number` in the state's color (a draft's in the subtle foreground), plus a red
cross when an open or draft PR needs action (failing checks, changes requested,
conflicts, behind its base or blocked by rules) or else a yellow dot while its checks run,
from one `useData` read of
every listed environment. No core row indicator moved into the slot: the status
glyph, split mini-map, shortcut pill and hover actions share the row's fixed
trailing box, the cross-project icon depends on the row's position in the
list, and the provider icon and child chevron sit elsewhere. Contract tests: `ThreadRowMetadata.test.tsx`,
`plugins/github-pr-status/app.test.tsx`.

Docs: `frontend-registration.md`, `frontend-pull-requests.md`.

**Audit before stabilizing.**

1. **Props.** Items get the list's thread snapshot. Decide whether row context
   (selected, depth, compact, collapsed children) belongs in the props, since
   core's own indicators that depend on it stayed out of the slot.
2. **Width.** Items share one line and the line clips at the row's edge, so a
   late item can disappear. Decide whether items need a width cap, a
   priority, or a per-item toggle once several plugins contribute.
3. **Every thread reads.** `useData` receives every active sidebar thread,
   on screen or not, so the GitHub PR Status plugin holds (and keeps
   refreshing) every thread's key. Archived threads are included only once
   their line mounts. Confirm the cost on long lists, and whether the input
   needs a visibility signal for items that poll something costlier.
4. **Shape.** `useData` mirrors `experimental_threadAction`'s, but receives
   threads rather than ids. Decide whether the two should match.

## `app.slots.experimental_threadAction` / `PluginThreadActionRegistration.experimental_bulkItem` / `PluginThreadActionRegistration.placement` / `experimental_useThreadActions` / `experimental_useThreadActionRegistrations` / `experimental_ThreadActionsMenu` / `experimental_ThreadActionsContextMenu` (with `experimental_bulkThreads`) / `experimental_THREAD_ACTION_GROUPS` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, title, icon, group, order?, placement?, useData?, item }`.
`useData` runs once per registration for the whole app and receives
`{ threadIds }`, every thread a visible surface evaluates actions for,
debounced (32 ms quiet, 100 ms max). `item` is a pure function of
`{ thread, data, sdk, navigate }` returning a `PluginThreadAction` or null;
throws drop the registration or that thread's item, and `run` errors are
contained. Registrations sort by `group`, `order`, then registration order
for every menu and the quick-action picker. Thread-list registers Move to
section, and push-notifications registers Notifications. The SDK test fake
throws when a menu `trigger` drops its props and ref.

`placement` is `"menu"` (the default) or `"header"`. A header action is
left out of every menu, selection menu, `experimental_useThreadActions`, and
the quick-action picker. `ThreadDetailHeader` evaluates header actions through
`useThreadHeaderActionEntries` and draws them after the workspace's Open
button: one as an outline button, several as a split button, each with its
`icon`, its `detail` as a tooltip (a second line in the split button's menu),
and red text for `variant: "destructive"`, as in the menus. At compact width
and in split panes narrower than 560 px they become rows at the top of the
header's thread menu, after Open. An action that returns `choices` is left out
of the header. A header registration's `useData` receives only the threads
whose header is on screen, so per-thread reads scale with open panes, not
sidebar rows. The Git plugin's Commit is the only header action.

`experimental_bulkItem` is an optional pure function of
`{ threads, data, sdk, navigate }` (two or more selected threads in list
order) returning one action for the whole selection, or null.
`experimental_ThreadActionsContextMenu`'s optional `experimental_bulkThreads`
(the selected targets) and `onEscapeKeyDown` turn the row's menu into the
selection menu when it holds two or more threads: a "N threads selected"
heading, every registration's bulk item in the same group order as the
thread menu, then `inline`, with every selected id retained in `useData`'s
`threadIds` while open. One component keeps a row to a single Radix menu, so
a row joining or leaving a selection does not remount. The SDK test fake
takes `threadBulkActions` for the entries it lists.

**Core callers.** bb's own actions are the core contribution
`apps/app/src/core-contributions/thread-actions.ts`, built only from the
public SDK and registry items (`bb/core-contribution-imports`) and collected
as `CORE_THREAD_ACTIONS` under the reserved `bb--core` owner. The header menu (`ThreadDetailView` →
`ThreadDetailHeader`), `RootComposeMobileRecents`, and
`PaneThreadActionCommandHandler` read the same registry, and the thread list's
row menus and quick actions use the SDK exports. The contract table in
`ThreadActionsMenu.test.tsx` runs every menu surface against the same
registrations. Core's Mark read, Pin, Notify parent, Archive and Delete
registrations carry the bulk items; Notify parent reads the target's
`parentNotifications` and updates only the selected threads that have a
parent; Archive and Delete call `context.threadRequests.requestArchive` /
`context.threadRequests.requestDelete` (the `ExperimentalThreadRequests` entry) for one
thread or the selection. Delete, for one thread or several, and archive for two or more plan
the selection with `threads.experimental_listCascade`, confirm once with the
count of unselected threads in the cascade (archive honors the confirmation
setting), act on
the topmost selected threads, and clean up panes and routes once; archive
shares one Undo toast with `experimental_useArchiveEnvironmentThreads`. The
thread list's multi-selection is the only caller of
`experimental_bulkThreads`, and its Move to section and push-notifications'
Notifications carry bulk items.

Docs: `frontend-registration.md`, `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **Per-thread data.** `threadIds` makes each registration fetch and cache
   per-thread state itself. Decide whether a host attributes layer should
   batch those reads across registrations, and whether `useData` should move
   onto `experimental_useRpcQuery`.
2. **Picker catalog.** The row-actions picker lists every registration,
   including actions that rarely make sense as row buttons (Delete, New thread
   in environment). Decide whether a registration should opt out.
3. **Run input.** `requestRename` is the only surface-supplied capability.
   Confirm no second one is needed before stabilizing the run signature.
4. **Inline items.** `inline` exists for surface-specific entries that are not
   about a thread. Confirm it should stay a component prop rather than a
   registration.
5. **Header placement.** Header buttons honor `label`, `icon`, `detail`,
   `variant`, and `disabled` as the menu rows do; `choices` shows nowhere on
   the button. Decide whether header actions need choices (a split-button
   menu) or an icon-only form before more plugins add one, and how many fit
   before the row needs its own overflow.
6. **Bulk shape.** Decide whether `experimental_bulkItem` should
   stay a second function or `item` should take a target that is one thread
   or several, whether selection menus need a dropdown or compact-drawer
   variant beyond right-click and long-press, and whether a bulk item
   should be able to report per-thread failures instead of one toast.

## `experimental_useArchiveEnvironmentThreads` (`@get-bb/plugin-sdk/app`)

Returns `(environmentId) => Promise<void>`, core's environment-group archive:
the optimistic `environments.archiveThreads`, split-pane cleanup, route
repair, and one ten-second Undo toast that unarchives the returned ids
(lifecycle owners first) and returns to the route. Failures show a host error
toast, and archive failures reject. It replaces
`PluginSidebarThreadActions.experimental_archiveEnvironmentThreads`. The test
harness records calls in `inspection.experimental_environmentArchiveCalls`.

**Core callers.** The hook returns `ThreadActionsProvider`'s
`archiveEnvironmentThreads`, bb's only environment-group archive, which the
deprecated sidebar-actions shim also calls. Its callers are the bundled
thread-list plugin's environment group menu (`ProjectRow.tsx`) and the
Conductor plugin's workspace sidebar (`WorkspaceSidebar.tsx`).

Docs: `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **Scope.** Thread archive and delete outside a menu became
   `ExperimentalThreadRequests`. Decide at stabilization whether this hook
   joins it as a third member (taking an environment id) or stays separate.
2. **Undo route repair.** The toast's route restore assumes the user has not
   navigated since; confirm that matches plugin-hosted surfaces.
3. **Coverage.** Verify group archive and Undo with descendants, already
   archived threads, split panes, navigation during the Undo window, and
   failure rollback across sidebar organization modes.

**Kept beside `requestArchive` (2026-11-20).** Kill-test: is
`archiveEnvironmentThreads(envId)` the same as `requestArchive(rootIdsOf(env))`?
No. On a dev instance with a worktree environment holding three root threads,
one with a child in the same environment and one in the project checkout,
selecting the three roots and choosing Archive opened "Archive 3 threads?
Their 2 child threads will be archived too." The environment menu's Archive
archived the same five threads with no dialog and one "Archived 5 threads"
toast. Two differences keep the hook:

1. **Confirmation.** The environment action is itself the choice to archive
   everything in the environment, so it never asks. `requestArchive` asks
   whenever a tree has children outside the list.
2. **Selection.** The server picks the threads when the call lands
   (`listLiveThreadsInEnvironment`: every live thread in the environment,
   hidden ones included). A client can pass only ids it has loaded, so a
   thread created in the environment after the list rendered, or one the
   list does not show, would be left behind.

Both run the same code after the server call: `presentArchivedThreads` in
`ThreadActionsProvider` closes panes, repairs the route and shows the one
Undo toast.

## `ExperimentalThreadRequests` / `ExperimentalPluginActionContext.threadRequests` / `experimental_useThreadRequests` (`@get-bb/plugin-sdk/app`)

Requires SDK 0.6.178.

- **Surface:** `requestArchive(threadIds: readonly string[]): Promise<void>`
  and `requestDelete(threadIds: readonly string[]): Promise<void>`, the
  members of `ExperimentalThreadRequests`. Every callback context carries one
  as `ExperimentalPluginActionContext.threadRequests`, and
  `experimental_useThreadRequests()` returns one for components. The
  testing harness records hook calls in
  `inspection.experimental_threadRequestCalls` (`ExperimentalThreadRequestCall`
  is `{ method, threadIds }`).
- **Behavior:** bb's Archive and Delete flows for any ids. Ids are
  deduplicated; threads the app has not loaded are fetched with
  `threads.get` (an id that fails to load shows an error toast and nothing
  runs). The selection is planned with `threads.experimental_listCascade`, so
  the child count comes from the server. Delete always confirms once;
  Archive confirms once when a tree has children outside the list and
  Settings → General's archive confirmation is on, and skips archived
  threads. Afterwards both close split panes and repair the route; Archive
  shows one ten-second Undo toast that restores the threads and the route.
  The promise resolves when the flow settles: done, cancelled, or failed
  after bb's error toast (an archive failure closes the dialog; a delete
  failure keeps it open, so the promise waits for the retry or Cancel). It
  never rejects inside the app.
- **Core callers:** `ThreadActionsProvider` publishes the flows into
  `threadRequestsAtom` (`apps/app/src/lib/thread-requests.ts`);
  `usePluginActionContextBinder` binds every callback context's
  `threadRequests` to it and `useThreadRequests` binds the hook, so core and
  plugins share one path. Core's Archive and Delete thread actions
  (`core-contributions/thread-actions.ts`, `item` and `experimental_bulkItem`) call
  `context.threadRequests.requestArchive` / `requestDelete`, which covers every thread
  menu, the thread list's selection menu, row quick actions and the
  `thread.archive` keyboard command. The superseded
  `PluginSidebarThreadActions.archive` / `requestDelete` are aliases of the
  same calls. Tests: `ThreadRequests.test.tsx` (unloaded ids, settle on cancel,
  confirm and failed delete, unknown id) next to the unchanged
  `ThreadActionsProvider.test.tsx`.
- **Not covered:** environment-group archive stays on
  `experimental_useArchiveEnvironmentThreads` (see its entry). Server code
  keeps `bb.sdk.threads.archive` / `delete`, which run no confirmation.
- **Callers that can migrate:** community rows and lists that rebuild the
  confirmation or Undo (`wy3z/bb-cursor-suite` cursor-sidebar,
  `kalindudc/bb-marketplace` switchboard), call raw `threads.archive` from UI
  (`Johannes-Berggren/bb-plugin-jb-flow`, `ahkohd/bb-plugin-beside`,
  `cristoslc/bb-plugin-focus-board`, `euanguo/euanguo-plugins` nested-sidebar),
  or use `experimental_useSidebarThreadActions().archive` / `requestDelete`
  (about 28 repos, e.g. `joozio/bb-plugin-work-map`, `grrowl/bb-lanes`,
  `grrowl/bb-tinted-threads`).

**Audit before stabilizing.**

1. **Outcome.** The promise says the flow settled, not how. Decide whether
   callers need `"done" | "cancelled" | "failed"` (or the archived ids) before
   the shape freezes.
2. **Concurrency.** A second request replaces an open dialog of the same kind
   and settles the first as cancelled; a request while a selection plan is in
   flight aborts the earlier plan. Confirm that is right for plugins that fire
   several requests.
3. **Surface binding.** Route repair and pane cleanup act on the window's
   split layout, not the calling surface. Check plugin-hosted surfaces (nav
   panel pages, overlays) once they host threads.


## `experimental_makeActionContext` / `ExperimentalActionContextFixture` / `ExperimentalActionContextCall` (`@get-bb/plugin-sdk/testing`)

Requires SDK 0.6.178.

- **Surface:** `experimental_makeActionContext(overrides?: Partial<ExperimentalPluginActionContext>): ExperimentalActionContextFixture`,
  a complete `ExperimentalPluginActionContext` plus `calls:
  ExperimentalActionContextCall[]` (`{ member, args }`). Defaults record each
  call: `threadRequests` methods resolve, `composer` is null, `navigate` methods return
  false except `experimental_threadHref` and `experimental_settingsHref`,
  which return the test harness's paths (`/threads/<id>#msg=<seq>`,
  `/settings/<section>`), `panel` is `experimental_makePanelController()`, and `sdk` methods
  reject with `sdk.<area>.<method> is not stubbed`. Overrides replace members;
  tests spread the result and add the callback's own fields.
- **Why:** every member added to `ExperimentalPluginActionContext` broke every
  test that built a context by hand. With the fixture, the next member changes
  only `packages/plugin-sdk/src/testing/fixtures.ts`, whose object literal the
  compiler checks against the interface.
- **Callers:** the git plugin's command test (`plugins/git/app.test.tsx`) and
  Commit action test (`plugins/git/ui/commit/commit-action.test.tsx`),
  push-notifications' Notifications action test, thread-list's Move action
  test, side-chat's message action test, drafts' composer test, and the SDK's
  own command collector and harness tests.
- **Stabilization:** decide whether `navigate` should record into the same
  `NavigateCall` shape `renderSlot` uses, and whether composer and message
  contexts need their own builders once their fields grow. Then rename
  project-wide and remove this entry.
## `app.slots.experimental_browserToolbarAction` (`@get-bb/plugin-sdk/app`)

Renders a plugin component beside the address bar in each Browser tab. It
receives `threadId`, `tabId`, `url` and a compact-viewport hint, with a crash
boundary per tab mount. `threadId` is the tab's desktop-browser owner key: a
thread id in a thread's side panel, an opaque panel key on the New thread
screen and plugin pages. `sdk.experimental_desktopBrowsers` scopes take the
same key under the same misleading name.

Docs: `frontend-registration.md`.

**Audit before stabilizing.** Confirm the toolbar can hold multiple plugin
controls without crowding the address field, whether ordering needs a user
preference, and whether plugins need browser instance or environment identity
instead of resolving it server-side from the thread and tab ids. Rename the
owner key here and in the desktop-browser scopes together, and decide whether
the toolbar should also receive a nullable thread id; thread-scoped plugins
call `sdk.threads.*` with a panel key today and get a 404.

## `ExperimentalPluginBrowserToolbarActionProps.experimental_page` (`@get-bb/plugin-sdk/app`)

Gives a Browser toolbar action script access to its tab's top-level document
without a CDP lease. `evaluate(expression, { world })` runs in the main world
or bb's isolated world, where `bb.postMessage` reaches the calling plugin's
`onMessage` listeners. The value is `null` outside the desktop app.

Docs: `frontend-registration.md`.

**Audit before stabilizing.** Decide whether any enabled plugin may evaluate in
personal-profile tabs or whether this needs a user gesture, capability grant,
or origin allowlist. Plugins share one isolated world, so a plugin can post on
another plugin's channel; decide whether per-plugin worlds are required.
Confirm message size and rate bounds, subframe support, behavior during
navigation and renderer crashes, whether `evaluate` should time out while a
page is still loading, and whether an SDK or `bb` CLI surface is needed for
automation outside the toolbar component.

## `PluginMentionProviderRegistration.resolve().experimental_images` (`@get-bb/plugin-sdk`)

Lets a mention provider resolve a picked mention to agent-only image inputs,
each optionally preceded by a short agent-only text input. The images are
validated like ordinary prompt images before dispatch.

Docs: `backend-ui-lifecycle.md`.

**Audit before stabilizing.** Confirm images are the only binary input mention
providers need, the 50-image boundary is appropriate, and local image access
should remain governed by the thread dispatch validator rather than an earlier
plugin-specific check.

## Composer API redesign: final names without the experimental prefix

Michael decided to ship these under final names as an explicit exception to
the experimental-prefix rule, so plugin authors migrate once.
`useComposer()` returns one stable handle per composer. `onSubmitted`,
`submit` and `setSelection` replace their `experimental_` names;
`ComposerCustomization.sendMenu`, `PluginMessageActionContext.composer` and
`useComposers()` also carry final names, with no runtime alias. The four old
handle names (`experimental_removeMention`, `experimental_onSubmitted`,
`experimental_submit`, `experimental_setSelection`) are `@internal`: stripped
from published declarations but still implemented at runtime, and listed
under Scheduled removals. `removeMention` and `insertMention` are not final
names: both are `@internal` legacy members that warn at runtime, superseded
by `replace` and `insert`.

Docs: `frontend-hooks-and-ui.md`.

**Audit.**

1. **Handle semantics.** A stable handle with reactive getters means memo
   dependencies must name fields (`composer.draft`), not the handle. Confirm
   the lint and documentation guidance is enough.
2. **Mention shape.** `ComposerMention` exposes core resource fields (path
   source and entry kind, command source and origin, and the stored path an
   `attachment` mention shares with a file attached to the same draft).
   Confirm these are stable enough to be public.
3. **Canonical pill text.** Decided: `insert` writes the editor's canonical
   pill text (`@label` for plugin mentions). `insertMention` keeps writing the
   bare label, but it is `@internal` legacy and will not converge.
4. **Message-action composers.** They have no slot lifecycle, so
   `setTextEffect` and `setInputLock` warn and do nothing there, and
   `useComposers()` handles behave the same way. Confirm.
5. **Runtime-only aliases.** The four handle aliases go at the next major
   (Scheduled removals). Decide when the runtime drops the legacy
   `removeMention` and `insertMention`.
6. **Composer list order and membership.** `useComposers()` orders by mount
   and omits the sent-message editor. Decide whether panels also need the
   last-focused composer to pick a default target.

## Composer mention removal and successful submission subscriptions

`PluginComposerApi.removeMention({ provider, id })` is `@internal` legacy,
deprecated since #4474: it still removes the calling plugin's matching
mentions from the unsent draft, but warns once at runtime, and `replace`
supersedes it. `PluginComposerApi.onSubmitted(listener)` observes successful
local thread-send, queue-create and new-thread-create mutations in the
composer's scope. It is a local UI notification, not a server event.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, audit handoff scope routing, decide whether to include
the submitted structured draft in notifications to distinguish annotations
created while a request is pending, and verify disposal, failure restoration,
mention rebasing, and callback failure isolation across every composer host.

## `useComposer().submit` and dispatch `experimental_submission`

`submit({ experimental_mode?, sendAt?, experimental_data? })` submits the
draft through the on-screen composer's own queue or steer handler and rejects
with a user-presentable reason when it cannot. It requires a draft: where the
shortcut would steer the next queued message from an empty draft, `submit`
rejects instead. Without a mode it runs whichever one
Enter runs for this user; `"queue-if-active"` and `"steer-if-active"`, the
names `bb.sdk.threads.send` uses, pick one explicitly, and
`"steer-if-active"` starts a turn where the composer has nothing to steer. The
options combine: `sendAt` and the plugin data travel into the same send,
queue or steer request the shortcuts build, so a scheduled steer steers the
turn running at its time. `experimental_data` reaches every `message.dispatch`
hook on the initial attempt as an `experimental_submission` envelope carrying
the submitting plugin's id. Core validates the data as JSON but neither
persists nor interprets it.

There is one implementation. The host's `ComposerBox` publishes `submit` on
the composer editor bridge for every composer plugin; it picks Enter's handler,
the queue handler or the steer handler and gates it exactly as the matching
shortcut is gated, then
calls the same `onSubmit` or `onModifierSubmit` the shortcuts and the send
button call, passing `sendAt` and the plugin submission. Only hosts that set
`sendsOnEnter` (the thread, embedded thread chat and New thread composers)
accept it. Off-screen voice sends run
the same Enter action. Every form rejects when the send fails; the Enter
action still shows its toast, and Enter and the send button ignore the
rejection.

Docs: `frontend-hooks-and-ui.md`, `backend-events.md`.

**Audit before stabilizing.**

1. **Programmatic send authority.** `experimental_data` permits an immediate
   submission without `sendAt`. Confirm which composer customizations should
   receive that authority before stabilization.
2. **Editors that save instead of send.** The queued-message and sent-message
   editors reject with "cannot submit programmatically". `isSubmittingBlocked`
   lets a row disable itself before a click; confirm whether those surfaces
   should run their own Enter action (save the edit) instead, and whether a
   plugin needs a capability flag to tell them apart.
3. **Data visibility.** Every dispatch hook sees the envelope and its owner id,
   not only the plugin that submitted it. Confirm that dispatch hooks remain
   the right trust boundary for plugin-owned submission data.
4. **Freshness of `sendAt`.** The host rejects a non-future `sendAt` at call
   time, but the server accepts any non-negative timestamp and dispatches a
   past one at once. Decide whether the send/create routes should refuse a
   past `sendAt` outright.
5. **No submission identity is returned.** The method resolves with nothing, so
   a plugin cannot address the queued row it just created without listing the
   thread's queue. Confirm whether the queued message id belongs in the result.
6. **Plugin-hosted new-thread composers.** `sendAt` reaches a hosting plugin's
   `onSubmit` and must be forwarded, but the submission envelope is not part
   of `NewThreadRequest`, so another plugin's `experimental_data` can be lost
   there. Decide whether to expose a forwardable experimental field or reject
   data-bearing submissions there.
7. **Two queue routes.** While Enter queues, a plain submit creates the queued
   row directly, as Enter does, so dispatch hooks first see it when the row
   drains. With `sendAt` or `experimental_data` it sends with
   `queue-if-active`, so the hooks run at submit time and again on the drain;
   only that inline pass carries the data. Both routes deliver into a running
   turn once its main run is idle. Decide whether Enter itself should queue
   through `queue-if-active`.
8. **Steering a queued message.** `submit` never steers the next queued
   message. Add an explicit operation for it when a plugin needs one.
9. **Scheduled submits without a mode.** `submit({ sendAt })` follows
   Enter, so it schedules a steer for users whose Enter steers. Confirm a
   caller that schedules should be required to pick a mode.

## `useComposer().setSelection`

`setSelection(selection)` sets a composer's pickers through the same handlers
the pickers call, so a plugin choice is indistinguishable from a hand-made
one. Fields the composer has no picker for are ignored. It resolves with the
composer's selection once values commit and the model catalog settles, or
after 15 s. `PluginComposerApi.selection` is the reactive read side. It is a
stable snapshot that re-renders consumers on picker changes, and it is `null`
for composers without pickers. Both are final-named under the composer API
exception.

Docs: `frontend-hooks-and-ui.md` (`setSelection` and the `selection` read).

**Audit before stabilizing.**

1. **Provenance.** A value set by a plugin in the new-thread composer is
   stored and reported exactly like a hand-picked one. Decide whether
   `executionInputSources` should carry a plugin source before a second
   consumer needs it.
2. **Timeout shape.** The bounded catalog wait resolves with the unsettled
   selection rather than rejecting. Confirm that is the right failure mode
   for a plugin that shows the result to the user.
3. **Provider inputs.** `environment.inputs` are not applied; the provider's
   inputs control keeps its own value. Decide whether the seed path's inputs
   handling should be reused here.
4. **Guard semantics after a project switch.** A call already in flight
   survives its own surface's unmount and resolves with the settled result.
   Confirm that is the behavior plugins expect, and whether the promise should
   also resolve early when the composer itself unmounts.
5. **Model-only thread changes.** A model change in a thread without a
   provider change sets the next turn's model in place, as the picker does.
   Confirm plugins do not expect it to start a handoff.
6. **Empty selections in the result.** `providerId` and `model` are omitted
   while nothing is selected and `environment` while nothing is submittable,
   which overloads "missing" with "no picker here". Decide whether the result
   should distinguish them.
7. **Selection read.** Audit snapshot identity across provider catalog
   reconciliation and off-screen composer lifetimes.

## Desktop browser control

`bb.sdk.experimental_desktopBrowsers` (`ExperimentalDesktopBrowsersArea` and
its `ExperimentalDesktopBrowser*` types) drives the desktop app's browser. It
provides explicit host/window/thread discovery, tab creation in the single bb
browser profile, and expiring control leases with scoped CDP connections. It
also provides capture, reveal, close and release, plus `subscribe`, which
polls tab state every two seconds and is not a lossless event log. Cookie
import from an installed browser uses `listImportSources` and `importCookies`.
Connection credentials stay private to workers on the browser host. The core
CLI is `bb browser`.

Before stabilization, audit control and cookie import authorization. Any
caller with server access can control tabs carrying the user's logins and copy
the desktop user's browser sessions into the bb profile. OS consent applies
only where the platform demands it: macOS Keychain for Chromium, Full Disk
Access for Safari, and none for Firefox or keyring-free Linux Chromium.
Decide whether control or import should require a desktop-side confirmation.
Also audit per-tab mutual exclusion and child-target scope, native popup
handling, debugger detachment, daemon/desktop disconnect and reconnect
generations, expiry and cancellation races, bounded screenshot bytes, and
cross-platform desktop startup. Cloud browsers and external provider
registration are outside this surface.

## Environments before threads and holds (`bb.sdk.environments.experimental_create`, `Environment.heldBy`, `sdk.environments.list({ heldBy })`, provider `adopt`)

`experimental_create({ projectId, hostId?, provider?: { id, inputs? }, name?,
hold })` creates an environment before any thread. The creation
intent (project, machine, provider selection, name, holder) is stored on the
environment row (`environments.held_by` plus the existing provider columns),
and the engine runs create and setup from it on the same path thread
provisioning uses, including the durable `environment:<id>:<key>:setup` row
and resume after restart. A user hold accepts joining threads and keeps the
environment until the user deletes it: both retirement places
(`refreshProviderRetirement` and the lifecycle sweep) skip held
environments. Environment responses carry `heldBy` and `statusMessage`;
`list` filters by `heldBy`. Composed providers (a new machine per thread),
version-1 providers and a located path that already has an environment are
refused. Core's caller is `bb environment create`.

`hold: "plugin"` holds it for the calling plugin (`pluginId` outside a
plugin; a plugin's `bb.sdk` always sends its own id): threads cannot join it
("held by <plugin>"), and a create that returns its path without adopting it
fails. A version-2 provider of that plugin hands one to a new thread with
`adopt(environmentId, resource)` (`adoptHeldEnvironment` in
`packages/db/src/data/environments.ts`), which in one transaction moves the
thread's reservation onto the held environment, records `resource`, and drops
the reservation. The hold stays until create returns, so other threads still
cannot join and a restart can tell the handover was unfinished. Setup does not
run again unless the provider then calls `setup(path)` with the adopted path,
which starts setup at once, as for a fresh create. The create must return the
held environment's path; the resource it returns replaces the one adopt
recorded, and the hold is cleared. A refused adopt changes nothing. The thread
starts only once create returns `created`. Any other outcome after an adopt (a
failed or aborted create, or a path other than the adopted one) fails the
environment and its thread, releases the hold, and the environment is retired
and removed with the recorded resource. Stopping the thread before create
returns discards the environment, as for a fresh create. After a restart
between adopt and create returning, core discards the environment (removed
with the resource adopt recorded) and puts the thread back on its provider
request, so it is provisioned again (`restartInterruptedHandOff`). Its only
caller is the Worktree plugin's warm pool, which checks a member under the git
ref lock, adopts it with a resource naming its placeholder branch,
fast-forwards it and calls `setup(path)` when it is behind the remote's default
base, waits for the thread's branch name, and renames the placeholder last.
Its removal also deletes the branch named in the worktree's completion file,
which the rename writes first, so a restart after the rename leaks nothing.
Disabling or uninstalling a plugin releases its holds on environments no
thread is taking (`releasePluginEnvironmentHolds`, on the plugin service's
`onPluginUnregistered`, the same signal that clears its queue waits), so the
environments retire like any other. Steps a provider reports after `adopt`
land on the adopted environment and the thread's provisioning transcript.

Docs: `backend-events.md`; CLI: `bb-guide-environments` guide chapter.

Before stabilizing, decide whether a hold needs release or re-hold (reuse
after the last thread, or a UI "New workspace" flow), whether `pluginId`
outside a plugin should be authenticated like RPC caller
identity, and whether `hold` should be optional for user creates.

## Machine paths and environment cleanup

`bb.sdk.hosts.get({ hostId })` includes nullable `threadStorageRootPath` from
the machine's latest daemon session, without waking the machine (CLI:
`bb machine show`). `bb.sdk.environments.experimental_cleanup({ environmentId })`
requests removal of an unused provider-managed environment, overriding
retention and bypassing cleanup backoff. It rejects live threads and unmanaged
environments and succeeds for already-removed ones. Acceptance is not
completion: read the environment lifecycle fields for progress (CLI:
`bb environment cleanup`). After five failed attempts, automatic removal stops
with a "Needs recovery" message and `lifecycle.teardown.needsRecovery: true`,
and cleanup without `recover` rejects with `environment_needs_recovery`.
The additive `recover: true` option acknowledges interrupted hooks and retries
failed cleanup after an explicit inspection. Core's cleanup route and the CLI
use this same path. Linux checks cwd and mapped paths for processes owned by
the daemon UID and refuses unreadable processes; other users require separate
inspection. Unsupported platforms refuse workspace recovery. Provider resources
without an owned workspace can restart removal without acknowledging any hooks.
No processes are killed by the inspection. Durable automatic recovery is tracked in #5962.

Before stabilization, audit path portability and session freshness after
machine re-enrollment, and cleanup retry behavior across unavailable
providers, concurrent attempts, and environments shared by archived and live
threads.

## Host process primitives (`@get-bb/plugin-sdk/host`)

`experimental_spawnPortableOutputProcess` spawns an output-only child process,
and `experimental_sanitizeInheritedChildProcessEnv`
(`ExperimentalSanitizeInheritedChildProcessEnvArgs`) filters the inherited
environment, for host-local plugin commands.

Callers: the one git runner in `bb-environment-provider-host/workspace-git`,
which the daemon (`@bb/host-workspace`, `apps/host-daemon`), environment
providers (`bb-environment-provider-host/git`) and the Git plugin host all call.
Runs that feed git stdin spawn with the provider-bridge entry's
`experimental_spawnPortableProcess`, the same spawn with piped stdin, and every
run is admitted through `experimental_runVcsProcess` with an explicit priority.
The GitHub PR Status plugin's host (`plugins/github-pr-status/host/git-host.ts`)
also calls both directly to spawn `gh`.

Before stabilization, audit command cancellation, inherited environment
filtering, and portable output handling for host-local plugin commands on
every supported OS.

## `TimelineOutputPreview.experimental_fullOutputAvailability` (`@get-bb/plugin-sdk`)

Says why a timeline row holds a preview instead of the full output, as
returned by `bb.sdk.threads.timeline`. `available` means a detail read can
still hydrate it. `detail-limit` means that read exceeded its byte budget.
`retention-expired` means the full value no longer exists.

**Audit before stabilizing.**

1. Confirm these three states remain complete if another output storage tier
   or hydration limit is introduced.
2. Confirm plugins need the storage-policy distinction rather than a simpler
   boolean indicating whether a detail read can succeed.
3. Verify old persisted previews and mixed-version clients still receive a
   deterministic state before making the field stable.

## Document Markdown (`MarkdownProps.experimental_document`)

The Markdown component accepts explicit `{ target, rootPath, threadId }`
document context. `target` is a workspace or thread-storage live-file
identity, and `rootPath` is its resolved root. Relative links and images
resolve from the document's directory within that root. Thread-storage targets
must name the same thread. Malformed context never falls back to the ambient
workspace. Omitting it keeps message routing.

Stabilize after plugin consumers verify nested paths, source identity, missing
files, containment and line locations.

## Message Markdown (`MarkdownProps.experimental_message`)

Requires SDK 0.6.158.

The Markdown component accepts the `{ id, threadId, turnId, projectId }` of the
chat message it shows, the same shape message directives and code-fence
renderers receive. With it, the code-fence renderers and message directives
plugins register render in the Markdown as they do in the thread timeline, and
receive that object as their `message`. A plugin that draws its own view of a
thread can then show a reply's inline UI, chips and embeds. Without it, or
when `id` or `threadId` is blank, fences render as code and directives as their
source text, as before. `openWorkspaceFile` is null.

Core caller: the thread timeline. `ThreadTimelineRows` provides the registries
through the same `MessageSlotRegistriesProvider`, and `ConversationMessageContent`
mounts fences and directives through the same `useMessageDirectives` and
`MessageCodeFences` (`apps/app/src/components/ui/message-markdown-slots.tsx`).

Plugin callers: none yet. It was added for #7770, a community request to show
GenUI `ui` fences and other plugins' directives in a plugin-drawn thread view;
no published plugin passes it as of 2026-11-19. If no plugin adopts it before
stabilization, delete it.

Stabilize after plugin consumers verify streaming text (the host passes
`streaming: false`), workspace file opening, and fence state keyed by a plugin
message id across remounts.

## `PluginFileOpenerProps.experimental_lineRange` (`@get-bb/plugin-sdk/app`)

Passes the owning file tab's latest one-based, inclusive
`{ startLineNumber, endLineNumber }` range to its opener (`null` for no
requested navigation). Each targeted open supplies a new object, so openers
observe its identity.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. Verify first, changed, identical, and rapid targets across workspace, host,
   and thread-storage files, tab remounts, and server synchronization.
2. Validate the identity-based repeat signal with third-party openers and
   decide whether an explicit request sequence is needed before stabilization.
3. Confirm absent-target, inclusive selection, EOF clamping, column support,
   file-tree navigation, and unsaved-edit behavior with more editor consumers.
4. Verify older hosts omit the prop safely and older plugins ignore it; audit
   reload restoration and cross-client range updates under the existing tab
   policy.

## `bb.experimental_serverAccess.recheck`

Sends a payload-less system `config-changed` notification to connected
clients, so configuration re-reads every registered provider's availability.
Core also re-reads availability itself to refresh the addresses its Host and
Origin guards admit (see `register`).

Docs: `backend-machines.md`.

Stabilization requires proving that a recheck from an unregistered or disposed
plugin is inert, that a provider cannot use it to force repeated refreshes of
unrelated configuration, and that pairing, unpairing and credential rejection
each reach the Machines settings section without a manual reload.

## `bb.experimental_serverAccess.register`

Registers a server access provider: `availability` (optionally with a public
`serverUrl`), `acquire({ key, hostId, signal })` returning a grant
`{ id, serverUrl, headers? }` or `{ status: "failed", message }`, and
`release({ key, hostId, grantId })`. Machines attach the grant's headers to
enrollment and runtime traffic. The required `routeKind`
(`"local-network" | "private-overlay" | "relay" | "custom"`) sets the
provider's default rank among the server's routes. It is required in the types
only: registration still accepts a declaration without it, from a plugin built
against an SDK before 0.6.188, and fills in `"custom"` once there;
providers of one kind rank by the earliest-installed plugin, not load order.
Every available provider is a route; there is no separate on/off, so a plugin
stops offering its route by reporting it unavailable or needing setup. Each
host holds a grant per provider, and the daemon session-open response and
system configuration advertise the routes in the user's order (advertisement is
behind the `serverRoutes` experiment; while it is off, routes are empty). Core's
own Local network and Manual providers use the same ordering and advertisement
path; Local network is added with `localNetworkEnabled` and Manual by setting
`machineServerUrl`. With `serverRoutes` on, providers rank by route kind after
the user's order; while it is off, they rank by the user's order, then the
earliest-installed plugin, then Manual. New machines install on the first
working route in that order, with `local-network` last. While a provider reports `available` with a
`serverUrl`, core's Host and Origin guards admit that URL's origin, as they do
for `BB_APP_URL` (plugin providers always; core's Local network and Manual
routes only with `serverRoutes` on); core refreshes the set when configuration
is read, on `recheck()`, and when plugins change. Core stores the set in
`app_settings_values` (`serverAccessOrigins`) and restores it at startup,
before plugins load, so the first request after a restart passes. A failed or
timed-out check keeps the provider's address; a definite `setup-required` or
`unavailable` answer, turning the route off, or disabling or removing the
plugin drops it. Callers: the bb connect plugin (`relay`) and the Tailscale
official plugin (`plugins/tailscale`, `private-overlay`), whose Serve address
is admitted this way.

Docs: `backend-machines.md`.

Before stabilization, prove retry-safe acquire/release across process death,
credential privacy and revocation, route ordering and per-host grants with a
second independent provider (such as a Tailscale provider), explicit and automatic
defaults, expired
codes, removal while a provider is unavailable, and both enrolment and runtime
traffic with independent direct and Connect consumers. Prove that admitting
an available provider's origin cannot be used to admit an attacker-controlled
host. Availability does not prove reachability from a remote machine.

## Machine enrollment and bootstrap

`bb.experimental_machines.bootstrap` prepares enrollment through the
provider's `MachineExecutor` and waits for the daemon connection. Each call
issues a fresh single-use credential for the same durable host identity. The
supporting `MachineExecutorRequest`, `MachineExecutor`,
`MachineBootstrapRequest` and `MachineBootstrapApi` belong to the experimental
`PluginMachines`, so their unprefixed names do not mean they are stable.

Docs: `backend-machines.md`.

Callers: the bundled Modal sandbox plugin
(`plugins/environment-modal-sandbox/providers/register.ts`). Independent
consumers now exist: about 7 community plugins call `bootstrap`
(andrewkchan/bb-plugin-cloud-sandbox on Vercel Sandboxes,
Not-Quite-Unicorns/bb-plugin-boat, sovyn-eu/bb-plugin-skiff among them).

Stabilization requires failure verification for expired credentials,
concurrent retries, interrupted exchange, cancellation, identity mismatch,
and restored snapshots. It requires an audit that credentials never enter
resource data or logs. It must verify
cleanup of a checkpointed allocation before successful enrollment, including a
safe no-op uninstall when installation never began, and retry after partial
installation. Migration and live vendor verification remain part of the
integration release gate.

## Machine provider `reconcileCleanup`

A required callback on `PluginMachineProviderDefinition`, used only when no
resource checkpoint exists. It discovers and removes uncertain allocations by
the durable launch key and must never allocate or bootstrap. Experimental
through `bb.experimental_machines`.

Docs: `backend-machines.md`.

Stabilization requires crash/abort coverage before submission, after
submission but before checkpoint, eventual vendor discovery, and
access-release retry coverage for each shipped provider.

## Machine provider `ephemeral`

An optional boolean on `PluginMachineProviderDefinition`, false by default,
for disposable compute. After the last live thread and its machine launch are
gone, core requests removal regardless of environment retirement policy.

Docs: `backend-machines.md`.

Callers: the bundled Modal sandbox plugin. Other compute providers now set it:
about 4 community plugins (ahkohd/bb-box, andrewkchan/bb-plugin-cloud-sandbox,
Not-Quite-Unicorns/bb-plugin-boat, sovyn-eu/bb-plugin-skiff).

Stabilization requires recovery coverage across environment retirement,
live-work races, provider unavailability, and repeated removal failures.

## Project checkout ownership

The provider context's `projectCheckout.ownsPath` (`experimental_ownsPath` in
version-1 contexts) is a required boolean whenever a checkout is present. It is true only for a checkout core
materialised at that exact path, derived from persisted source ownership and
never from caller inputs. Core's environment hook policy uses it to apply to
fresh machine clones and leave user-maintained attachments alone.

Audit ownership propagation and recovery before stabilizing.

## Coordinated machine maintenance

`bb.sdk.hosts.experimental_suspend({ hostId })` drains active work (bounded at
five minutes) and invokes the provider's suspend callback. It rejects with
`machine_busy` while a live launch, provisioning environment or checkout
preparation ties work to the host. Plugins own idle timing and preservation.

Docs: `backend-machines.md`, `backend-sdk.md`.

Stabilization requires interruption, checkpoint/restart, removal
serialization, failed drain, bounded drain and same-identity restore tests.

## Thread-sequence and terminal-input notifications

`experimental_thread.events` delivers `{ thread, sequence }`, coalesced to one
notification per thread per second. `experimental_terminal.input` delivers
`{ terminal }` after real user input is forwarded. Neither exposes contents.

Docs: `backend-events.md`.

Stabilization requires coalescing tests, live streaming/terminal
verification, current-status behavior, and review of event delivery overhead.

## Thread parent-change notifications

`experimental_thread.parentChanged` delivers `{ thread,
previousParentThreadId }` after a `threads.update` moves or releases a
thread, or after core releases an archived thread's unarchived children (one
event each, after the archive commits). Threads below the moved one get no
event. Push-notifications uses it to republish the moved subtree's levels.

Docs: `backend-sdk.md`.

Second consumers exist: about 4 community plugins listen for it
(gpambrozio/bb-plugins, muhammad-siddeek/bb-plugin-shop-kanban,
smsunarto/bb-plugins among them).

Stabilization requires deciding whether a general `thread.updated` event
should replace it.

## Thread read notifications

`experimental_thread.read` delivers `{ thread }` after a thread's read state
changes and it is now read (`lastReadAt >= latestAttentionAt`): a client
opened it or marked it read, or the user sent it a turn. Marking a thread
unread does not fire it. Core's own read path is the trigger: every
`lastReadAt` write raises the `read-state-changed` thread change, and the hub
emits the event from there, so the payload is the same read state the
sidebar's unread dot uses. Push-notifications uses it to remove the thread's delivered
notifications from phones and from open web and desktop clients.

Docs: `backend-sdk.md`, `backend-events.md`.

A second consumer exists: one community plugin,
neoromantic/bb-plugin-voice-reactions, listens for it.

Stabilization requires deciding whether a general `thread.updated` event
should replace it.

## Thread settled outcomes

`experimental_thread.settled` delivers one `PluginThreadSettledEvent`, a union
over every way a thread's work ends: `completed` (with `lastAssistantText`),
`failed` (with `error`), `cancelled` (with the removed queued `entry`, so
`entry.originPluginId` names whose message it was), `archived` and `deleted`.
Core emits it from the same seams as `thread.idle`, `thread.failed`,
`thread.archived`, `thread.deleted` and `message.cancelled`
(`apps/server/src/services/plugins/plugin-service.ts`), so it is never a
second, drifting source. Like every thread event it reaches the spawning
plugin only after that plugin's `threads.spawn` / `threads.fork` returns.
Automations (agent runs), Workflows (worker calls) and Tasks (delegated
thread status) close their records from it with one exhaustive `switch`; each
has a test table typed `Record<outcome, …>`, so a new outcome fails their
typecheck until handled. The fake plugin host follows the four thread events
with it; tests emit the `cancelled` outcome directly.

Docs: `backend-events.md`.

Stabilization requires deciding whether it replaces `thread.idle` /
`thread.failed` for record keeping, whether `cancelled` should also cover rows
dropped by other paths (a failed drain), and per-message correlation for
plugins that send several messages to one thread.

## Host deletion notifications

`experimental_host.deleted` delivers the removed host's public DTO once,
fire-and-forget. A plugin not loaded at removal never sees it, so it must
also reconcile against a 404 from `bb.sdk.hosts.get`. bb connect
(`plugins/connect/src/plugin.ts`) listens for it, and so do about 6 community
plugins (ahkohd/bb-box, kalindudc/burn, SergeyZh/bb-plugin-jetbrains-central
among them).

Docs: `backend-events.md`.

Stabilization requires deciding whether hosts deserve their own event map
instead of `PluginThreadEventPayloads`, and covering removal paths added
later.

## Environment removal notification

`experimental_environment.removed` delivers `{ removal }` (environment id,
pre-removal host and path, provider ownership, removal time) after a
provider's removal is committed. Delivery is ephemeral, and provider success
does not guarantee the path was deleted.

Docs: `backend-events.md`.

Stabilization requires review of the payload fields, repeat-removal
semantics, notification timing, and recovery without guaranteed delivery.

## `bb.experimental_machines.getResource`

`getResource(hostId)` returns core's persisted host resource JSON, or null when
the host or resource is absent. Any plugin can read it, following the host
access model. It makes no vendor observation, and callers parse the
provider-specific data. Callers: the bundled Modal sandbox plugin, and about
6 community plugins, most of them machine providers (ahkohd/bb-box,
andrewkchan/bb-plugin-cloud-sandbox, sovyn-eu/bb-plugin-skiff among them).

Stabilization requires validating missing-resource semantics against those
providers.

## Environment compositions

`bb.experimental_environments.register({ id, displayName, description, icon, machineProviderId, environmentProviderId })`
declares a new-machine environment option backed by one concrete environment
provider. It supplies no lifecycle callbacks or inputs.

Docs: `backend-machines.md`, `frontend-components.md`.

Stabilization requires UI/CLI parity, registration validation, pre-allocation
refusals, provisioning timeline coverage, clone-failure machine retention and
later project-checkout/worktree reuse.

## Experimental host SDK machine operations

`bb.sdk.hosts.experimental_create`, `experimental_getEnrollmentCommand`,
`experimental_listProviders`, `experimental_reconnect`, `experimental_suspend`,
`experimental_resume` and `experimental_retryCleanup` have no unprefixed
aliases. `hosts.delete({ hostId, force: true })` is the path core's machine
removal dialog and `bb machine remove --force` use to finish a persistent
machine's removal whose environment cleanup failed while the machine is
disconnected; it skips on-machine environment cleanup, emits
`experimental_environment.removed` for each environment, and still runs the
provider's `remove`.
`experimental_getEnrollmentCommand` serves the in-memory manual setup command
and expiry only while that host is creating. Completion, removal, expiry and
server restart drop the command, which never enters persisted progress or
transcripts. `experimental_reconnect({ hostId })` returns
`{ command, windowsCommand, expiresAt, hostId }`, expiring commands that
re-enroll an existing machine.

Docs: `backend-machines.md`, `backend-sdk.md`.

Before stabilizing, verify creation cancellation through host removal,
same-host restoration, serialized removal, plugin callers and UI/CLI parity.
The enrollment command requires expiry/removal, credential authorization and
transcript-redaction coverage.

## Moving the server (`bb.sdk.experimental_server`, `hosts.experimental_deleteOldServerCopy`)

`experimental_server.checkMove({ targetHostId, serverUrl })` returns the
pre-move checklist (`ServerMoveCheckResponse`).
`startMove({ targetHostId, serverUrl, stopRunningWork: true, archiveExistingTargetServerData })`
freezes this server, copies its data to the target, starts the new server
there, switches machines over, and retires this process. `moveStatus()`
reports the active and last move. A move whose activation was never confirmed
reports `recovery_required` and keeps this server up and frozen. In direct
mode the status carries `destinationStatusUrl`. `cancelMove()` works until the
switch starts, and in `recovery_required` it rolls the switch back.
`export({ signal })` streams an unencrypted gzip archive with its `sha256`.
`hosts.experimental_deleteOldServerCopy({ hostId })` deletes the locked old
copy. All of them refuse machine credentials. Everything except status and
cancel requires the default-off `serverMove` experiment (403
`server_move_experiment_disabled`). CLI:
`bb server move|export|import|unlock|allow-connect|delete-old-copy|install-machine-service`.

Before stabilization, audit: authorization for plugin backends (`bb.sdk` runs
with owner access, so a plugin can export every secret or move the server);
the switch ordering against the bb connect tunnel and daemons that miss
`server.moved`; archive size limits and streaming memory use; cancellation
and failure recovery at every step, including a server restart mid-move;
behavior when the target runs a provider-managed machine; and whether
`startMove` should return immediately or expose progress through a durable
operation id instead of the in-memory status.

## Server sweep failures (`bb.sdk.experimental_server.sweepFailures`, `retrySweepFailures`)

`experimental_server.sweepFailures()` returns every failing item of the
server's periodic sweeps as `{ sweep, itemKey, attempts, firstFailedAt,
lastError, retryAt, needsRecovery }`. An item retries after 1, 2, 4, 8, 16,
32, and 60 minutes. From its eighth failure it reports `needsRecovery: true`
and keeps retrying hourly (`retryAt` is the next probe); its first success
deletes the record. `retrySweepFailures()` deletes every needs-recovery record
and returns `{ retried }`, so those items run on the next pass with a fresh
budget. Backing-off items are listed but not retried early. Both refuse machine credentials. Core's caller is
`bb server sweeps [retry]`; the delays come from
`apps/server/src/services/lib/persisted-retry.ts`, the owner every persisted
retry schedule uses.

Before stabilization, audit: whether sweep and item keys are stable names a
plugin may depend on, per-item retry instead of all-at-once, whether a
needs-recovery item should surface in the app (Settings or a notification), and
whether plugin backends should be able to clear core sweep state at all.

## `app.experimental_icons.register` and `experimental_Icon`

`app.experimental_icons.register({ name, component })` adds inline React
artwork to the shared app icon registry. Explicit registrations override
built-ins, and the first plugin id in lexical order wins collisions.
`experimental_Icon` renders a name with a `fallback` (default `Zap`).
Resolved explicit icon names win over plugin branding for per-item icons.

Docs: `frontend-components.md`.

Before stabilizing, audit component sizing and accessibility, fallback
behavior, collision precedence, whether per-registration disposal is needed
beyond the existing setup lifecycle, and compatibility for plugins vendoring
older Icon components. Verify icon precedence and load/unload fallback across
mentions, message actions, nav panels and fixed tabs, panel launchers and
their tabs, and legacy sidebar-footer actions.

## `experimental_ProviderIcon`

The shared frontend renderer for agent, machine and environment provider
artwork. It takes `providerKind`, `provider` and an optional `fallback`
(default `Code`), and resolves slot overrides, then the logo mask, the glyph,
and the fallback, without fetching.

Docs: `frontend-components.md`.

Stabilization: audit SDK prop ergonomics against all three provider kinds,
same-id isolation and legacy override fallback, asset-vs-glyph precedence,
cross-plugin overrides, reload/error/recursion behavior, accessibility and
theme rendering on desktop and mobile. Keep metadata fetching and plugin
branding separate from provider artwork resolution.

## `experimental_ThreadStatusGlyph` (`@get-bb/plugin-sdk/app`)

Renders bb's thread status glyph from `PluginThreadStatusGlyphProps`
(`indicator`, `archived?`, `rowStatus`, `hideIdleDraftLabel`, `size`); the
host owns icons, colors, and labels, and the caller resolves the indicator.
The SDK test fake exposes the props as `data-*` attributes.

**Core callers.** `ThreadStatusGlyph`
(`apps/app/src/components/thread/ThreadStatusGlyph.tsx`) is the SDK export
and the glyph in the thread search palette, the related threads info section,
the thread context card's sub-threads, and mobile recents. The thread-list
plugin draws its rows and collapsed-group rollups with it, and the Conductor
plugin draws its workspace sidebar and workspace tabs with it. Its labels and
the rule for when `rowStatus` replaces the indicator come from
`packages/plugin-sdk/src/internal/thread-status.ts`, the module behind
`experimental_resolveThreadStatus`.

Docs: `frontend-thread-list.md`.

**Audit before stabilizing.**

1. **Archived rows.** No plugin passes `archived` yet; confirm the archived
   glyph belongs on this component rather than in the archived list.

## `experimental_resolveThreadStatus` (`@get-bb/plugin-sdk/app`)

A pure function from `PluginThreadStatusInput` (the row's thread or null for a
group row, the threads it hides while collapsed, whether any of them holds a
draft, and another plugin's row status) to `PluginThreadStatus`: the
indicator, the row status when it shows in place of the indicator, the
accessible label, and whether anything is working. Hidden threads add their
attention and work; their queued messages do not count. The host installs the
function from `packages/plugin-sdk/src/internal/thread-status.ts`, so a plugin
built against an older SDK still resolves with the running host's precedence.

**Core callers.** It is the only status resolver.
`toPluginSidebarThread` (`apps/app/src/lib/plugin-sidebar-threads.ts`) fills
`PluginSidebarThread.indicator` with it. `useThreadListEntryStatus`
(`apps/app/src/hooks/useThreadListEntryStatus.ts`) resolves mobile recents
(including a collapsed parent's descendants), the thread search palette, the
related threads info section, and the thread context card through it, reading
the same draft and row status the sidebar reads. The thread-list plugin
resolves its thread rows and its collapsed parent, section, project,
environment, and hidden-group rollups through it. `apps/app/src/lib/thread-status.test.ts`
runs one case table through both the core and the plugin inputs.

**Audit before stabilizing.**

1. **Rollup scope.** A collapsed parent row folds in hidden threads' attention
   and work but only its own row status; a collapsed group uses the first
   hidden thread's row status. Decide whether the input should take hidden
   threads' row statuses too (see #5810).
2. **Unread grouping.** The thread-list plugin's read-status grouping keeps
   its own "unread and done" predicate. Decide whether that predicate belongs
   in the SDK next to this function.

## `HostsArea.experimental_reconcile`

Explicitly reconciles a provider-managed machine with core's recorded state.
For a suspended machine it starts the provider's suspension operation and
returns HTTP 202; callers poll host status for completion. Active and
transitional states are left unchanged. Provider suspend and resume must be
idempotent. CLI: `bb machine reconcile`.

Validate concurrent resume/removal, failure reporting, long-running caller
behavior, and the scope of supported states before stabilizing this API.

## Lifecycle ownership on thread creation

`bb.sdk.threads.spawn` and `bb.sdk.threads.fork` accept
`lifecycleOwnerThreadId`, and thread responses expose its nullable value.
These are data fields on existing SDK methods, so they carry no prefix.

Audit before stabilization: immutable cross-project ownership, cross-host
cleanup, archive/delete retries, creation races, and preservation of existing
unowned threads.

## Environment provider location (`locate`)

`PluginEnvironmentProviderDefinition.locate({ host, projectCheckout, inputs })`
returns `{ path, reuse }` or null without mutating anything; version-1
`experimental_existingPath(inputs)` is read as `{ path, reuse: true }`. With
`reuse: true`, a usable environment of that project at the path is reused
with its provider, ownership, resource and cleanup identity intact, and an
unusable one is refused. Otherwise core claims the path, refuses while
another live thread uses an environment there, runs create on a fresh
reservation, and folds a result at the same path into that environment.
Other projects' managed paths remain forbidden.

Stabilization requires lifecycle coverage for reuse, missing paths, cleanup in
progress, cross-project ownership, and concurrent creation before binding.

## Composer editing: `insert` and `replace`

Michael explicitly requested the final names `insert` and `replace`, an
exception to the experimental-prefix rule. `PluginComposerApi.replace` takes
an explicit `ComposerDraftReplacement` or a synchronous updater from the
latest `ComposerDraftSnapshot`, and never infers mention reconciliation.
`insert` inserts at the cursor or end. The legacy `setText`, `updateText`,
`clear`, `addQuote`, `insertMention` and `removeMention` are `@internal`
runtime-only methods.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, audit snapshot identity and updater failure/lifetime
behavior across mounted, offscreen, and ephemeral editors, replay of attachment
paths in their owning project, and migration of third-party text transforms to
explicit mention ranges. Decide whether command application merits a shared
public operation.

## Thread creation placement

`useBbNavigate().toCompose({ placement })` takes `{ sectionId: string | null,
pinned: boolean }` and files the thread created from the compose screen in
that section and pin state. Without `placement`, the compose screen keeps the
placement it already shows, unless `environmentId` or `hostId` is set, which
resets it to unpinned and outside sections (`RootComposeView.tsx`). The
composer sends this placement with normal and scheduled creation. The bundled
thread-list plugin passes it (`ProjectRow.tsx`, `ProjectList.tsx`), and so do
about 2 community plugins (Johannes-Berggren/bb-plugin-jb-flow,
OXI-717/bb-plugins). The older `PluginSidebarThreadActions.openNewThread`
option `experimental_placement` belongs to the superseded sidebar actions
listed under Scheduled removals.

Audit pinned groups, custom sections, project/machine groups, route
transitions, draft recovery, and third-party sidebar compatibility before
stabilizing this option.

**Opening the New thread screen.** `toCompose`'s `split: true` is stable and
unprefixed, matching `toThread`'s `split`: bb opens the screen in a right split
beside the caller, replaces the focused pane at the pane cap, and navigates
plainly on compact viewports or without a split layout. The screen is a single
pane, so when it is already open bb focuses it and applies the other options
there. `openNewThread` (`split-layout/openNewThread.ts`) is the only way to
open the screen for the user, with or without a split: `toCompose`, the
superseded sidebar actions' `openNewThread`, the sidebar New thread button and
its Open in split, the `thread.new` command, New thread in environment,
Create plugin/skill and Edit via chat entry points, Create custom palette, and
the screen after quick-creating a project. The bundled thread-list plugin's
`+` buttons pass `split: true` on Cmd/Ctrl-click, like the sidebar New thread
button.
Redirects after a deletion or a disabled plugin and route repair only build the
path. Requested in #8011 (a nav panel opening the composer beside a note) and
#2795.

**Replacing the draft.** `toCompose({ initialPrompt, experimental_replacePrompt: true })`
replaces a draft that already has text with `initialPrompt`; without it the
draft wins and `initialPrompt` is dropped, and without `initialPrompt` the
option does nothing. It maps to `openNewThread`'s `replaceInitialPrompt`, the
option bb's own Create skill, Fork skill, Edit skill via chat, Edit plugin
via chat and Create plugin from a template pass (`SkillsLibrary.tsx`,
`ToolsView.tsx`, `PluginsOverview.tsx`), so both read the
same route state in `RootComposeView`. It replaces a hidden branch that gave
only the Automations plugin `replace` + `replaceInitialPrompt`, and only on
its edit route, where its one `toCompose` button (Edit with chat) is disabled.
Callers: Automations' New automation, template Use and Edit with chat
(`plugins/automations/app.tsx`). Before stabilizing, check the about 45
community `toCompose({ initialPrompt })` callers for ones that want the
replacement, and decide whether it should be the default for
`focusPrompt: true` entry points.

## Provider discovery metadata

`package.json` → `bb.experimental_providers` statically declares
`{ kind, id, displayName }` provider identities before a plugin runs. Only
`kind: "agent"` is accepted. It keeps a disabled plugin's agents discoverable
in Settings → Providers, and grants no runtime capability. Add `"environment"`
or `"machine"` only together with a consumer.

Stabilize after validating first-install discovery, shared-plugin enablement,
dynamic provider removal, plugin upgrades, and duplicate-ID ownership behavior
with third-party providers.

## Project folders (`sdk.projects.sources.experimental_folders`, also on `PluginBbSdk`)

`list({ projectId, sourceId })` returns the extra folders of one project
checkout (`ProjectSourceFolder`: `id`, `projectSourceId`, `path`,
`createdAt`) in order. `add({ projectId, sourceId, path })` checks that the
path is absolute, exists on the checkout's machine, is not the checkout,
inside it or containing it, and is not already listed (409
`project_source_folder_conflict`; at most 64), then appends it.
`update({ projectId, sourceId, folderId, path })` repoints a folder in place
with the same rules. `remove({ projectId, sourceId, folderId })` deletes it.
Every thread of the project on that machine can read and write the folders
from its next turn. Routes: `GET|POST /projects/:id/sources/:sourceId/folders`,
`PATCH|DELETE …/folders/:folderId`.

Core callers: the project settings Folders section
(`project-source-folders-query.ts`, `project-mutations.ts`) and
`bb project folder list|add|update|remove`.

Before stabilizing, decide whether folders belong on the checkout (per
machine) or on the project with per-machine paths, whether environment
providers should read them (for example to make a worktree of each), and
whether `list` should report which folders are missing on the machine.

## Global prompt history (`bb.sdk.experimental_promptHistory`)

`list({ cursor?, limit?, signal? })` returns `{ entries, nextCursor }`, every
accepted user prompt newest first, each with `id`, `createdAt`, `input`,
`projectId`, `threadId`, and `scope` (`"project"` for a prompt that started
a top-level thread, `"thread"` for a follow-up). `limit` is a digit string (default 100, max 1000).
A page can be short while `nextCursor` is set, because unparseable rows are
skipped. The same route backs `bb prompt-history list`.

Before stabilization, audit whether `limit` should be a number, whether the cursor format needs versioning, whether project or thread filters belong on this call rather than on `projects.promptHistory` and `threads.promptHistory`, and whether skipped rows should fill the page.

## `ThreadChatMessageReference.experimental_messageSeq`

The message reference handed to `messageAction` runs, `ThreadChat` consumer
message actions, and prose selections carries the event sequence that recorded
the message. It is the `msg` value of a message link and the seq accepted by
`sdk.threads.message` and `bb thread log --message`, so a plugin can build or
resolve a message link without guessing. It equals `sourceSeqEnd` except for a
steer, which is recorded by its request and shown at its acceptance.
Stabilize once message links have shipped and the seq has stayed stable across
edit-and-rerun, forks and context clears, and decide whether `sourceSeqEnd`
should remain alongside it.

## `PluginBbSdk.plugins.experimental_startUpdate` and `experimental_updateJobs`

Starts a server-owned plugin update and returns its job at once;
`experimental_updateJobs.list/get` report queued/running phases and the
terminal update, rollback, or failure. Jobs survive client disconnects, stay
ten minutes after finishing, and live in memory only. `applyUpdate` keeps its
result contract by polling the job; raw callers without
`Prefer: respond-async` keep the synchronous response. Running updates cannot
be cancelled during activation or rollback.

Stabilization requires exercising reconnect/reload, concurrent deduplication,
rollback delivery, missing jobs after restart, and CLI/SDK parity.

## `PluginBbSdk.hosts.experimental_startProviderCliInstall` and `experimental_providerCliInstallJobs`

Starts a server-owned provider CLI install or update on a machine and returns
its job at once (`POST /hosts/:id/provider-clis/install-jobs`, 202).
`experimental_providerCliInstallJobs.list/get` report `running`, then
`completed` with the installer's events or `failed` with the reason the
machine could not run it; `wait` polls `get` until the job ends and rides out
up to two minutes of the server being unreachable. Starting the same provider
on the same machine while a job runs returns that job. Jobs survive client
disconnects, stay ten minutes after finishing, and live in memory only, so a
server restart answers `provider_cli_install_job_not_found`. Installs on one
machine run one at a time. When the machine refuses an action that is no
longer needed and a fresh status shows the provider installed (install) or
current (update), the job completes with one successful `completed` event
whose `exitCode` and `signal` are null, instead of the refusal.
`installProviderCli` keeps its events contract by starting a job and waiting
on it. Core callers: the Updates settings section,
the sidebar updates badge and the setup guide through
`provider-cli-install-store`, which also follows jobs started elsewhere
(another device or before a reload), and `bb updates apply` and
`bb machine` through `installProviderCli`. Stabilize after reload, server
restart and multi-device follow have been exercised on released builds, and
once streaming installer output into the job (which needs a daemon protocol
change) is settled.

## `PluginApplyUpdateArgs.range`, `expectedVersion`, and `rangeUpgrade` on update checks

`checkUpdates` and `listUpdateResults` entries carry `rangeUpgrade` when a
newer stable release sits outside a git semver or npm range source's saved
range: `currentRange`, the proposed `range`, `basis` (`catalog` when the
plugin's marketplace entry still lists the same repository or package and its
current range admits the release, `release` for installs from no marketplace
or a removed one, which get `^<version>`; none is reported once the plugin's
marketplace no longer lists it), the `candidate`, `breaking` (caret rule from the installed
version), and `reasons` when the candidate fails engines on this bb.
`applyUpdate` and `experimental_startUpdate` accept `range` to change the
saved range in the same staged activation (refusing pinned sources, ranges
with nothing newer, and downgrades) and `expectedVersion` to refuse a
candidate other than the one reviewed. Core callers: the plugin details
Review action and `UpdatePluginDialog` through `startPluginUpdate`, and
`bb plugin update <id> --range`. Stabilize after the rollback of a range
change, catalog-range adoption, and npm range changes have been exercised on
released builds, and once a later decision on following non-breaking catalog
range widenings automatically is made.

## `PluginBbSdk.system.experimental_recordTelemetryEvent`

Posts one anonymous product event to `POST /api/v1/system/telemetry/events`,
which forwards it to usage telemetry under the install's anonymous id and
drops it when usage data sharing is off. The schema is a strict allow-list of
setup-guide, new-thread-submit, plugin-creation-started, and release notes
events; anything else is a 400. App callers, all through `recordTelemetryEvent`
in `apps/app/src/components/onboarding/onboarding-telemetry.ts`: the setup guide
(`OnboardingFlow`, `useOnboardingProjectImport`, and agent installs it starts
through `provider-cli-install-store`), `NewThreadComposer`'s `new_thread_submit` outcomes,
`PluginCreateButton`'s `plugin_creation_started`, and Settings → Updates'
changelog (`release_notes_opened`, inline or on the web). `bb plugin new` sends
`plugin_creation_started` through the same SDK method. The setup guide's
Plugins step reports `recommendation` `shown`, `selected` and `deselected`
(a featured plugin switched back off) with a per-visit `recommendation_id`; `selected` also stores that id in server-owned settings
until the plugin's next use, disable or uninstall. `NewThreadComposer` also
reports `new_thread_blocker` once per blocker reason while a draft exists.
`onboarding_agent_state` adds `agent_statuses`, each agent's provider status
by id; the server keeps only shipped agent ids.
`onboarding_operation` reports a guide action's started, succeeded or failed
outcome with only a public agent or plugin id or counts and, for the Projects
step, whether the scan ran out of time and how many folders it could not open.
A failed operation or `onboarding_sign_in` adds a `failure_reason` from a fixed
set (`no_host`, `host_unavailable`, `timed_out`, `not_found`, `permission`,
`command_failed`, `unsupported`, or `other`); a failed `remote_access` adds a
`failure_stage` (`sign_in`, `pairing`, or `turn_on`) instead. Agent install
and sign-in failures with `command_failed`, and `sign_in` or `pairing`
remote access failures, may add `failure_detail` from a fixed set of error
classes and an integer `exit_code`; never output or messages.
`onboarding_left` reports the step a guide was on when the page unloaded
before the guide finished; it passes the optional second argument
`{ keepalive: true }`, which sends the request with `fetch`'s `keepalive` so it
outlives the page. A failed `new_thread_submit` may add `failure_reason` from
the same fixed set.
`onboarding_error` reports `kind` (`render`, `uncaught` or
`unhandled_rejection`) with the guide's step, from `OnboardingErrorTelemetry`
around the guide in `OnboardingGate`, which reports and rethrows render errors
and listens for window errors only while the guide is open.
`onboarding_exposed` (`entry`) marks the guide being shown.

Stabilize after deciding whether third-party plugins may emit product events
at all and, if so, how they are namespaced and rate limited.

## `PluginBbSdk.system.experimental_cliCommand`, `experimental_installCliCommand`, and `experimental_removeCliCommand`

`experimental_cliCommand()` reports whether `bb` is on PATH on the server's
computer: `supported` (false without an installed bb-app launcher),
`installedPath`, `onPath`, and `shadowedBy` (`source` `npm`, `machine`, or
`other`). Install links `<dataDir>/bin/bb` into a PATH folder (on Windows,
adds `<dataDir>\bin` to the user PATH), replaces a bb machine install's
`~/.local/bin/bb` in place, and refuses to replace another `bb`
(`409 cli_command_blocked`); install and remove return the new status, fail
with `409 cli_command_unsupported` when unsupported, and 403 for machine
credentials. Core callers: Settings → General → Command line
(`CliCommandSettingsSection`) and `bb settings cli-command`.

Stabilize after deciding whether the command should be installable per
machine through the host daemon (enrolled machines get `~/.local/bin/bb` from
`install-machine.sh` today), and after exercising real Windows and macOS
installs.

## `PluginBbSdk.system.experimental_scheduleAppUpdate`, `experimental_cancelScheduledAppUpdate`, and `experimental_setAppUpdateAuto`

`experimental_scheduleAppUpdate()` updates bb once no thread is running
(`starting` or `active`). With none running it starts the update at once, like
`applyAppUpdate`; otherwise it returns the status with `scheduled:
{ requestedAt }` and the server starts the update after running threads have
stayed at zero for five seconds. A thread that starts while the update downloads
puts it back to waiting instead of recording a failure: the server sends the
launcher a `defer` decision, and the desktop service hands the download back.
`scheduled` stays set while that update downloads; clients tell waiting from
downloading by `activity.phase`. Scheduling again while one is pending returns
it unchanged. Both refuse like `applyAppUpdate` when the update is unsupported,
blocked, unavailable, or already running, and 403 for machine credentials.
The server sends `app-update-changed` whenever the running
thread count changes, so `runningThreadCount` stays current for clients.
`experimental_cancelScheduledAppUpdate()` clears the schedule, and a scheduled
update that is already downloading defers instead of restarting; it is a no-op
without one. Cancelling also records the available version as skipped
(`availableSkipped: true` in the status), so the server's automatic check does
not schedule it again until a newer one appears; that check also skips a
version whose last update attempt failed.
`experimental_setAppUpdateAuto({ enabled })` saves the automatic update setting
(`autoUpdate` in the status) and returns the status. While it and the
experiment are on, the server checks right away, 30 s after boot, and every
hour, and schedules what it finds; turning it off stops the checks and
drops a waiting update. It returns 403 like the schedule routes. Applying by
hand also clears a schedule, and schedule, apply, and the
scheduled start run one at a time. A scheduled start the server refuses ends the
schedule with only a log line; the status's `blocked`, `support`, or `activity`
shows why. The schedule lives in server memory and is lost when the server
restarts. Core callers: Settings → Updates (the "Restart and update bb
automatically" switch, and Skip this version on a waiting update) and
`bb updates app apply --when-idle` / `bb updates app cancel` /
`bb updates app auto`.

Stabilize after deciding whether the schedule should persist across server
restarts, whether threads waiting on a user decision should count as running,
and whether the settle window should be configurable, and once the
update scheduling API has completed its audit; then rename project-wide and
remove this entry.

## `PluginBbSdk.hosts.experimental_discoverRepos`

`hosts.experimental_discoverRepos({ hostId })` lists up to 10 git
repositories under the machine's home directory with local activity in the
last 30 days, newest first, each with `path`, `name`, `lastActivityAt`,
`originUrl`, and the bound `projectId` or null; `truncated` reports an
exhausted three-second walk budget, and `unreadableCount` counts folders the
scan was not allowed to open (`EACCES`/`EPERM`, such as macOS
privacy-protected folders). The walk skips dot, build, and scratch
directories, linked worktrees, and submodules. Core callers: the setup guide
(`OnboardingFlow`) and `bb project discover`; it rides the
`host.discover_repos` daemon command.

Stabilize after deciding whether depth, recency window, and limit should be
caller options, and after exercising slow or network-mounted home directories
and Windows hosts.

## Shared VCS process admission (`@get-bb/plugin-sdk/host`)

`experimental_runVcsProcess(command, args, operation, options)` admits a `git`
or `gh` operation to the runtime's shared queue before invoking it. `args` are
the command's arguments; they classify git network subcommands (`fetch`,
`pull`, `push`, `clone`, `ls-remote`, `submodule update`, `remote update`).
Arguments without a network subcommand, including an empty list for pipelines,
admit to the local pool. The call holds the permit until the returned promise
settles; callers must await child close and termination cleanup. Calls nested
inside an admitted operation run under the outer permit without queueing again.
`ExperimentalVcsProcessOptions` accepts `priority` (`interactive`, `status`,
`background`), an optional cancellation signal, and `slots` for pipelines
that start multiple git children. Queue cancellation prevents spawning; callers
own cancellation of running children. Execution timeouts begin after admission.

The runtime keeps two disjoint pools. The local pool admits
`clamp(os.availableParallelism() - 2, 4, 6)` local git children, computed once
per runtime: background work can fill two fewer slots and status work one
fewer, so eight or more cores give six, five, and four. The
network pool admits at most four network git or `gh` children, with at most two
`gh`: background work can fill two slots and status work three. Waiters gain one
priority level every 15 seconds. FIFO applies within effective priority in each
pool: when the first waiter that is not held back by the GitHub lane needs more
slots than its pool has free, later waiters in that pool wait behind it, so
pipelines are not starved by single-slot work. A blocked GitHub waiter does not
block eligible network git work, and neither pool blocks the other. The budget
is shared across module copies in one Node runtime, including bundled plugins.
Separate host daemons and server processes own separate budgets; arbitrary
commands run by agents or terminals are outside this queue.

Core buffered git/gh reads, streaming status/diff reads, blob reads, shell
pipelines, watcher setup, environment provisioning, and the GitHub plugin use
this path. The CLI and SDK's workspace reads and mutations reach the same host
handlers. Host commands give explicit user mutations and diff panels interactive
priority, status reads status priority, and PR polling/watcher setup/provisioning
background priority.

Before stabilization, audit cancellation and permit release on all supported
platforms, mixed plugin bundles sharing the singleton, aging under sustained
load, whether the CPU-scaled local capacity needs a host override and reflects
container CPU quotas on supported hosts, whether argument
classification should cover more network commands (for example `git lfs`), and
whether work that escapes an admitted operation's async context should regain
admission. Verify that every caller holds permits until its last admitted child
exits, including pipelines.

## Navigation-panel route sidebar

`PluginNavPanelRegistration.experimental_sidebar` is an optional component
receiving `PluginNavPanelProps`. `AppLayout` resolves one route sidebar per
location with `resolveRouteSidebar`: Settings, Plugins and Skills are core
entries, and a live navigation panel with `experimental_sidebar` is a plugin
entry. `AppLayoutSidebar` mounts whichever entry resolves in the alternate
sidebar body, holds the outgoing entry while a compact drawer closes, and
retains the native rail and mounted thread-list state. Every entry renders in
`SectionSidebar`, which owns the top chrome and history controls, the "Back to
app" row and title in the top-list layout, compact-drawer dismissal for SDK and
delegated-link navigation, and the resize handle. Panel sidebar routes are
section routes in `useAppSettingsRouteMemory`, so Back to app and the `app.back`
command return to the last core app route, as from Plugins and Skills. A crash
shows the plugin crash notice inside the section until the subPath or plugin
generation changes. Registration and route switching change no setting, thread,
draft or execution state.

Docs: Plugin Guide Full-page panels surface. Stabilization requires exact route,
back/forward, disable/reload/crash, compact focus and single-sidebar replay with
real plugin CSS in both navigation layouts. The API is generic; no plugin-id
special case exists in core. CLI navigation uses the existing panel URL; this
field introduces no separate backend or headless side effect.

## Plugin contract live reads and writes

- `experimental_useRpcQuery`, `experimental_useRpcKeyedQuery`, `experimental_useRpcMutation`, and `experimental_useRpcRefresh` use the core `@bb/query-tags` cache mechanism per client. Query state keeps previous data during refresh errors; consumers show an inline Retry using `refetch`. Successful reads clear the error. Keyed calls accept `{ keys }` and return a record containing every requested key; consumers share one observer per plugin/method and requests batch up to 200 keys. Each hook watches a key once while it holds it, so a changing key list subscribes only added keys and releases only removed ones (main re-subscribed every key on each change: 3,100 subscribe and 3,100 unsubscribe frames while scrolling a 70-thread sidebar). A keyed `refetch` refreshes only the calling hook's keys, batched with other hooks refreshing in the same tick. A pure `select` projection retains unchanged JSON subobjects across key and fetch-state changes, so default rows do not republish unchanged notification levels.
- `ExperimentalRpcMutationState.pendingInputs` contains every in-flight input for that hook instance until the server acknowledges its write. Background rereads are excluded. `isPending` remains true while any input is pending. Core `useTaggedMutation` exposes the same state from TanStack's mutation cache. Stabilization requires hook-instance isolation, concurrent targets, failure cleanup, and pending feedback surviving row moves between groups.
- `ExperimentalRpcMutationOptions.optimistic(input, cache)` predicts loaded cached values before the write. `cache.update(method, input, updater)` targets a plain read, and `cache.updateKey(method, key, updater)` targets one keyed row. `cache` is an `ExperimentalRpcOptimisticCache`. Pure updaters receive the currently visible value and return its prediction. An absent plain read is skipped; a keyed row that loads while the write is pending shows the prediction. Predictions are shared by every reader on that client. Core thread writes pass the same optimistic descriptors to the same `@bb/query-tags` implementation.
- Predictions remain over incoming reads until confirmed matched reads arrive, independently of mutation pending state. A rejected write rolls back its layer and surfaces the mutation error. An accepted write whose refresh fails keeps its prediction with the read error and Retry; a successful refresh replaces it. Later predictions and confirmed values are protected from older mutation settles and rollbacks. Inverted completion retains the later confirmed value until a subsequent fresh read can replace it. Keyed rows live in the `@bb/query-tags` keyed store: a row prediction is never written into the stored row, and an accepted one stays until a read of that row that started after acceptance replaces it. Stabilization includes overlapping writes, external invalidation, refresh failures, plain/keyed targets and completion without stale flicker.
- `defineRpcContract` accepts `tags(input, output)` and `keyTags(key, value)` from `ContractTagDeclarations`; both receive validated values, and the tags travel in the RPC envelope. Writes declare nothing: the server calls `bb.rpc.experimental_invalidate` where the data changes, so a write from the app, the CLI, an agent tool or background work refreshes matching reads once. Tagged mutations resolve at write acknowledgement while matching active reads refresh in the background. Contract `invalidates` is retired (see its Retired entry).
- `bb.rpc.experimental_invalidate(tags)` requires nonempty tags; `experimental_invalidateAll()` refreshes all reads of that plugin, including untagged reads. Load, reload, disable and reconnect refresh plugin reads through the same cache path. Plugin changed messages are scoped to `{ kind: "plugin", pluginId }` subscribers; reconnect batches subscriptions and unknown targets are ignored.
- Test harnesses: the fake host records each `experimental_invalidate(tags)` in `inspection.experimental_rpcInvalidations` (`null` for `experimental_invalidateAll()`) and calls `experimental_onRpcInvalidation` listeners. `renderSlot` drives the client side with `experimental_invalidateRpc(tags | null, pluginId?)`, which refreshes matching reads inside `act`, and its `experimental_rpcContract` option validates each `rpc` handler's input and output against the contract's schemas, like the real client.
- Tags are plugin-only. Core reads refresh through `changed` messages; UI preferences use the `ui-preferences-changed` system change. Core keeps each thread once, in the same `@bb/query-tags` keyed store as plugin keyed rows, and derives thread detail, every thread list, search and sidebar navigation from it as keyed views. Every core thread write (pin and unpin through one batcher, read state, rename, section and parent moves, archive, unarchive, delete, stop, send status, environment rename) predicts on the entity with `optimisticKeyedUpdate` through `beginOptimisticMutation`, the path `cache.updateKey` uses, and confirms at the server's acknowledgement. One contract table (`@bb/query-tags/testing`) runs against core thread entities and plugin keyed rows; the pin hooks add `useTaggedMutation` with `meta.errorMessage` for core's error toast. Push-notifications thread levels are the first plugin caller; delivery retains `useRealtime`. The GitHub PR Status plugin's composer segment and Info row call `experimental_useRpcKeyedQuery` and `experimental_useRpcMutation` from their own slots. The retired sidebar pull request member calls the keyed read with an explicit `pluginId: "bb--github-pr-status"` outside any plugin slot, the call another plugin makes; the hooks require `pluginId` only when no plugin slot provides one. Stabilization requires additional plugin callers and validation of scoped tags, failures, reconnects, batching and sidebar observer counts. Cache seeding remains outside this API.

## Typed RPC refusals (`experimental_PluginRpcRefusal`)

- Handlers throw `new experimental_PluginRpcRefusal({ code, message, issues? })` from `@get-bb/plugin-sdk`. Codes map to HTTP statuses: `forbidden` 403, `not_found` 404, `conflict` 409, `invalid` 422. Issues use `PluginRpcValidationIssue[]`. The existing `{ ok: false, error: { code, message, issues? } }` envelope carries the refusal to app hooks, SDK calls and CLI errors.
- Refusals count as invocations, but do not increment handler errors or change plugin status detail. Ordinary throws remain `handler_error` / 500. Refused writes reject so shared optimistic updates roll back.
- Core caller: bb-account's connect-only credential RPC handlers use the same runtime, HTTP route and caller contract as third-party plugins. The fake host and `renderSlot` accept the same thrown refusal.
- Stabilize after validating caller-gated refusals and optional issue propagation across HTTP, app queries/mutations, SDK calls and CLI, including rollback and crash accounting. The SDK has no RPC watch, so SDK refusals arrive only through calls.

## Plugin RPC contract and client-state guarantees

- All three live hooks use `{ contract, method, ... }` with contract/method inference and no explicit generic arguments. Plain reads add `input`, keyed reads add `keys` and optional `select`, and mutations add optional `optimistic`. `experimental_useRpcKeyedQuery({ contract, method, keys, select? })` infers rows and selection results from the contract value. `ExperimentalRpcKeyedMethod` restricts methods to schemas accepting only `{ keys: string[] }` plus optional/defaulted fields and returning string-indexed records; `ExperimentalRpcKeyedValue` derives their row values. The keyed state's `refetchKeys(keys)` reads only the given keys again and keeps the other rows; the Git plugin retries one failed patch or one environment's status with it. `defineRpcContract` rejects `keyTags` unless parsed input has string keys and output is a string-indexed record. Push-notifications is the first caller. Stabilization includes transformed schemas, invalid shapes and projected selections.
- `experimental_PluginRpcCallError` is exported from the SDK root and app entry and is the error of live read/mutation hooks and every rejected `mutate`. It always has `code: PluginRpcErrorCode`, `message`, optional validated issues and optional HTTP status. `transport_error`, `invalid_response` and `unknown_error` cover client failures; `plugin_not_found`, `plugin_not_running`, `invalid_caller`, `forbidden_origin` and `unsupported_media_type` (SDK 0.6.192) are the route's own failures before a handler runs. The union may grow: consumers need a fallback; unknown server codes map to `unknown_error` and remain in `serverCode`. CLI output preserves newer codes without assuming an exhaustive list. Core callers use the same HTTP, SDK and command error boundaries; bb-account exercises expected refusals. Stabilize after version-skew, transport, malformed-response and refusal checks.
- `mutate`, `isPending` and `pendingInputs` finish at write acknowledgement. Core thread writes have the same semantics through `useTaggedMutation`. Cache predictions survive background refreshes and failed rereads until fresh confirmed data arrives. Write rejection rolls back. Owner tests cover acknowledgement, held refreshes, reconciliation and concurrent predictions.
- BB read state means: `data` is the latest successful value plus predictions, retained during refresh errors (plain reads start undefined; keyed selections receive loaded rows, initially an empty record). `isLoading` means an enabled read is fetching never-loaded requested data. `isFetching` includes background attempts; keyed views share method activity. `error` records the completed read failure and clears on success; retrying a first load clears its old error while loading. `refetch` forces a read and waits through retries; failure remains in `error` and its promise resolves. Production freshness is two seconds without polling. Focus does not refetch while BB's realtime connection is healthy; while disconnected, focus/browser-online events recheck stale active reads. BB reconnect invalidates all plugin reads regardless of freshness. Page hiding cancels active attempts and resume restarts cancelled reads. Invalidations refresh immediately. Tags remain plain strings. Network/abort failures retry twice with 250 ms delay, HTTP failures never retry, and writes never retry automatically. No query-library options are exposed.

## Page titles

`PluginNavPanelRegistration.experimental_usePageTitle(props)` returns
`ExperimentalPageTitle | null`: either `title` or
`breadcrumbs: { label, to? }[]`, with an optional `windowTitle` override.
The host calls this React hook in each pane's plugin scope with its own
`subPath`. Content appears after the panel icon/name. Breadcrumb links must
be absolute app routes starting with a single slash. The focused pane supplies
the window title, defaulting to the leaf/title combined with the panel name.
Null restores defaults. A title hook failure clears the title without crashing
the body; navigation and plugin reload retry it. The host isolates hook
lifecycles by pane, route and plugin generation.

Core Tools, Skills and Plugins use the same hook host and title provider;
Automations registers its own hook and shares its detail query with the body.
The Plugin Guide full-page panels card owns the API documentation.
`renderSlot` evaluates the registered hook in its slot scope and exposes its
current result as `RenderedSlotInspectionState.experimental_pageTitle`;
audit test-host lifecycle parity before stabilization.
Before stabilization, audit focus changes, same-plugin splits, loading,
back/forward navigation, crash/reload recovery, links and overflow.

## Plugin watched reads

The GitHub PR Status plugin's keyed `pullRequests` read is the first producer: it shares a timer per PR and rechecks watched pending checks, auto-merge, queue and unknown mergeability about every 30 seconds. Upstream OID changes trigger a push refresh; turns recheck branches with no PR or known PRs when the turn ran gh. Status and branch changes still refresh. It invalidates the row's key tag only when the row changed, replacing core's `environment-pull-request` watched target.

The Tasks plugin's plain `listTaskPullRequests` read is the second: while a watched task's last read included an open or draft pull request, it invalidates that task's pull-request tag every 60 seconds, the cadence of the client poll it replaced.

The Git plugin and the Docs plugin are producers too. Git watches an environment's workspace while any of its `status`, `files`, `patches`, `branches` or `viewed` reads is watched (`plugins/git/server.ts`). Docs retains a vault watch while its `listNotes` or `readDocument` read is watched (`plugins/docs/server.ts`).

`bb.rpc.experimental_whileWatched(method, handler)` starts one producer for each distinct subscribed `{input}` or `{key}` read, and aborts it when its last client leaves or the plugin unloads. An app tab hidden for five seconds stops counting as a client until it is visible again. Register after the RPC method. Read identity uses canonical JSON and the encoded read is capped at 16 KiB. The server drops an oversized target from a subscribe message and keeps the rest, and the app doesn't send one. Every live app query hook holds a `plugin-read` subscription for its read, whether or not the method has a producer. Producers start and stop through the hub's watched-target registry, the path core uses for daemon git and thread-storage watching, thread timeline pushes and environment pull request checks.

Stabilize after exercising producer cancellation, reload, reconnect and byte limits across additional consumers. In the app, core and plugin surfaces subscribe through the same `WebSocketManager` (`apps/app/src/lib/ws.ts`). The SDK has no watched-read API yet.

## Retired `app.slots.experimental_threadHeaderAction` slot

`app.slots.experimental_threadHeaderAction` and its
`PluginThreadHeaderActionRegistration` and `PluginThreadHeaderActionProps`
types are gone from `@get-bb/plugin-sdk/app`, the Plugin Guide and the
authoring docs. Its replacement is a thread action with
`placement: "header"` (see the `experimental_threadAction` entry), the path
the Git plugin's Commit button uses. The collector keeps the method as a
legacy slot alias (`legacySlotAliases` in
`packages/plugin-sdk/src/internal/plugin-app-registration-collector.ts`,
typed by the internal `LegacyThreadHeaderActionRegistration`), so existing
plugins, including ones that check `typeof app.slots.experimental_threadHeaderAction === "function"`
first, still register, and `PluginThreadHeaderActions` still renders them in
the header row before the workspace button, once per pane with
`{ threadId, projectId, isCompactViewport }`, as before. `bb-plugin-build`
warns on any `.experimental_threadHeaderAction` reference with the
replacement call: `bb plugin build` and `bb plugin dev` print it, and the
server writes it to the plugin's log when it builds the plugin. Callers are
marketplace plugins written against the old SDK: 105 plugins in the
October 2026 marketplace scan (account-pool-balanced, advisor, agent-graph, agent-reload, agent-roles, app-preview, asciimoji, auto-compact, autoresearch, backlog, bookmarks, bots-sidebar, branch-pr, browser-copy, burn, calm, chief, claude-account-switcher, claude-design, claude-switcher, code-review, copilot-aic-usage, crew, delegation, desktop, diff-explorer, diff-review, diff-tree, dockside, ds4, fast-archive, file-explorer, file-gateway, file-tree, finder, firstmate, floating-notes, follow-thinking, followups, game-studio, genui, git-history, gitbutler, gtd-sidebar, hands-free, harness, herald, hmm-floating-terminal, ios-simulator, jb-flow, kata, kitchen-sink, linear, loom, model-connections, new-issue, office-viewer, omp-subagents, oxi-projects, pi-services, plan-tab, plannotator, pokecut-theme, pokemon-catcher, presentations, productive, project-colors, project-files, project-folders, recap, references, retitle, rewind, run-commands, saved-prompts, session-log, sessions-switcher, sidebar, sidebar-focus, slack, stelow, subscriptions, superhuman, t3sidebar, tab-manager, tabs, taskboard, tasks-plus, thread-briefs, thread-inbox, thread-namer, thread-overview, timer, tokenomics, treelanes, triage, ultragoal, vantage, vcs-widget, video-markup, visual-workflows, whiteboard, wikilinks, workbench-explorer, xlsx-preview). The November 2026
scan of 503 community repositories still finds it in about 82 of them (some
hold several plugins; ahmedhesham6/bb-plugin-treelanes,
amrtawfik160/bb-plugin-firstmate, architawr/bb-plugin-workbench-explorer among
them). Remove the alias, the slot store entry and `PluginThreadHeaderActions`
only after those plugins have migrated.

## Retired RPC contract `invalidates`

`invalidates(input, output)` on `defineRpcContract` methods is gone from
`PluginRpcMethodContract` in `@get-bb/plugin-sdk`, the Plugin Guide and the
authoring docs. It fired only when a write went through that RPC method, so a
plugin whose CLI commands, agent tools or background work change the same
data also had to call `bb.rpc.experimental_invalidate` there, and an app-made
write then refreshed twice. The replacement is that one call, made in the
server code that changes the data. The first-party callers already did: the
Git plugin's `markViewed` and `clearViewed` invalidate its `viewed` tag when
they write, `setMergeBase` refreshes through core's `metadata-changed`
environment event, the
GitHub PR Status plugin's `refresh`, `markReady`, `markDraft` and `merge`
through its pull request store's `publish` when the row changes, and the push
notification plugin's `threadNotifications.set` through `publishSubtree`, and
the Workflows plugin's `workflowStopRun` through `service.stop`, which
`bb workflows stop` shares; their declarations are deleted. The runtime still reads the field:
`readRpcMethodContract` in `packages/plugin-sdk/src/internal/host-policy.ts`
keeps it in the method's declarations, `invokeRpcHandler` broadcasts the tags
after a successful call, and `rpcResponseTags` returns them as `invalidated`
so the calling client refreshes them, as before. `bb-plugin-build` warns when
a server source file inside the plugin's own directory declares
`invalidates` (`retiredRpcInvalidatesWarnings` in
`packages/plugin-build/src/retired-sdk-members.ts`), with the replacement
call: `bb plugin build` and `bb plugin dev` print it, and the server writes it
to the plugin's log when it builds the plugin. Core HTTP routes declare no
tags. Callers are marketplace plugins written
against the old SDK. The November 2026 scan of 503 community repositories
finds four that still declare it: kalindudc/bb-marketplace's loom
(`src/rpc-tags.ts`) and forage (`src/contract.ts`), and
neoromantic/bb-plugin-responsibilities and
neoromantic/bb-plugin-subthread-columns (`contract.ts`). Shuttle, vantage,
gtd-sidebar and kitchen-sink, named by the October scan, have migrated.
Remove the runtime path and the field from `ContractTagDeclarations`
consumers in the plugin SDK only after those plugins have migrated.

## Retired composer menu-row `run` member `view`

`plusMenu` and `sendMenu` rows' `run` context carries `view: ComposerView`
besides `ExperimentalComposerActionContext`, for plugins built when `run` got
`{ composer, view }`. It is declared only on the host
(`RetiredComposerMenuRunMembers` in
`apps/app/src/components/plugin/PluginComposerActions.tsx`) and is not in
`@get-bb/plugin-sdk/app`'s types; `composer.scope`, `composer.isEmpty`,
`composer.attachmentCount`, `composer.isRunning` and `composer.isSubmitting`
replace its fields. Callers
in the November 2026 community scan: patleeman/bb-plugins'
agent-checklists (`view.scope`), suiramdev/bb-plugin-rephrase and
MacHatter1/bb-plugin-orchestrator-mode. Remove the member after they migrate
to `composer`.

## Retired composer renderer `view` and `key` runtime members

`ExperimentalComposerRendererApi.view`, `.key` and the `ExperimentalComposerView` type are gone from `@get-bb/plugin-sdk/app`, the Plugin Guide and the authoring docs: inside a composer box `useComposer().scope` and `.key` are bound to the box's host and carry the same values, and the bundled composer reads them there. `ComposerBox` still puts `view` and `key` on the renderer object (`RetiredComposerRendererMembers`), and `composer-contract.test.tsx` checks that they match `useComposer()` on every surface. The removal gate is met: the named caller, smsunarto/bb-plugins' t3-composer fork, no longer reads `renderer.key` or `renderer.view`, and the November 2026 scan of 503 community repositories finds no other reader. The runtime members can go.

## Retired `experimental_useSidebarThreadPullRequest` runtime member

`experimental_useSidebarThreadPullRequest(threadId)` and its `PluginSidebarPullRequest` and `PluginSidebarThreadPullRequestState` types are gone from `@get-bb/plugin-sdk/app`, the Plugin Guide and the authoring docs. Published bundles resolve `@get-bb/plugin-sdk/app` exports by name on `globalThis.__bbPluginRuntime.pluginSdkApp`, so the app installs `retiredPluginSdkAppMembers` (`apps/app/src/lib/plugin-sdk-app-impl.tsx`) next to the implementation. The member keeps its old shape, reads the GitHub PR Status plugin's `pullRequests` row for the thread's environment through `useRetiredSidebarEnvironmentPullRequest` (`apps/app/src/lib/retired-sidebar-pull-request.ts`), main's hook kept for it: a cached row refetches on mount and on page show, and the plugin's server decides whether that needs GitHub. It returns `{ isLoading: false, pullRequest: null }` when the plugin is disabled or the read fails. The GitHub PR Status plugin's own segment and Info row use the plugin's copy of that hook. Both copies use `useRefetchOnShowAndFocus` (`plugins/github-pr-status/ui/refetch-on-show.ts`), which refetches a row once when its first view mounts. The name leaves only the typings. `bb-plugin-build` keeps it in the `@get-bb/plugin-sdk/app` runtime shim's export list (`RETIRED_PLUGIN_SDK_APP_EXPORTS` in `packages/plugin-build/src/build-plugin-app.ts`), so plugins that still import it build and run, because git-sourced marketplace plugins are built by bb at install and update and path and builtin plugins rebuild when the SDK version changes. An import of it is a build warning carrying the replacement call: `bb plugin build` and `bb plugin dev` print it, and the server writes it to the plugin's log and the server log when it builds the plugin. Callers are marketplace plugins written against the old SDK (t3sidebar, dockside, gtd-sidebar, thread-inbox, radar-sidebar, bb-sidebar, sidebar-plus, cursor-sidebar, switchboard, vantage, jb-flow, tinted-threads among them). Their migration path is `experimental_ThreadRowMetadata` in the row, which draws the GitHub PR Status badge as bb's sidebar does; the build warning names it. Remove the runtime member and the shim entry only after those plugins have migrated.

## Retired environment git reads (`bb.sdk.environments.status`, `diff`, `diffFiles`, `diffPatch`, `diffFile`, `diffBranches`, `experimental_diffViewed`, `experimental_markDiffViewed`, `experimental_clearDiffViewed`)

These nine `PluginBbSdk.environments` methods are gone from the public typings, the Plugin Guide and the authoring docs; the Git plugin's RPC contract (`bb--git`: `status`, `diff`, `files`, `patches`, `fileSide`, `branches`, `viewed`, `markViewed`, `clearViewed`) replaces them, and core's HTTP routes are deleted. Viewed marks live in the Git plugin's own database (`plugins/git/server/viewed.ts`), keyed by environment, target (`uncommitted`, `commit:<sha>`, `branch_committed:<branch>`, `all:<branch>`) and path. Migration `0151_hand_diff_viewed_files_to_git_plugin` copies core's `diff_viewed_files` rows into the plugin's KV entry `viewedMarksFromCore` and drops the table; the plugin moves them into its database on its next load and deletes the entry. Marks of environments that no longer exist are deleted when the plugin loads, replacing the old foreign-key cascade. Published and git-sourced plugins keep working: `packages/sdk/src/areas/retired-environment-reads.ts` adds runtime adapters with the old shapes that call `POST /api/v1/plugins/bb--git/rpc/<method>`, so they fail with the RPC error when the Git plugin is disabled. `bb-plugin-build` scans app and server bundles for calls to them (`packages/plugin-build/src/retired-sdk-members.ts`) and prints a warning with the replacement RPC call; `bb plugin build`, `bb plugin dev` and server-side builds at install and update log it, and never fail. Callers are marketplace plugins written against the old SDK (vantage, diff-tree, firstmate, diff-viewed among them; danielbachhuber/bb-plugins' diff-viewed also calls the three Viewed methods). Remove the adapters, and `viewedMarksFromCore` handling in the Git plugin, after those plugins migrate.

`PLUGIN_CLI_OUTPUT_MAX_BYTES` is 32 MiB (was 1 MiB) so `bb git diff` and
`bb git file` print what `bb environment diff` and `diff-file` printed: a diff
of up to 2 MiB with a 256 KiB file list, and file sides up to the 25 MB
text and 10 MB image limits of `host.read_file`. The running bb enforces its
own value, so plugins built against the old constant keep working.

## Retired environment pull request methods (`bb.sdk.environments.pullRequest`, `markPullRequestReady`, `markPullRequestDraft`, `mergePullRequest`)

#6125 moved pull requests into the bundled GitHub PR Status plugin (`bb--github-pr-status`) and deleted these four `PluginBbSdk.environments` methods with core's routes, so published plugins that still called them threw a TypeError from bb 0.47.0. They are gone from the public typings, the Plugin Guide and the authoring docs; the plugin's RPC contract (`pullRequests`, `markReady`, `markDraft`, `merge`) replaces them. Published and git-sourced plugins keep working: `packages/sdk/src/areas/retired-environment-pull-requests.ts` adds runtime adapters that call `POST /api/v1/plugins/bb--github-pr-status/rpc/<method>` and return the old shapes. `pullRequest` returns the environment's keyed row (`available` with `pullRequest`, `absent`, or `unavailable` with `message`; the plugin's row schema is the old `ThreadPullRequest`), and `unavailable` when the plugin returns no row. The actions return `{ ok: true, action: "pull_request_ready" | "pull_request_draft" | "pull_request_merge", message }`, plus `method` for merge. A plugin `not_found` refusal becomes 404 `environment_not_found` and a `conflict` refusal becomes 409 `pull_request_action_failed` with the plugin's reason. When the plugin is disabled they fail with the RPC error, as the Git read adapters do. Inside a server plugin, `bb.sdk.environments` builds these adapters, and the Git read adapters, on the plugin's caller-token `plugins.callRpc` (`wrapSdkForPlugin` in `apps/server/src/services/plugins/plugin-api.ts`, through `createRetiredEnvironmentMembers` from `@bb/sdk`). The GitHub PR Status plugin therefore treats a `pullRequest` call as a plugin read and waits for a row fresher than 10 seconds. Without the token it would be an app viewer read, answered from the saved row, which for a merged PR can still say open. `bb-plugin-build` warns on calls to them with the replacement RPC call (`packages/plugin-build/src/retired-sdk-members.ts`), the same scan and log paths as the Git reads, and never fails a build. Callers are marketplace plugins written against the old SDK (genui and linear among them). Remove the adapters after those plugins migrate.

## Panel controller (`experimental_useAppPanel`, `ExperimentalPanelController`, `ExperimentalOpenTabOptions`, `ExperimentalPluginActionContext.panel`)

- **Surface:** `experimental_useAppPanel(): ExperimentalPanelController` for components, and `panel: ExperimentalPanelController` on every callback context through `ExperimentalPluginActionContext`. Contexts still carry the retired name `experimental_panel` at runtime for plugins built against it, and the plugin build warns with the new name. `openTab(options)`, `toggleTab(options)` and `close()` each return host acceptance. `ExperimentalOpenTabOptions` is `{ tab: ExperimentalTabReference, target? }` for fixed tabs (session-only, validated by the tab's `experimental_target`) or `{ tab, params?, title? }` for action tabs (persisted; the same params focus the existing instance). The types reject `target` on action tabs and `params`/`title` on fixed tabs.
- **Behavior:** components get the controller of the surface they render in (thread view, plugin nav-panel page, New thread screen); commands and thread actions get the focused surface's; message actions get the thread view's; tab and New-thread actions get the surface that launched them. `toggleTab` closes the side panel when a fixed tab is selected with the panel open (target ignored) or the action instance with the same params is selected, and otherwise calls `openTab`. `close()` closes the side panel. Declines: no side panel, a tab not registered by this plugin for the surface or hidden, wrong availability, non-JSON or invalid target/params. On the New thread screen a `{ context: { kind: "thread" }, availability: "action" }` reference resolves against `experimental_newThreadPanelAction` with the same id.
- **Core callers:** `useAppPanelController` and `createAppPanelController` in `apps/app/src/lib/app-fixed-tab-navigation.tsx` are the one implementation; `ThreadDetailView`, `PluginPanelRightPanelHost` and `RootComposeView` build it from their destinations and route bb's own controls through it: the Git plugin's Mod+D command is `toggleTab` on its Diff tab through `ctx.panel`, `panel.toggle` and the header/page toggle close through `close()` (opening restores the last tab), Info, the fixed-tab strip and Diff file/commit opens use `openTab`, and the panel close/collapse buttons, `panel.close` and the window-close request use `close()`. Plugin calls map through `createPluginPanelController` in `apps/app/src/lib/plugin-panel-controller.ts`. Contract tests: `app-fixed-tab-navigation.test.ts` and the surface tests that run the shared table.
- **Retired members (2026-10-26):** removed from public typings, the Plugin Guide and the authoring docs; runtime shims call the controller and `bb plugin build` warns with the replacement call (`packages/plugin-build/src/retired-sdk-members.ts`).

  | Retired                                                                                                                                                                                                          | Replacement                                                                                                                         |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | `ctx.openPanel(options?)` on every launcher context                                                                                                                                                              | `ctx.panel.openTab({ tab: { id, context: { kind: "thread" }, availability: "action" }, params, title })`                            |
  | `useBbNavigate().openThreadPanel({ actionId, params?, title? })`                                                                                                                                                 | `experimental_useAppPanel().openTab({ tab: { id: actionId, context: { kind: "thread" }, availability: "action" }, params, title })` |
  | `experimental_useAppPanel().experimental_openTab({ surface, ...options })`                                                                                                                                       | `experimental_useAppPanel().openTab(options)`                                                                                       |
  | `experimental_useAppPanel().openFixedTab({ surface, tab: { panelId?, id }, target? })`                                                                                                                           | `experimental_useAppPanel().openTab({ tab: { id, context, availability: "fixed" }, target })`                                       |
  | testing `renderSlot` options `openThreadPanel`, `experimental_openTab`, `experimental_openFixedTab`; logs `experimental_tabOpenCalls`, `experimental_fixedTabOpenCalls` and the `openThreadPanel` `NavigateCall` | option `experimental_panel: Partial<ExperimentalPanelController>`; log `experimental_panelCalls`                                    |

  One behaviour narrows: an action tab's or New-thread action's own `ctx.openPanel()` now resolves through the launching surface's registered tabs instead of opening its action directly, so it declines if the action was hidden or unregistered while `run` awaited. The other retired members already resolved against registered tabs. Survey of the 342 bb-community source repositories (shallow clones, 2026-10-26, production sources): `openPanel(` 102 call sites in 47 repos, `openThreadPanel(` 111 in 55, `experimental_openTab(` 3 in 2, `openFixedTab(` 11 in 8. Three repos self-open after an `await` in `run` (bb-plugin-crew, bb-wterm-terminal-plugin, bb-plugin-feed), all through the legacy `threadPanelAction`, which has no `useVisible`; the one tab with `useVisible` (shuttle) self-opens synchronously from its visible launcher. No caller relies on opening an unregistered or hidden action. In-repo callers (side-chat, tasks, workflows, docs, the `examples/plugins/thread-chat-demo` example) moved to the controller.

- **Stabilization:** audit focus resolution for commands and thread actions across split panes and plugin pages, `toggleTab` against compact drawers and plugin-detail overlays, `close()` acceptance when the panel is already closed, and whether a nav-panel action reference should resolve on thread surfaces. Remove the retired shims after published callers migrate, then rename project-wide and remove this entry.

## Open panel tabs (`experimental_usePanelTabs`, `ExperimentalPanelController.getTabs`/`selectTab`/`closeTab`, `experimental_PanelTabIcon`)

- **Surface:** `experimental_usePanelTabs(): ExperimentalPanelTabs` returns `{ open, selectedKey, tabs }` for the side panel of the surface the component renders in, following live changes. Each `ExperimentalPanelTab` is `{ key, title, status, closable, detail }`; `ExperimentalPanelTabDetail` is `info`, `file` (`path`), `browser` (`url`), `terminal` (`terminalId`), `new-tab`, `plugin` (`pluginId`, the tab's `ExperimentalTabReference`, action `params`) or `plugin-details` (`pluginId`). `ExperimentalPanelController.getTabs()` returns the same list once, for commands, thread actions and other non-component callers (from the focused surface for commands). `selectTab(key)` and `closeTab(key)` act on any listed tab and return false for a key that is not open (and `closeTab` for a tab without a close button). `experimental_PanelTabIcon({ tabKey })` draws the strip's icon for a key. The testing harness takes `experimental_panelTabs` and logs `selectTab`/`closeTab` in `experimental_panelCalls`; `@get-bb/plugin-sdk/testing` exports `experimental_makePanelController(overrides?)`, a controller that declines every call except the overrides, for tests that run a command or action directly.
- **Behavior:** the list is the tab strip's, in its order: fixed tabs (Info, plugin fixed and page tabs), then content tabs. `title`, `status` and `closable` are what the strip shows; `selectTab` and `closeTab` call the strip's own `onSelect`/`onClose`, so closing a terminal ends it and selecting reveals the panel (the compact drawer on phones). Plugin components re-render only when the listed data changes. Keys are the core tab ids and are documented as valid only while the tab is open. A surface without a side panel reports a closed, empty list.
- **Core callers:** every surface builds its strip from `usePanelTabPresenter` (`apps/app/src/components/secondary-panel/usePanelTabPresenter.tsx`) and renders `AppPanelTabsPublisher` (`apps/app/src/lib/app-panel-tabs.tsx`) with the same tab objects it hands `ThreadSecondaryPanel`: `ThreadDetailView`, `RootComposeView`, `PluginPanelRightPanelHost`, and the Plugins browse page (`PluginsView`, which now has its own panel controller). The publisher writes into the surface's `useAppPanelController` store in `apps/app/src/lib/app-fixed-tab-navigation.tsx`; the plugin hook, `selectTab`, `closeTab` and the icon read that store. Contract tests: the panel controller contract in `apps/app/src/test/panel-controller-contract.tsx`, run against the thread view, New thread screen and plugin page, plus `app-panel-tabs.test.tsx`.
- **Stabilization:** audit whether every plugin should see other tabs' URLs and file paths; whether split panes need a per-pane list or `selectedKey` per pane (today it is the focused pane's tab); whether reorder, move between panes or pin should join `selectTab`/`closeTab`; and whether `detail` needs more (a file's source or line range, a terminal's target). Then rename project-wide and remove this entry.

## Unified tabs (`experimental_tab`)

- **Surface:** `app.slots.experimental_tab`, `ExperimentalTabRegistration`, `ExperimentalTabContext`, `ExperimentalTabReference`, `ExperimentalTabTargetReference`, `ExperimentalThreadActionTabProps`, `ExperimentalThreadTabActionContext`, and `ExperimentalPanelController`. Context is thread (`threadId`, plus `environment: { id } | null` taken straight from the thread, null only without one; `ExperimentalThreadTabProps`) or an owned navigation panel (`panelId`, component `subPath`). Thread tabs read anything else about the environment themselves and own its loading and failure; the Git plugin's Diff tab does both through its `bb--git` status read. Availability is fixed or action. Only actions accept `run`, default `params` and per-open persisted params/title; fixed tabs retain validated session targets. `tooltip` defaults to title and layout is padded or flush.
- **Behavior:** one registry and destination dispatcher serve thread fixed, thread action, navigation-page fixed and navigation-page action tabs. `useVisible` runs inside plugin scope/crash isolation for the current context. It hides a destination or launcher without removing saved fixed identity/order or already-open action instances. Action params deduplicate instances; fixed tabs have one identity and cannot close. Every opener goes through the surface's panel controller (see Panel controller), including the retired `openFixedTab`, `experimental_openTab`, action `openPanel` and `openThreadPanel`. New-thread-screen actions retain their project-context API and use the same action-opening implementation.
- **Compatibility:** `threadPanelAction`, `PluginThreadPanelActionRegistration`, `PluginThreadPanelProps`, `PluginThreadPanelActionContext`, `navPanel.fixedTabs`, `PluginFixedTabRegistration` and `PluginFixedTabDeclaration` are removed from public source typings by explicit product decision. Runtime adapters in the registration collector remain for published bundles and Git-source install/update builds: 92 marketplace repositories use `threadPanelAction`, 15 use `fixedTabs`. Legacy optional icons, unknown fields and older fixed-tab owner shapes are accepted; malformed entries warn/skip rather than crashing the plugin. `bb-plugin-build` emits migration warnings with replacement examples and the authoring migration link. Server install/rebuild paths copy warnings into the plugin log; warnings never block install or update. The runtime export manifest continues to expose existing SDK functions. Remove adapters only after known callers have migrated.
- **Persistence and automation:** thread fixed entries use `{id, kind: 'plugin-fixed', pluginId, tabId}` through SDK `threads.tabs.get/update` and CLI `bb thread tabs show/set`, with revision checks. Existing `plugin-page-fixed` and `plugin-panel` action entries/params keep their IDs and storage keys. Selection is client-local. Legacy core Info/Diff kinds, active selections and split IDs convert without reordering; server entries rewrite through the revision-checked queue. Split restoration waits for registration/visibility readiness.
- **Core callers:** Info registers as thread + fixed (`apps/app/src/components/secondary-panel/thread-info-registration.tsx`) and uses the shared content host, visibility, descriptor and open paths; its metadata remains a pane-owned context, not public plugin API. Diff is the Git plugin's thread + fixed registration (`plugins/git/app.tsx`), which keeps its shortcut, file/commit navigation and review state. Docs, GitHub, Side Chat, Tasks, Workflows and the `examples/plugins/thread-chat-demo` example use the unified registration.
- **Stabilization:** audit context typing, targets versus persisted inputs, visibility and crash/reload lifecycles, independent panes/threads, startup split restoration, revision conflicts and compact drawers. Keep the shared contract table across contexts and legacy adapters, verify actual published plugin installs, then rename project-wide and remove this entry.

## Tab visibility (`experimental_useTabVisible`)

- **Surface:** `experimental_useTabVisible(): boolean` on `@get-bb/plugin-sdk/app`, for any panel tab (fixed or action, thread or navigation page).
- **Behavior:** true when the tab is the selected tab of its pane and the side panel is open; false while the panel is closed or suppressed, while another tab is selected, and outside a panel tab. bb keeps a closed panel's selected tab mounted, so a tab uses this to pause reads that only feed what it draws. The test harness's `renderSlot` answers `tabVisible` (default true).
- **Core callers:** `ThreadSecondaryPanel` provides the value (`TabVisibleContext` in `apps/app/src/components/secondary-panel/tab-visibility.ts`) around every pane's tab content, the one host for thread views, plugin pages and the New thread screen; `experimental_useTabVisible` reads that context. The Git plugin's Diff tab pauses its file list, patch and Viewed reads with it, as core's Diff did on `isDiffPanelLive`. Tests: `ThreadSecondaryPanel.tabVisible.test.tsx` and the panel-controller contract table case "reports the shown tab visible only while the side panel is open".
- **Other callers:** about 8 community plugins (ahsan7162/bb-plugin-dashboards, AndrewBird81/bb-plugin-code-review-workspace, gpambrozio/bb-plugins among them).
- **Stabilization:** behaviour in split panes and the compact drawer, and whether a not-yet-realized drawer should report false. Then rename project-wide and remove this entry.

## Thread context segments (`app.slots.experimental_threadContextSegment` / `experimental_THREAD_CONTEXT_SEGMENT_GROUPS`)

- **Surface:** `PluginAppSlots.experimental_threadContextSegment`, `PluginSdkApp.experimental_THREAD_CONTEXT_SEGMENT_GROUPS`, `ExperimentalThreadContextSegmentRegistration`, `ExperimentalThreadContextSegmentProps` (including `toggleRef` and `collapseRef`, SDK 0.6.190), `ExperimentalThreadContextSegmentInput`, `ExperimentalThreadContextSegmentReference` and `ExperimentalThreadEnvironment` (also used by `ExperimentalThreadInfoProps.environment`).
- **Behavior:** a registration is `{ id, title, group, order?, summary, action?, details?, useVisible? }`. Segments share the context row above an existing thread's composer, and the host mounts each component in its own crash boundary: `summary` in the row (wrapped in a group named by `title`), `action` at the row's end after every summary, and `details` below the row. Segments sort like Info rows and thread actions: by `group` (string compare), then `order` within it (unset last), then registration order, core first on a tie. bb's groups are `experimental_THREAD_CONTEXT_SEGMENT_GROUPS`: `thread` (`1_thread`: core's parent thread) and `git` (`3_git`: the Git plugin's changed files). Any other plugin names its own group, placed where its string sorts. Each entry of `segments` is `{ key, pluginId }` with `key` `<pluginId>/<id>`, the key shape thread actions use; core's segments use `bb--core`. `useVisible(input)` runs in plugin scope per thread; false, or a crash, leaves the segment out of the row and of `segments`. Props carry `threadId`, `projectId`, `environment`, the visible `segments` in row order, and the shared disclosure state: one segment of the row is expanded at a time, keyed by `key`. The host owns focus for that disclosure: `toggleRef` and `collapseRef` are callback refs a segment attaches to its expand control and to the collapse control in `details`. When `onToggle` runs while focus is on one of them, the host focuses the other after the commit that changed `isExpanded` (the collapse control on expand, the toggle on collapse). Focus elsewhere, such as in the composer or in another segment, is left where it is, and a segment that attaches neither ref keeps the browser's behavior. `environment` is `{ id }`, or null when the thread has no environment, its host is not active, or the environment is not a usable checkout. The row is withheld while core's workspace status loads and while a question is pending, and read-only history (archived thread or gone environment) shows core's parent thread only. The banner renders under every composer plugin, because the host draws it above `ComposerBox`.
- **Core callers:** `ThreadPromptContextBanner` (`apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx`) registers only the parent thread (summary and details, including read-only history) through `definePluginApp` and the same collector, and renders it with plugin registrations through `useThreadContextSegments` and `ThreadContextSegmentMount` (`apps/app/src/components/plugin/PluginThreadContextSegments.tsx`). The parent thread reads its data through `useParentThreadSection`, which calls `useThreadState`, the implementation of `experimental_useThread`, and renders without a plugin crash boundary, as core Info rows do. Both banners hand focus through `useThreadContextSegmentDisclosure` (`PluginThreadContextSegments.tsx`), which supplies `isExpanded`, `onToggle`, `toggleRef` and `collapseRef` to core and plugin segments alike; core's parent thread and the Git plugin's changed files attach both refs and have no focus code of their own. The Git plugin registers the changed files segment (summary, merge-base action, details) in the `git` group (`plugins/git/app.tsx`). The GitHub PR Status plugin registers the pull request segment in its own group `2_pullRequest`, between the parent thread and changed files, with its Mark ready and merge actions. Active child threads are a separate core row above the context row (`ThreadChildThreadsBanner`), not a segment. Contract tests: `ThreadPromptContextBanner.segments.test.tsx`, including one focus-handoff case table run against core's parent thread (writable and read-only), the Git segment and a plugin segment.
- **Stabilization:** audit per-component mounts and crash recovery across reloads and plugin disable, `segments` stability while visibility settles, focus handoff when the collapse control renders after an asynchronous load, independent panes, and compact widths with several plugin segments. Then rename project-wide and remove this entry.

## Collapsible stack card (`experimental_CollapsibleStackCard`)

- **Surface:** `PluginSdkApp.experimental_CollapsibleStackCard`, `ExperimentalCollapsibleStackCardProps` and `ExperimentalCollapsibleStackCardDismiss`.
- **Behavior:** bb's collapsible card for the stack above a thread's composer. Props are `{ label, title, icon, isActive, dismiss?, children }`. The card and its toggle are named by `label`; the header shows `icon` and `title`, in bb's working style when `isActive` and muted otherwise, and toggles `children`. The card starts collapsed and keeps its expansion while mounted. `dismiss` is `{ label, failureMessage, onDismiss }`: a header button named by `label` that bb disables, with a spinner, until `onDismiss()` settles, and on rejection bb shows its mutation error toast with `failureMessage` as the fallback. A plugin renders it from a thread-scoped composer banner with `chrome: "bare"`, which places it with the other plugin banners above bb's own stacked cards.
- **Core callers:** bb's Plan mode card (`apps/app/src/components/promptbox/banner/ThreadPromptModeCard.tsx`) renders through the same `CollapsibleStackCard` (`apps/app/src/components/promptbox/banner/CollapsibleStackCard.tsx`). The Codex provider plugin's Goal banner renders it. Tests: `ThreadPromptModeCard.test.tsx` (expansion, pending dismiss, failure toast) and the Codex plugin's `goal-card.test.tsx`.
- **Stabilization:** decide whether bb's workflow, background command and todo cards should use it too, whether banners need a placement among bb's cards, and whether `dismiss` should support a confirmation. Then rename project-wide and remove this entry.

## Thread extension state (`experimental_useThreadExtensionState`)

- **Surface:** `PluginSdkApp.experimental_useThreadExtensionState(threadId, kind)` and the timeline response's `extensionStates` window field (`@bb/server-contract`).
- **Behavior:** returns the latest `extension.state` payload the calling plugin's provider bridge emitted for its declared kind `kind` (the local name; the host prefixes the calling plugin's id, so a plugin reads only its own kinds), or null when there is none or the last payload was null. The server fills `extensionStates` on the latest timeline page with the latest state of each kind the thread's provider declares with a `state` schema, keyed by the namespaced kind; older pages carry `{}`. Payloads are JSON that already passed the kind's schema, typed `unknown` for the caller to parse. The hook reads the thread's cached timeline query without refetching on mount, so it follows the timeline's live updates while bb shows the thread and is not a general-purpose read for threads bb is not showing.
- **Core callers:** none. bb's own state kinds (provider commands, session options, todos) keep their typed timeline fields; the Codex Goal banner is the first caller.
- **Stabilization:** decide whether the hook needs a batched form for thread lists, and whether kinds declared by another installed provider should be readable. Then rename project-wide and remove this entry.

## Retired Goal activity (`PluginSidebarThreadActivity.goals`, the `goal` sidebar indicator)

bb no longer tracks provider Goals in core: the Codex plugin draws its own Goal card, and the sidebar no longer shows a Goal glyph, so a Goal thread shows bb's ordinary working indicator. `ThreadActivityState.activeGoalCount` is gone from the thread list API, with no runtime shim, so it is silently undefined in about 14 community plugins that still read it (ahkohd/bb-plugin-beside, ahmedhesham6/bb-plugin-treelanes, AndrewBird81/bb-plugin-code-review-workspace among them). `goals` is gone from the `PluginSidebarThreadActivity` typings, but the host still sends `goals: 0` in every thread's `activity` at runtime (`apps/app/src/lib/plugin-sidebar-threads.ts`), so already-built plugins that read it keep running; `"goal"` is gone from `PluginSidebarThreadIndicator` and is never reported. A provider plugin reads its own Goal state with `experimental_useThreadExtensionState`. Stop sending `goals` at the next major.

## Provider skills index

`@get-bb/plugin-sdk/provider-bridge` exports `experimental_scanSkillFiles`,
`experimental_selectedSkillMentions`, `ExperimentalSkillScanRoot`, and
`ExperimentalIndexedSkillFile`. The scanner resolves canonical filesystem paths,
follows user links, bounds project links, enforces traversal limits, and returns
each `SKILL.md` with its bytes and SHA-256 digest. Selected mentions are
validated against their exact text ranges before provider translation.

The implementation lives in `@bb/skill-index`. Core daemon command/skill discovery,
workspace context reads, server/plugin catalogs, listing identity, and staging use
that same implementation. The SDK exports are direct re-exports; frontmatter
parsing stays in core (`@bb/skill-index/metadata`). Provider callers are Claude
Code (native catalog overlap and selected mentions), Codex (selected mentions and
structured inputs), and Pi (selected mentions).

Before stabilization, audit Windows/junction behavior, filesystem mutation during
scans, provider-native precedence, traversal-limit reporting, and duplicate aliases
through read/write/delete. Exercise packaged provider forks and compare live
provider catalogs. Then rename project-wide and remove this entry.

## `PluginProviderOptionDescriptor.experimental_icon`

An optional icon on a declared service tier: a host glyph name, drawn filled
like the default `Zap`, or a declared icon `"<pluginId>/<name>"` from the
plugin's `bb.branding.experimental_icons`. The model picker trigger and the
single-tier toggle row show it when that tier is selected; Codex declares
`"provider-codex/ultrafast"`, a double bolt shipped in its own `icons/`.
Plugin-relative paths are rejected, and a declared icon must be one of the
registering plugin's, checked with the provider icon at
`bb.providers.register`. The server projects it onto
`ProviderInfo.serviceTiers[].icon`; reasoning levels ignore it.

Docs: `providers.md`.

Before stabilization, decide whether `model/list` `supportedServiceTiers` may
override the icon and whether reasoning levels should render it.

## Host process toolchain (`@get-bb/plugin-sdk/process`)

`experimental_hostToolchain` supplies `resolve`, `command`, `environment`,
`node`, `npmCli`, `bundledNpmCli`, an asynchronous `refresh`, and
`invalidateFailure`. `command` runs what PATH resolves, `npm` included; a
caller's PATH entries come first, followed by the login-shell PATH and the
standard tool directories.
`npmCli` returns a `{ node, cli }` pair: the running Node's own npm, else the
PATH npm with the Node that owns it, else the bundled npm; self-update uses it.
`bundledNpmCli` throws where the `npm`
package cannot be resolved next to the calling bundle. `experimental_spawnHostProcess`,
`experimental_forkHostProcess`, `experimental_execHostFile`, and
`experimental_execHostFileCallback` use it to launch processes and never wait for
discovery. Missing executables and exit 127 start a background refresh; running
commands are never replayed automatically. When a launch's leading Node
options (or a fork's `execArgv`, which defaults to the parent's) carry
`--use-env-proxy`, `command` and `experimental_forkHostProcess` drop the flag if
the child's `HTTP_PROXY`/`HTTPS_PROXY` (either case) is not an `http:`/`https:`
URL, drop network flags opted out with `NODE_USE_ENV_PROXY=0` or
`NODE_USE_SYSTEM_CA=0`, and otherwise append loopback hosts to the child's
`NO_PROXY`. These are host-local primitives, not remote-machine RPCs.

Core callers use the same process-utils implementation: server and desktop
launchers, daemon provider installation and terminals, provider workers,
plugin workers, watcher workers, self-update, and server move. The MCP,
automations, browser automation, and provider plugins use this SDK path.
The Plugin Guide's Provider bridges card lists the symbols.

Before stabilization, verify native Windows shims and registry refresh,
macOS launchd and Electron updates, mise/asdf installations, caller environment
precedence, bounded discovery failure, and module-ABI preservation after Node
replacement. Settle the shared process-local instance lifecycle across SDK
bundle versions and whether `bundledNpmCli` belongs on the public surface before
removing the prefix.

## `PluginSidebarThread.experimental_statusChangedAt` (`@get-bb/plugin-sdk/app`)

The sidebar DTO exposes the existing durable status-transition timestamp in
milliseconds since the epoch (creation time for new threads, 0 for legacy rows).
Reading, renaming, or reparenting a thread does not advance it. Successful child
completion advances it without changing unread attention. The server sends it
in list responses and realtime status metadata; the sidebar cache preserves it.

Core caller: the bundled Thread list plugin uses the maximum of this timestamp
and `latestAttentionAt` for inactive child rows in Updated at order. Top-level
rows retain attention ordering, active rows retain creation ordering, and pinned
roots retain their manual order. Other sort modes retain their existing behavior.

Before stabilizing, confirm that durable status transitions are the right
activity boundary for sidebar consumers, whether background activity should be
represented separately, and whether the legacy-zero sentinel should remain.
