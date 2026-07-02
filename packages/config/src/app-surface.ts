export const APP_SURFACE_HEADER_NAME = "x-bb-app-surface";
export const APP_SURFACE_ENV_NAME = "BB_APP_SURFACE";

export const APP_SURFACE_VALUES = ["desktop", "web"] as const;
export type AppSurface = (typeof APP_SURFACE_VALUES)[number];

export const APP_SURFACE_DESKTOP: AppSurface = "desktop";
export const APP_SURFACE_WEB: AppSurface = "web";
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

export function formatAppSurfaceValues(): string {
  return APP_SURFACE_VALUES.join(", ");
}
