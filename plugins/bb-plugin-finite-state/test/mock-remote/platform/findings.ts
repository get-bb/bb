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

function uniqueVersionFindings(
  state: MockPlatformState,
  projectVersionId: string,
): Record<string, unknown>[] {
  const findings = new Map<string, Record<string, unknown>>();
  for (const finding of versionFindings(state, projectVersionId)) {
    findings.set(String(finding.id), finding);
  }
  return [...findings.values()];
}

function countBy(
  findings: readonly Record<string, unknown>[],
  field: string,
  missing: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    const key = typeof finding[field] === "string" ? finding[field] : missing;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
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

  const registerSummary = (
    routeId: string,
    body: (findings: Record<string, unknown>[]) => Record<string, unknown>,
  ): void => {
    registry.register(routeId, ({ params }) => {
      if (!state.versions.has(params.projectVersionId)) {
        return Response.json(
          { error: { code: "VERSION_NOT_FOUND", message: "Version was not found" } },
          { status: 404 },
        );
      }
      return Response.json(body(uniqueVersionFindings(state, params.projectVersionId)));
    });
  };
  registerSummary(
    "platform:GET:/public/v0/project/version/{projectVersionId}/findings/exploit/counts",
    (findings) => ({
      withExploit: 0,
      withoutExploit: findings.length,
      byExploit: {},
      total: findings.length,
    }),
  );
  registerSummary(
    "platform:GET:/public/v0/project/version/{projectVersionId}/findings/status/counts",
    (findings) => ({
      byStatus: countBy(findings, "vexStatus", "NO_STATUS"),
      total: findings.length,
    }),
  );
  registerSummary(
    "platform:GET:/public/v0/project/version/{projectVersionId}/findings/category/counts",
    (findings) => ({ byCategory: { CVE: findings.length }, total: findings.length }),
  );
  registerSummary(
    "platform:GET:/public/v0/project/version/{projectVersionId}/findings/severities/counts",
    (findings) => ({
      bySeverity: countBy(findings, "severity", "unknown"),
      total: findings.length,
    }),
  );
}
