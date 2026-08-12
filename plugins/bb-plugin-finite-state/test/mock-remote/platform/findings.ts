import type { MockHandlerRegistry } from "../types.js";
import type { MockPlatformState } from "./state.js";

interface PageBounds {
  readonly offset: number;
  readonly limit: number;
}

function pageBounds(request: Request): PageBounds | null {
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  return Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1_000
    ? { offset, limit }
    : null;
}

function badPage(): Response {
  return Response.json(
    { error: { code: "PLATFORM_INVALID_PAGE", message: "offset or limit is invalid" } },
    { status: 400 },
  );
}

function arrayPage(request: Request, values: readonly Record<string, unknown>[]): Response {
  const bounds = pageBounds(request);
  if (bounds === null) return badPage();
  return Response.json(values.slice(bounds.offset, bounds.offset + bounds.limit), {
    headers: {
      "X-Total-Count": String(values.length),
      "X-Offset": String(bounds.offset),
      "X-Limit": String(bounds.limit),
    },
  });
}

function findingComments(
  state: MockPlatformState,
  projectVersionId: string,
  findingId: string,
): Record<string, unknown>[] {
  const comments = state.findingComments.get(projectVersionId);
  if (comments === undefined) return [];
  return [...comments.values()]
    .filter((comment) => comment.findingId === findingId)
    .map(({ findingId: _findingId, ...comment }) => structuredClone(comment));
}

function filteredFindings(request: Request, state: MockPlatformState): Record<string, unknown>[] | null {
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  const all = [...state.findings.values()];
  if (filter === null || filter.length === 0) return all;
  const match = /^projectVersion==([^;]+);findingId==([^;]+)$/u.exec(filter);
  if (match === null) return null;
  return all.filter(
    (finding) => finding.projectVersionId === match[1] && finding.id === match[2],
  );
}

function detailRows(request: Request, state: MockPlatformState): Response {
  const values = filteredFindings(request, state);
  if (values === null) {
    return Response.json(
      { error: { code: "PLATFORM_INVALID_FILTER", message: "Finding filter is invalid" } },
      { status: 400 },
    );
  }
  const includeComments = new URL(request.url).searchParams.get("includeComments") === "true";
  return arrayPage(
    request,
    values.map((finding) => ({
      ...structuredClone(finding),
      ...(includeComments
        ? {
            comments: findingComments(
              state,
              String(finding.projectVersionId),
              String(finding.id),
            ),
          }
        : { comments: null }),
    })),
  );
}

function versionFindings(state: MockPlatformState, projectVersionId: string): Record<string, unknown>[] {
  return [...state.findings.values()].filter(
    (finding) => finding.projectVersionId === projectVersionId,
  );
}

export function registerFindingHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register(
    "platform:GET:/public/v0/versions/{projectVersionId}/findings",
    ({ request, params }) => {
      if (!state.versions.has(params.projectVersionId)) {
        return Response.json(
          { error: { code: "VERSION_NOT_FOUND", message: "Version was not found" } },
          { status: 404 },
        );
      }
      const bounds = pageBounds(request);
      if (bounds === null) return badPage();
      const values = versionFindings(state, params.projectVersionId);
      return Response.json({
        items: values.slice(bounds.offset, bounds.offset + bounds.limit),
        total: values.length,
      });
    },
  );
  registry.register("platform:GET:/public/v0/findings", ({ request }) => {
    return detailRows(request, state);
  });
  registry.register(
    "platform:GET:/public/v0/projects/{projectId}/findings/activity",
    ({ request, params }) => {
      if (!state.projects.has(params.projectId)) {
        return Response.json(
          { error: { code: "PROJECT_NOT_FOUND", message: "Project was not found" } },
          { status: 404 },
        );
      }
      const url = new URL(request.url);
      const cve = url.searchParams.get("cve");
      const projectVersionId = url.searchParams.get("projectVersionId");
      if (cve === null || cve.length === 0) {
        return Response.json(
          { error: { code: "CVE_REQUIRED", message: "cve is required" } },
          { status: 400 },
        );
      }
      const values = state.findingActivity.get(`${params.projectId}:${cve}`) ?? [];
      const members = projectVersionId === null
        ? values
        : values.filter((event) => event.projectVersionId === projectVersionId);
      return arrayPage(request, members);
    },
  );

}
