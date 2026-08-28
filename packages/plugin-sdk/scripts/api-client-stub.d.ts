export type PublicApiFetch = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;
export interface PublicApiClientOptions {
  fetch: PublicApiFetch;
}
export interface PublicApiRoute {
  readonly $url: (...args: object[]) => string;
  readonly [key: string]: PublicApiRoute | PublicApiRouteMethod;
}
export type PublicApiRouteMethod = (
  ...args: object[]
) => PublicApiRoute | string;
export type PublicApiClient = Record<string, PublicApiRoute>;
export declare function createPublicApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
): PublicApiClient;
export declare function createApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
): { api: { v1: PublicApiClient } };
export type ApiClient = ReturnType<typeof createApiClient>;
