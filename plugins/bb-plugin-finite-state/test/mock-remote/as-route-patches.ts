import type { MockMethod, MockRoute } from "./types.js";

export interface AssuranceStudioRoutePatch {
  readonly method: MockMethod;
  readonly pathTemplate: string;
  readonly operationId: null;
  readonly requestMediaTypes: readonly string[];
  readonly responseStatuses: readonly number[];
  readonly evidenceFile:
    | "assurance-studio-api-gaps.md"
    | "assurance-studio-fs-links-live-2026-08-14.md";
  readonly evidenceSection: "1" | "2" | "6";
}

export interface AssuranceStudioClientContractRoute {
  readonly method: MockMethod;
  readonly pathTemplate: string;
  readonly operationId: null;
  readonly requestMediaTypes: readonly string[];
  readonly responseStatuses: readonly number[];
  readonly evidence: string;
}

const JSON_BODY = ["application/json"] as const;

function itemCrud(pathTemplate: string): readonly AssuranceStudioRoutePatch[] {
  return [
    {
      method: "GET",
      pathTemplate,
      operationId: null,
      requestMediaTypes: [],
      responseStatuses: [],
      evidenceFile: "assurance-studio-api-gaps.md",
      evidenceSection: "2",
    },
    {
      method: "PATCH",
      pathTemplate,
      operationId: null,
      requestMediaTypes: JSON_BODY,
      responseStatuses: [],
      evidenceFile: "assurance-studio-api-gaps.md",
      evidenceSection: "2",
    },
    {
      method: "DELETE",
      pathTemplate,
      operationId: null,
      requestMediaTypes: [],
      responseStatuses: [],
      evidenceFile: "assurance-studio-api-gaps.md",
      evidenceSection: "2",
    },
  ];
}

/** Only routes explicitly listed by the vendored, handler-backed audit. */
export const ASSURANCE_STUDIO_ROUTE_PATCHES = [
  {
    method: "GET",
    pathTemplate: "/api/projects/{projectId}/fs-links",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [200],
    evidenceFile: "assurance-studio-fs-links-live-2026-08-14.md",
    evidenceSection: "1",
  },
  ...itemCrud("/api/projects/{projectId}/assets/{assetId}"),
  {
    method: "GET",
    pathTemplate: "/api/projects/{projectId}/assets/{assetId}/threats",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "POST",
    pathTemplate: "/api/projects/{projectId}/assets/{assetId}/threats",
    operationId: null,
    requestMediaTypes: JSON_BODY,
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "GET",
    pathTemplate: "/api/projects/{projectId}/attack-paths",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "POST",
    pathTemplate: "/api/projects/{projectId}/attack-paths",
    operationId: null,
    requestMediaTypes: JSON_BODY,
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  ...itemCrud("/api/projects/{projectId}/attack-paths/{pathId}"),
  ...itemCrud("/api/projects/{projectId}/zones/{zoneId}"),
  ...itemCrud("/api/projects/{projectId}/data-flows/{dataFlowId}"),
  {
    method: "PATCH",
    pathTemplate: "/api/projects/{projectId}/components/{componentId}",
    operationId: null,
    requestMediaTypes: JSON_BODY,
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "DELETE",
    pathTemplate: "/api/projects/{projectId}/components/{componentId}",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "DELETE",
    pathTemplate: "/api/projects/{projectId}/requirements/{requirementId}",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "2",
  },
  {
    method: "GET",
    pathTemplate: "/api/projects/{id}/sbom",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidenceFile: "assurance-studio-api-gaps.md",
    evidenceSection: "6",
  },
] as const satisfies readonly AssuranceStudioRoutePatch[];

/** Seeded-mock routes exercised by the production client but unverified against the upstream service. */
export const ASSURANCE_STUDIO_CLIENT_CONTRACT_ROUTES = [
  {
    method: "GET",
    pathTemplate: "/api/projects/{projectId}/assets",
    operationId: null,
    requestMediaTypes: [],
    responseStatuses: [],
    evidence: "FS-153 seeded-mock-only asset list; production route unverified",
  },
] as const satisfies readonly AssuranceStudioClientContractRoute[];

export function handlerAuditRoute(patch: AssuranceStudioRoutePatch): MockRoute {
  return {
    routeId: `assurance-studio:${patch.method}:${patch.pathTemplate}`,
    service: "assurance-studio",
    method: patch.method,
    pathTemplate: patch.pathTemplate,
    operationId: patch.operationId,
    auth: "X-API-Key",
    requestMediaTypes: [...patch.requestMediaTypes],
    responseStatuses: [...patch.responseStatuses],
    source: "handler-audit",
    evidence: `${patch.evidenceFile} §${patch.evidenceSection}`,
  };
}

export function clientContractRoute(
  patch: AssuranceStudioClientContractRoute,
): MockRoute {
  return {
    routeId: `assurance-studio:${patch.method}:${patch.pathTemplate}`,
    service: "assurance-studio",
    method: patch.method,
    pathTemplate: patch.pathTemplate,
    operationId: patch.operationId,
    auth: "X-API-Key",
    requestMediaTypes: [...patch.requestMediaTypes],
    responseStatuses: [...patch.responseStatuses],
    source: "client-contract",
    evidence: patch.evidence,
  };
}
