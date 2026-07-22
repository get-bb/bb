# @bb/plugin-sdk

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
host-rendered `ComposerPlusMenuItem` rows, and `ComposerRichTextSpec` rules.
Mounted components use `useComposer()` for writes, effects, and input locking,
and `useComposerView()` for the reactive scope, layout, draft, and run state.
Thread-scoped actions can call
`composer.experimental_openThreadPanel({ actionId, title?, params? })` to open
one of their plugin's registered `threadPanelAction` components. The method
returns `false` when that panel is unavailable.

See the
[`composer-customization` reference plugin](../../examples/plugins/composer-customization/README.md)
for every region in one small app. The deprecated pre-1.0
`app.slots.composerAccessory(...)` footer API has been removed; migrate footer
controls to actions or the plus menu and larger content to banners.

## External plugin tests

The packed package includes executable JavaScript and portable declarations
for `@bb/plugin-sdk/testing` and `@bb/plugin-sdk/testing/app`; neither subpath
imports BB workspace packages or source TypeScript at runtime. Install the SDK
with the test stack used by your plugin (the peer dependencies are optional so
headless plugins do not install a browser harness):

```sh
npm install --save-dev @bb/plugin-sdk vitest better-sqlite3 zod
npm install --save-dev react react-dom @testing-library/react jsdom # frontend tests
```

Backend example:

```ts
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import plugin from "./server.js";

const host = createFakePluginHost({ pluginId: "notes" });
await plugin(host.bb);

await host.harness.behavior.callRpc("list", { query: "today" });
expect(host.harness.inspection.registrations.rpcMethods).toContain("list");
await host.harness.lifecycle.dispose();
```

`harness.behavior` contains deterministic host inputs (RPC/HTTP/CLI calls,
events, settings, tools, interactions, and schedules), `harness.inspection`
contains registrations and recorded state, and `harness.lifecycle` owns atomic
reload and disposal. Every pre-existing direct member remains as an alias for
source compatibility. A successful `reload(factory)` preserves settings, KV,
and database state and invalidates the old API only after the replacement
factory succeeds; a failed factory leaves the old load live.

Frontend example (`// @vitest-environment jsdom`):

```tsx
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));
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
```

`loadPluginApp` installs the runtime before a thunk import, validates slot and
panel registrations, and returns captured registrations. `renderSlot` supplies
RPC, realtime, settings, navigation, context, and scoped composer behavior,
then returns Testing Library queries plus the same behavior/inspection/lifecycle
split. Use a setup-file `installTestPluginRuntime()` only when a static app
import is unavoidable.

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

The frontend harness matches registration validation, RPC/realtime JSON
boundaries, panel and slot props, navigation recording, and composer text,
scope, quote, mention, focus, clear, and thread-panel-open behavior. It does not
reproduce BB layout, CSS, persistence, routing, host authentication, crash
boundaries, or multi-plugin arbitration; use a live BB test for those
boundaries.

## Declaration surface

The complete root declaration flattens the unpublished BB workspace contracts.
The testing declarations reuse that public `@bb/plugin-sdk` root instead of
embedding a second copy, and no declaration depends on unpublished `@bb/*`
packages. Genuine npm types (`hono`, `better-sqlite3`, `zod`, React, and Testing
Library) remain peer imports. Scaffolded plugins still vendor the root/app
declarations in `types/`; installing this package is needed only when their
tests import the testing subpaths.
