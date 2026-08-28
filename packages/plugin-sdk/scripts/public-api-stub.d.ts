export interface PublicApiRouteTree {
  readonly [key: string]: PublicApiRouteTree;
}
export declare const publicApiRoutes: PublicApiRouteTree;
export type PublicApiSchema = Record<string, never>;
export type PublicApiRoutes = Record<string, never>;
