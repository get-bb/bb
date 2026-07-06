# @bb/plugin-sdk

The typed facade BB plugin authors compile against. Types only at the root
(`BbPluginApi`, the app contract); the `./app` subpath is shimmed by
`bb plugin build` to the host's shared runtime.

## Testing

`./testing` is the official plugin test harness: `createFakePluginHost()`
returns a `bb` satisfying `BbPluginApi` (real better-sqlite3 `:memory:`
storage, host-faithful validation and error shapes, a recordable `bb.sdk`
stub) plus a `harness` that drives rpc/http/cli/services/schedules/settings/
thread events deterministically. `./testing/app` tests a plugin's `app.tsx`
without the bb host: `loadPluginApp()` captures typed slot registrations and
`renderSlot()` mounts a slot with mock hook backends (vitest + jsdom +
Testing Library). See the "Testing a plugin" section of the
bb-plugin-authoring skill for patterns, and
`examples/plugins/{slack-bot,notes}` for working tests.

Workspace/in-repo consumers only for V1: the testing subpaths are not part
of the bundled `.d.ts` that `bb plugin new` ships into scaffolded plugins
(`scripts/build-bundled-dts.mjs` bundles only the root and `./app`
contracts), so standalone plugins outside a checkout cannot use them yet.

## Dependency surface

The public types reference external type sources: `hono` (`Context` in http
route handlers), `better-sqlite3` + `@types/better-sqlite3` (`bb.storage`
database handles), `zod` (tool input schemas), and `react` + `@types/react`
(the app contract). They are declared as **optional peerDependencies**: a
plugin only needs the ones its surfaces touch (a backend-only plugin never
needs react; a frontend-only plugin never needs better-sqlite3). Install the
peers matching the surfaces you use, or your typecheck will fail resolving
those imports.

The `@bb/*` type dependencies (`@bb/domain`, `@bb/sdk`, `@bb/server-contract`)
are workspace-internal; this package is currently consumed from inside the BB
monorepo (plugins are typechecked against the workspace sources via jiti).
