// Bundler stub for `@bb/server-contract`'s api-client module.
//
// The real api-client.ts returns `hc<PublicApiRoutes>` clients. Inside the
// TypeScript program that rollup-plugin-dts builds, that module still resolves
// the real route table (public-api-stub.d.ts only swaps rollup's module graph,
// not TypeScript's), so TypeScript expands every client method into a ~540 KB
// declaration that drags ./thread-timeline.js, ./api-types.js, ./common.js,
// @bb/domain and @bb/hono-typed-routes into the bundle graph and perturbs
// declaration order in bb-plugin-sdk.d.ts. None of the client types appear on
// the plugin API surface — @bb/sdk only references `ApiClient` internally — so
// build-bundled-dts.mjs redirects api-client here to keep the bundle stable
// and cheap. These loose declarations satisfy every importer.
export type PublicApiFetch = (...args: unknown[]) => unknown;
export interface PublicApiClientOptions {
  [key: string]: unknown;
}
export declare function createPublicApiClient(...args: unknown[]): unknown;
export declare function createApiClient(...args: unknown[]): unknown;
export type ApiClient = unknown;
