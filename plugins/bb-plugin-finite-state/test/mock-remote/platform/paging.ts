export interface PlatformPageBounds {
  readonly offset: number;
  readonly limit: number;
}

export function platformPageBounds(request: Request): PlatformPageBounds | null {
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  return Number.isSafeInteger(offset) && offset >= 0 &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 1_000
    ? { offset, limit }
    : null;
}

export function invalidPlatformPage(): Response {
  return Response.json(
    { error: { code: "PLATFORM_INVALID_PAGE", message: "offset or limit is invalid" } },
    { status: 400 },
  );
}

export function platformArrayPage(
  request: Request,
  values: readonly Record<string, unknown>[],
): Response {
  const bounds = platformPageBounds(request);
  if (bounds === null) return invalidPlatformPage();
  return Response.json(values.slice(bounds.offset, bounds.offset + bounds.limit), {
    headers: {
      "X-Total-Count": String(values.length),
      "X-Offset": String(bounds.offset),
      "X-Limit": String(bounds.limit),
    },
  });
}
