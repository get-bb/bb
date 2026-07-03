# @bb/plugin-sdk

The typed facade BB plugin authors compile against. Types only at the root
(`BbPluginApi`, the app contract); the `./app` subpath is shimmed by
`bb plugin build` to the host's shared runtime.

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
