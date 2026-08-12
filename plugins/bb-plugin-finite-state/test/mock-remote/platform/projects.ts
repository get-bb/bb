import type { MockHandlerRegistry } from "../types.js";
import type { MockPlatformState } from "./state.js";

function page(request: Request, values: readonly Record<string, unknown>[]): Response {
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    return Response.json(
      { error: { code: "PLATFORM_INVALID_PAGE", message: "offset or limit is invalid" } },
      { status: 400 },
    );
  }
  return Response.json(values.slice(offset, offset + limit), {
    headers: {
      "X-Total-Count": String(values.length),
      "X-Offset": String(offset),
      "X-Limit": String(limit),
    },
  });
}

export function registerProjectHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register("platform:GET:/public/v0/projects", ({ request }) => {
    return page(request, [...state.projects.values()]);
  });
  registry.register(
    "platform:GET:/public/v0/projects/{projectId}/versions",
    ({ request, params }) => {
      if (!state.projects.has(params.projectId)) {
        return Response.json(
          { error: { code: "PROJECT_NOT_FOUND", message: "Project was not found" } },
          { status: 404 },
        );
      }
      const versions = [...state.versions.values()].filter(
        (version) => version.projectId === params.projectId,
      );
      return page(request, versions);
    },
  );
}
