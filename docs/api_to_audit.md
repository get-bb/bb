# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "Plugin API"). Dropping the prefix
is the deliberate stabilization step: audit the entry, rename project-wide,
and delete the entry in the same change.

## `PluginContentScriptContext.experimental_setThreadRowStatus`

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and is
cleared automatically when that frontend generation deactivates.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration across plugins, frontend generations, and native thread
  statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal.

## `bb.agents.registerTool({ experimental_statusLabels })`

**What it does.** Lets a native plugin tool supply one short label while it is
pending and one after successful completion. BB snapshots the labels into the
tool-call event and renders them in its own timeline; a tool without the field
keeps the ordinary `Running tool …` / `Ran tool …` title. Approval, error, and
interruption states deliberately keep their standard titles so the raw tool
identity and failure state remain clear.

Each label is capped at 80 characters and rendered as a truncating segment.

**Audit before stabilizing.**

1. **Presentation scope.** Confirm two static labels cover enough real tool
   types, or introduce a deliberately bounded parameter interpolation API
   without letting plugin strings become arbitrary timeline markup.
2. **Lifecycle semantics.** Revisit whether failed or interrupted calls need
   a third explicit label, rather than reusing the generic fallback.
3. **Persistence and source identity.** Labels are snapshotted by the server
   only for non-MCP native plugin tools. Confirm that distinction stays sound
   as provider adapters and dynamic-tool provenance evolve.


## `experimental_NewThreadComposer` (`@bb/plugin-sdk/app`)

**What it does.** The host-owned new-thread compose surface, the create-side
counterpart to `ThreadChat`. It renders bb's full control set — prompt editor
with @-mentions and expand, `+` attachments, provider/model/reasoning picker,
voice, submit, and the row beneath with project, environment, "Branch from:",
and permission mode — and calls `onSubmit` with a `NewThreadRequest`
carrying every resolved selection.

The composer deliberately does **not** create the thread. The plugin does,
through `bb.sdk.threads.spawn`, which auto-fills `origin: "plugin"` and
`originPluginId`. If the component created the thread it would go through the
host's `useCreateThread` and the thread would look host-originated. So the
rule is: the composer owns user selections; the plugin owns filing
(`sectionId`, `parentThreadId`, `title`, `visibility`) and attribution.

Implementation: `apps/app/src/components/plugin/PluginNewThreadComposer.tsx`,
bound in `apps/app/src/lib/plugin-sdk-app-impl.tsx`.

**Audit before stabilizing.**

1. **Duplicated config assembly vs. `RootComposeView`.** The adapter builds
   `environmentConfig`, `branchConfig`, `worktreeConfig`, `permissionConfig`,
   `executionConfig`, `attachmentsConfig`, `typeaheadConfig`, `historyConfig`,
   and `projectOptions` for `NewThreadPromptBox` a second time — the first
   copy is the `useMemo` block in `apps/app/src/views/RootComposeView.tsx`.
   This was chosen over refactoring that ~3700-line view (additive, zero
   regression risk to the primary compose surface), mirroring how
   `PluginThreadChat` adapts `EmbeddedThreadChat`. Only the pure resolvers are
   shared (`apps/app/src/views/root-compose-environment-selection.ts`). Check
   whether the two copies have drifted, and whether the shared surface should
   grow to cover the config assembly itself before this is stable.

2. **`NewThreadRequest` vs. what `threads.spawn` accepts.** The type mirrors
   the subset of `CreateThreadRequest` a composer can resolve. Confirm every
   field still round-trips through `bb.sdk.threads.spawn` unchanged, that
   `executionInputSources` still means the same thing to the server, and that
   no newly required create-thread field is silently missing. Note the
   composer runs `useThreadCreationOptions` with `scope: "component-local"`,
   which never reports a `providerId` provenance source even though the
   composer always sends an explicit `providerId`; decide whether that is
   correct before freezing the shape.

