// Bundler stub for `@bb/server-contract`'s public-api module.
//
// The real public-api.ts infers a large HTTP route table whose type can only
// be named through a nested copy of @bb/hono-typed-routes, which is not
// portable into a flattened .d.ts (TS2742). None of those route types appear
// on the plugin API surface — @bb/sdk only references `ApiClient` internally —
// so build-bundled-dts.mjs redirects public-api here to keep the bundle
// self-contained. These loose declarations satisfy every importer.
export declare const publicApiRoutes: Record<string, unknown>;
export type PublicApiSchema = unknown;
export type PublicApiRoutes = unknown;
export interface PublicApiClientOptions {
  [key: string]: unknown;
}
export declare function createPublicApiClient(...args: unknown[]): unknown;
export declare function createApiClient(...args: unknown[]): unknown;
export type ApiClient = unknown;
