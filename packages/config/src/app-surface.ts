export const APP_SURFACE_HEADER_NAME = "x-bb-app-surface";
export const APP_SURFACE_ENV_NAME = "BB_APP_SURFACE";

/**
 * Surfaces a bb server can be configured as (`BB_APP_SURFACE`): the packaged
 * desktop app or the plain web app.
 */
export const APP_SURFACE_VALUES = ["desktop", "web"] as const;
export type AppSurface = (typeof APP_SURFACE_VALUES)[number];

/**
 * Surfaces a client may declare on a request (`x-bb-app-surface`). Includes
 * the native mobile app and `api`, neither of which is a server-side surface.
 *
 * `api` is the surface of a request that declares no header: the bb CLI, the
 * SDK, automations, and agent-driven work. Those callers must not land in the
 * `desktop` or `web` buckets, because that makes headless traffic look like a
 * person at a user interface.
 */
const REQUEST_APP_SURFACE_VALUES = [
  ...APP_SURFACE_VALUES,
  "api",
  "mobile",
] as const;
export type RequestAppSurface = (typeof REQUEST_APP_SURFACE_VALUES)[number];

export const APP_SURFACE_DESKTOP: AppSurface = "desktop";
export const APP_SURFACE_WEB: AppSurface = "web";
export const APP_SURFACE_API: RequestAppSurface = "api";
export const DEFAULT_APP_SURFACE: AppSurface = APP_SURFACE_WEB;

export function parseAppSurface(
  value: string | null | undefined,
): AppSurface | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmedValue = value.trim();
  return APP_SURFACE_VALUES.find((surface) => surface === trimmedValue);
}

export function parseRequestAppSurface(
  value: string | null | undefined,
): RequestAppSurface | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmedValue = value.trim();
  return REQUEST_APP_SURFACE_VALUES.find((surface) => surface === trimmedValue);
}

export function formatAppSurfaceValues(): string {
  return APP_SURFACE_VALUES.join(", ");
}
