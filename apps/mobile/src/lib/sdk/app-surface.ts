/**
 * Request-side app surface header. The server parses `mobile` as a
 * `RequestAppSurface` (packages/config/src/app-surface.ts) for request context
 * and telemetry.
 */
export const MOBILE_APP_SURFACE_HEADER = {
  name: "x-bb-app-surface",
  value: "mobile",
} as const;
