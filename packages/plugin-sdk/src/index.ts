/**
 * `@bb/plugin-sdk` — the typed facade plugin authors compile against.
 *
 * The root export carries the side-effect-free app contract (types + the
 * runtime export-name list used by `bb plugin build` and the BB app's
 * implementation sync test) plus the backend contract (`BbPluginApi`, the
 * `server.ts` factory argument — types only, implemented by the BB server).
 * The `./app` subpath adds the runtime bindings that `bb plugin build` shims
 * to the host's shared runtime.
 */
export * from "./app-contract.js";
export * from "./backend-contract.js";
