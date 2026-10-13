export const PREVIEW_DIRECTIVE_ID = "browser-preview";

export function previewDirective(sessionId: string): string {
  return `::${PREVIEW_DIRECTIVE_ID}{session="${sessionId}"}`;
}
