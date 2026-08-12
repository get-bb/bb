import type { MockHandlerRegistry } from "../types.js";
import { platformSbom, type MockPlatformState } from "./state.js";

function badRequest(code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status: 400 });
}

function bounds(request: Request): { offset: number; limit: number } | null {
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  return Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1_000
    ? { offset, limit }
    : null;
}

function page(request: Request, values: readonly Record<string, unknown>[]): Response {
  const paging = bounds(request);
  if (paging === null) return badRequest("PLATFORM_INVALID_PAGE", "offset or limit is invalid");
  return Response.json(values.slice(paging.offset, paging.offset + paging.limit), {
    headers: {
      "X-Total-Count": String(values.length),
      "X-Offset": String(paging.offset),
      "X-Limit": String(paging.limit),
    },
  });
}

function rsqlFilter(
  values: readonly Record<string, unknown>[],
  expression: string | null,
): Record<string, unknown>[] | null {
  if (expression === null || expression.length === 0) return [...values];
  const clauses = expression.split(";");
  let filtered = [...values];
  for (const clause of clauses) {
    const match = /^(name|version|purl|fallbackIdentity)==(.+)$/u.exec(clause);
    if (match === null) return null;
    const [, key, expected] = match;
    filtered = filtered.filter((component) => {
      if (expected === "null") return component[key] === null;
      return component[key] === expected;
    });
  }
  return filtered;
}

function sortComponents(values: Record<string, unknown>[], sort: string | null): void {
  if (sort === null) return;
  const match = /^(name|version):(asc|desc)$/u.exec(sort);
  if (match === null) return;
  const [, key, direction] = match;
  values.sort((left, right) => {
    const compared = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
    return direction === "asc" ? compared : -compared;
  });
}

export function registerBomHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register("platform:GET:/public/v0/components", ({ request }) => {
    const url = new URL(request.url);
    const filtered = rsqlFilter([...state.components.values()], url.searchParams.get("filter"));
    if (filtered === null) return badRequest("PLATFORM_INVALID_FILTER", "Component filter is invalid");
    if (url.searchParams.get("excluded") === "true") filtered.splice(0);
    sortComponents(filtered, url.searchParams.get("sort"));
    return page(request, filtered);
  });

  registry.register("platform:GET:/public/v0/components/search", ({ request }) => {
    const url = new URL(request.url);
    const name = url.searchParams.get("name")?.trim();
    if (name === undefined || name.length === 0) {
      return badRequest("COMPONENT_NAME_REQUIRED", "name is required");
    }
    const version = url.searchParams.get("version");
    const versionPattern = version === null
      ? null
      : new RegExp(`^${version.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "iu");
    const matches = [...state.components.values()].filter((component) => {
      return String(component.name).toLocaleLowerCase().includes(name.toLocaleLowerCase()) &&
        (versionPattern === null || versionPattern.test(String(component.version)));
    });
    sortComponents(matches, url.searchParams.get("sort"));
    return page(request, matches);
  });

  const download = (format: "cyclonedx" | "spdx") => ({ params }: { params: Readonly<Record<string, string>> }): Response => {
    if (!state.versions.has(params.projectVersionId)) {
      return Response.json(
        { error: { code: "VERSION_NOT_FOUND", message: "Version was not found" } },
        { status: 404 },
      );
    }
    const artifact = platformSbom(state);
    const bytes = format === "cyclonedx" ? artifact.sbomBytes : artifact.spdxBytes;
    const hash = format === "cyclonedx" ? artifact.sbomSha256 : artifact.spdxSha256;
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": format === "cyclonedx" ? "application/vnd.cyclonedx+json" : "application/spdx+json",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Sha256": hash,
      },
    });
  };
  registry.register("platform:GET:/public/v0/sboms/cyclonedx/{projectVersionId}", download("cyclonedx"));
  registry.register("platform:GET:/public/v0/sboms/spdx/{projectVersionId}", download("spdx"));
}
