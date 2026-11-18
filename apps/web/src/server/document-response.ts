export interface DocumentResponseOverrides {
  status: number | null;
  cacheControl: string | null;
}

export function finalizeDocumentResponse(
  response: Response,
  overrides: DocumentResponseOverrides,
): Response {
  const headers = new Headers(response.headers);
  headers.append("content-security-policy", "frame-ancestors 'none'");
  headers.set("x-frame-options", "DENY");
  if (overrides.cacheControl !== null) {
    headers.set("cache-control", overrides.cacheControl);
  }
  return new Response(response.body, {
    status: overrides.status ?? response.status,
    statusText: overrides.status === null ? response.statusText : "",
    headers,
  });
}
