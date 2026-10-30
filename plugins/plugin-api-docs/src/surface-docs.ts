export const SURFACE_DOCS_ORIGIN = "https://getbb.app";
export const SURFACE_DOCS_BASE_PATH = "/docs/plugin-sdk";

export function surfaceDocsPath(surfaceId: string): string {
  return `${SURFACE_DOCS_BASE_PATH}/${surfaceId}`;
}

export function surfaceDocsUrl(surfaceId: string): string {
  return `${SURFACE_DOCS_ORIGIN}${surfaceDocsPath(surfaceId)}`;
}
