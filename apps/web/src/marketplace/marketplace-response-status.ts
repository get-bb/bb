export function marketplaceResponseStatus(
  pathname: string,
  loaderData: ReadonlyArray<unknown>,
): number | null {
  if (pathname !== "/marketplace" && !pathname.startsWith("/marketplace/")) {
    return null;
  }
  for (const value of loaderData) {
    if (
      typeof value === "object" &&
      value !== null &&
      "status" in value &&
      value.status === "unavailable"
    ) {
      return 503;
    }
  }
  return null;
}
