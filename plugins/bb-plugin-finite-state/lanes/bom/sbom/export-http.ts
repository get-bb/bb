export function handleSbomExport(): Response {
  return Response.json(
    { error: { code: "NOT_IMPLEMENTED", message: "WP-43 owns SBOM export" } },
    { status: 501 },
  );
}
