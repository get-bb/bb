// Bundler stub for `@bb/server-contract`'s api-client module.
//
// The real api-client.ts returns `hc<PublicApiRoutes>` clients typed against
// the route table that public-api-stub.d.ts already loosens to `unknown`.
// Bundling the real module would emit those client types against the stub
// and re-export the same names twice through the barrel. None of the client
// types appear on the plugin API surface — @bb/sdk only references
// `ApiClient` internally — so build-bundled-dts.mjs redirects api-client here.
// These loose declarations satisfy every importer.
export type PublicApiFetch = (...args: unknown[]) => unknown;
export interface PublicApiClientOptions {
  [key: string]: unknown;
}
export declare function createPublicApiClient(...args: unknown[]): unknown;
export declare function createApiClient(...args: unknown[]): unknown;
export type ApiClient = unknown;
