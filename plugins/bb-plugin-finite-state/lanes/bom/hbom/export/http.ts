export function handleHbomXlsxExport(): Response {
  return Response.json(
    { error: { code: "NOT_IMPLEMENTED", message: "WP-46 owns HBOM XLSX export" } },
    { status: 501 },
  );
}

export function handleHbomCycloneDxExport(): Response {
  return Response.json(
    { error: { code: "NOT_IMPLEMENTED", message: "WP-46 owns HBOM CycloneDX export" } },
    { status: 501 },
  );
}
