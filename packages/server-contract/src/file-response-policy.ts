export const FILE_PREVIEW_ACTIVE_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts";

export function filePreviewContentSecurityPolicy(
  mimeType: string,
): string | null {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    normalized === "text/html" ||
    normalized === "application/xml" ||
    normalized === "text/xml" ||
    normalized === "text/mathml" ||
    normalized.endsWith("+xml")
  ) {
    return FILE_PREVIEW_ACTIVE_CONTENT_SECURITY_POLICY;
  }
  return null;
}