3. **Page-level behavior the adapter skips.** Fork seeds,
   quick-create-project, the guided machine-setup dialog, welcome/empty
   states, and codex-version submit blocking are all deliberately absent.
   Confirm none of them has become load-bearing for correctness (rather than
   convenience) on a plugin surface — codex-version blocking in particular
   means a plugin can submit to a machine whose CLI the primary surface would
   have refused.

4. **Draft and selection scoping.** Drafts persist under a
   `plugin-new-thread` scope keyed by `draftKey ?? pluginId`, and execution
   selections are component-local so a plugin panel never rewrites the user's
   persisted root-composer defaults. Confirm that is still the behavior
   plugin authors expect, and that `draftKey` is the right knob (versus, say,
   a per-instance ephemeral draft).

5. **No plugin composer host binding.** The instance passes no
   `pluginComposerHost`, so plugin composer customizations, banners, and
   `useComposer()` writes do not reach it. Decide whether composers rendered
   by a plugin should participate in that surface before stabilizing.

6. **Seeding props and the round-trip guarantee.** The `default*` props
   (`defaultProviderId`, `defaultModel`, `defaultReasoningLevel`,
   `defaultServiceTier`, `defaultPermissionMode`, `defaultEnvironment`) seed
   the composer from a stored `NewThreadRequest` so a plugin can re-open a
   saved configuration without silently resetting it to project defaults.
   They are seeds (uncontrolled), take precedence over project defaults, and
   re-seed on any value change — including user-touched selections — via the
   creation-options resetKey. `defaultEnvironment` maps args back to picker
   selections in
   `apps/app/src/components/plugin/new-thread-environment-seed.ts`; its
   unrepresentable variants (`project-default`, `personal` without a
   `hostId`, an `unmanaged` `path`) are documented on the prop. Before
   stabilizing, confirm the mapping still inverts
   `resolveRootComposeThreadEnvironment` (the round-trip tests in
   `new-thread-environment-seed.test.ts` and
   `PluginNewThreadComposer.test.tsx` guard this) and re-decide whether the
   re-seed-on-change rule should instead be an explicit reset nonce.

## `app.slots.experimental_threadList` (`@bb/plugin-sdk/app`)

**What it does.** Replaces the sidebar's scrolling thread list with a plugin
component. Unlike every other `app.slots.*` member this slot is **exclusive**:
one list at a time fills the scroll area. The built-in list stays the default;
the user picks a provider in Settings → Appearance → Sidebar, stored per client
in `localStorage` under `bb.sidebar.threadListProvider`.

Three fallbacks keep the sidebar usable: a preference naming an unregistered
provider resolves to the built-in list without clearing the stored value; a
crashing component renders the built-in list (not the usual "plugin crashed"
chip, which in place of a whole sidebar would strand the user) plus one toast;
and a disabled or uninstalled plugin gets its list back when it returns.

**Audit before stabilizing.**

1. **Arbitration.** Confirm a client-local single choice is right, versus a
   per-project or per-workspace choice, and what a synced setting would mean
   across devices where the plugin is not installed.
2. **Fallback discoverability.** Confirm one toast is the right signal when a
   crash silently swaps the user's sidebar back, and whether the preference
   should self-clear after repeated crashes.
3. **Region boundary.** The plugin gets the scrolling list and nothing else:
   the New-thread button, search field, plugin nav rows, and footer stay
   host-rendered, because they are shared surfaces (other plugins live in two
   of them) and a replaced list must not remove them. Confirm no real sidebar
   needs to claim more, and that passing those regions down as props — letting
   a plugin place them, at the risk of dropping them — stays the wrong trade.
4. **Search ownership.** The host owns the search field and passes
   `searchQuery` down. Confirm a plugin list never needs its own field.
5. **Accessibility.** Confirm the host can still guarantee list semantics,
   focus order, and the mobile close behavior when a plugin owns the markup —
   `onNavigate` is currently the plugin's responsibility to call.
