# @get-bb/plugin-sdk

The typed facade BB plugin authors compile against. The root preserves the
complete `BbPluginApi` and `BbSdk` contract; `./app` is the frontend runtime
that `bb plugin build` replaces with BB's shared implementation.

The authoritative contracts are the exported declarations in
[`src/backend-contract.ts`](src/backend-contract.ts) and
[`src/app-contract.ts`](src/app-contract.ts). Keep author-facing guidance in
the built-in `bb-plugin-authoring` skill synchronized with those declarations.

## Composer customization

Composer UI extensions register through `app.composer.customize(...)`. A
`ComposerCustomization` can contribute React action and banner components,
host-rendered `ComposerPlusMenuItem` and `ComposerSendMenuItem` rows, and
`ComposerRichTextSpec` rules. Mounted components use `useComposer()`: one
stable handle for the composer's text, mentions, picker selection, scope,
layout, run and submit state, writes, effects, and input locking. Selection is
reactive and is `null` for composers without pickers. Panels and pages that
write into a composer the user picks use `useComposers()`, one handle per
composer on screen.
Any mounted plugin component can call `experimental_useAppPanel()` for the
side panel of the surface it renders in (a thread view, a plugin page, or the
New thread screen). `openTab({ tab, target?, params?, title? })` selects one of
the plugin's registered `experimental_tab` tabs; on the New thread screen a
thread-context action tab resolves against `experimental_newThreadPanelAction`
with the same id. `toggleTab(options)` closes the panel when that tab is
showing and otherwise opens it, and `close()` closes the panel. Commands,
thread actions, message actions and panel actions receive the same controller
as `experimental_panel`.

Use `UrlLink` for a real anchor that applies BB's current
in-app/external-browser preference on ordinary HTTP(S) activation, or
`useBbNavigate().openUrl(url)` for a button or menu. Internal app
routes, modifier clicks, explicit anchor targets, and unsupported schemes stay
browser-owned. A `_blank` or named target preserves supplied `rel` tokens but
adds `noopener noreferrer` unless `rel` explicitly contains `opener`, so a
newly opened page cannot control BB by accident. The frontend harness records
both forms in `navigateCalls` and accepts an `openUrl` behavior option.

Use `experimental_FileLink` for an explicit live workspace, host, or
thread-storage file. Ordinary activation opens the shared BB preview and its
context menu exposes built-in/plugin viewers, preferred external opening, and
copy actions. Valid targets expose an encoded, scheme-safe anchor href so
modifier clicks, downloads, and copied links cannot reinterpret a file name as
an external URL scheme. Malformed runtime targets—including traversal paths
and ill-formed Unicode—have no active href and cannot record a preview in the
frontend harness. Buttons and menus can call
`experimental_openFilePreview({ target, location })` or
`experimental_openFileExternally({ target, location })`; both return whether
the current host accepted the intent. The
`experimental_useCanOpenFileExternally(target)` hook reports whether the
external open can succeed now (false while loading) and re-renders the
component when that changes; use it to disable an Open externally control.
Targets never infer an ambient workspace.
The frontend harness records both methods and accepts `openFilePreview`,
`openFileExternally`, and `canOpenFileExternally` behavior options.

To show a terminal beside your UI, create it with `useSdk().terminals.create`
in the thread, environment, or host directory you want, then call
`useBbNavigate().experimental_openTerminal({ terminalId })`. It resolves
whether the current surface selected the terminal's tab; thread surfaces accept
only their own thread's terminals. The harness records the call and accepts an
`openTerminal` behavior option.

Give a fixed tab (thread or nav-panel) an `experimental_target.validate` type
guard, call `experimental_useAppPanel().openTab({ tab, target })`, and read the
in-memory state inside the tab with `experimental_useFixedTabTarget(tab)`. The target survives tab, panel, and
route remounts for the current app session; call `clear()` when the tab returns
to its untargeted state. The host validates JSON before the owner's type guard,
persists only selection, and returns false for an unavailable tab or invalid
target. The frontend harness records every controller call in
`experimental_panelCalls`, accepts an `experimental_panel` behavior, and can
seed `experimental_fixedTabTarget` state.

Every controller call reports the same way: `true` when the host accepted it,
`false` when it declined (non-JSON `target` or `params`, a tab the plugin did
not register for the surface, or a surface with no side panel). A decline is a return value, never
a thrown error, so a plugin registering several kinds of action can share one
open routine and branch on the result.

Use `app.slots.experimental_appOverlay({ id, component })` for additive,
app-wide floating React UI. BB mounts the component once per app window through
the normal plugin slot boundary, so SDK hooks and plugin CSS work and React
context survives portals. This app-level boundary includes the sidebar thread
data and action hooks. Hooks whose contract requires a particular surface,
including `useComposer`, remain limited to that surface.
The plugin owns the overlay's chrome, positioning, visibility, focus, and
responsive behavior; a crashing overlay is hidden without affecting siblings.
Use a content script for app-wide DOM behavior that does not need React context.

See the
[`composer-customization` reference plugin](../../examples/plugins/composer-customization/README.md)
for every region in one small app. The deprecated pre-1.0
`app.slots.composerAccessory(...)` footer API has been removed; migrate footer
controls to actions or the plus menu and larger content to banners.

## Trusted frontend content scripts

Use `app.contentScripts.register({ id, mount })` for ordinary
bundled TypeScript/JavaScript that enhances the bb app shell without rendering
a React slot. The host supplies `{ pluginId, generation, signal }`, awaits
mount setup, and owns abort plus exact-once reverse-order disposal across hash
reload, disable, removal, failed replacement, and app-window teardown. The old
generation is disposed before candidate mounts, so generations never overlap.
Content scripts are trusted same-origin page code, not a sandbox.

