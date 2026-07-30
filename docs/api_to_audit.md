# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "Plugin API"). Dropping the prefix
is the deliberate stabilization step: audit the entry, rename project-wide,
and delete the entry in the same change.

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