Static styles should stay in the normal imported `app.css`. The host keeps
that stylesheet active while the plugin has rendered slot, panel-header, or
portal UI, and for the full lifetime of any active content-script generation;
it is not an app-wide stylesheet hook. Use manifest `bb.themes` entries for
app-wide selectable palette CSS. Styling or decorating existing app-shell DOM
belongs in a content script, and scripts may own dynamic DOM/style nodes only
when their disposer removes them. See the
[`content-script` reference plugin](../../examples/plugins/content-script/README.md)
for a cleanup-safe editor enhancement.

## External plugin tests

The packed package includes executable JavaScript and portable declarations
for `@get-bb/plugin-sdk/testing` and `@get-bb/plugin-sdk/testing/app`; neither subpath
imports BB workspace packages or source TypeScript at runtime. Install the SDK
with the test stack used by your plugin (the peer dependencies are optional so
headless plugins do not install a browser harness):

```sh
npm install --save-dev @get-bb/plugin-sdk vitest better-sqlite3 cron-parser hono
npm install --save-dev react react-dom @testing-library/react jsdom # frontend tests
```

Backend example:

```ts
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const host = createFakePluginHost({ pluginId: "notes" });
await plugin(host.bb);

await host.harness.behavior.resolveAgentConfiguration(
  makePluginAgentConfigurationContext({
    provider: { id: "codex" },
  }),
);
await host.harness.behavior.callRpc("list", { query: "today" });
expect(host.harness.inspection.registrations.rpcMethods).toContain("list");
await host.harness.lifecycle.dispose();
```

`makePluginAgentConfigurationContext`, `makeMessageDispatchHookContext`,
`makeHostResponse`, `makeThreadResponse`, `makeQueueEntry`, and
`makeTurnFailedEvent` return
complete deterministic SDK objects. Pass partial overrides so a behavioral
test shows only the values relevant to its scenario. Nested context
members merge partial overrides against complete defaults, so required contract
additions remain localized to the shared fixtures.

`harness.behavior` contains deterministic host inputs (RPC/HTTP/CLI calls,
events, settings, tools, interactions, and schedules), `harness.inspection`
contains registrations and recorded state, and `harness.lifecycle` owns atomic
reload and disposal. Every pre-existing direct member remains as an alias for
source compatibility. A successful `reload(factory)` preserves settings, KV,
and database state and invalidates the old API only after the replacement
factory succeeds; a failed factory leaves the old load live.

Frontend example (`// @vitest-environment jsdom`):

```tsx
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));
const scripts = await mountPluginContentScripts(app, { pluginId: "notes" });
const slot = renderSlot(
  app.homepageSections[0]!,
  { projectId: "proj_1" },
  {
    rpc: { list: () => [] },
    context: { projectId: "proj_1", threadId: null },
  },
);

await slot.behavior.emitRealtime("notes-changed", null);
expect(slot.inspection.rpcCalls).toHaveLength(1);
slot.lifecycle.unmount();
await scripts.lifecycle.dispose();
```

`loadPluginApp` installs the runtime and validates all registrations; pass the
imported module or a thunk. `@get-bb/plugin-sdk/app` exports look the runtime
up when they are called or rendered, so a static import of `app.tsx` or of
components works too. `mountPluginContentScripts` mirrors the host's ordered mount,
rollback, independent per-window signal, and exact-once disposal. `renderSlot` supplies
RPC, realtime, settings, navigation, context, and scoped composer behavior,
then returns Testing Library queries plus the same behavior/inspection/lifecycle
split; it installs the runtime too. Call `installTestPluginRuntime()` yourself
only when a test renders plugin components without `renderSlot`.

## Fidelity boundaries

The backend fake matches observable schema-RPC validation/errors and strict
JSON results, additive events, keyed-registration failures, atomic reload,
settings, KV/database storage, conditional agent configuration, request input,
and disposal order. HTTP runs through Hono but does not enforce BB's local or
token authentication. Background services and schedules run only when driven;
there are no restart timers or cron sweeps. Storage is process-local in a
temporary directory, secrets are kept in memory, `bb.sdk` is always bound and
unstubbed calls throw, and cross-plugin/global collision policy is outside one
fake host.

The frontend harness matches registration validation, content-script mount and
cleanup ordering, RPC/realtime JSON
boundaries, panel and slot props, navigation recording, and composer text,
scope, quote, mention, focus, and clear behavior. It does not reproduce BB
layout, CSS, persistence, routing, host authentication, crash boundaries, or
multi-plugin arbitration; use a live BB test for those boundaries.

## Declaration surface

The complete root declaration flattens the unpublished BB workspace contracts.
The testing declarations reuse that public `@get-bb/plugin-sdk` root instead of
embedding a second copy, and no declaration depends on unpublished `@bb/*`
packages. Genuine npm types (`hono`, `better-sqlite3`, React, and Testing
Library) remain peer imports. Zod is a runtime dependency of the SDK, so
plugins only declare it when their own source imports it. Scaffolded plugins depend on this package —
`bb plugin new` pins it exactly in `devDependencies` — and read the root/app
declarations straight from `node_modules/@get-bb/plugin-sdk/bundled-types/`,
the same files the testing subpaths reuse. Plugins scaffolded before that
switch still vendor a copy of the root/app declarations in `types/` and map
`@get-bb/plugin-sdk` onto them through their `tsconfig.json`; `bb plugin
types` keeps those refreshed until they migrate.
