import type { AsCreatableEntityKind, AsEntityKind } from "../types.js";
import type { RetryClass } from "../platform/routes.js";

export interface AssuranceStudioRoute {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly requestMediaType: "application/json" | null;
  readonly responseMediaType: "application/json";
  readonly retry: RetryClass;
  readonly evidence: "openapi" | "assurance-studio-api-gaps.md §2" | "assurance-studio-api-gaps.md §6";
}

export const AS_ENTITY_SEGMENTS = {
  threat: ["threats", "threatId"], risk: ["risks", "riskId"], mitigation: ["mitigations", "mitigationId"],
  asset: ["assets", "assetId"], zone: ["zones", "zoneId"], dataflow: ["data-flows", "dataFlowId"],
  component: ["components", "componentId"], requirement: ["requirements", "requirementId"],
  "attack-path": ["attack-paths", "pathId"],
} as const satisfies Record<AsEntityKind, readonly [string, string]>;

const route = (method: AssuranceStudioRoute["method"], path: string, retry: RetryClass, evidence: AssuranceStudioRoute["evidence"] = "openapi"): AssuranceStudioRoute => ({
  method, path, requestMediaType: method === "POST" || method === "PATCH" ? "application/json" : null,
  responseMediaType: "application/json", retry, evidence,
});

export function entityCollectionRoute(kind: AsEntityKind, method: "GET" | "POST"): AssuranceStudioRoute {
  const [segment] = AS_ENTITY_SEGMENTS[kind];
  const evidence = kind === "asset" || kind === "attack-path" ? "assurance-studio-api-gaps.md §2" : "openapi";
  return route(method, `/api/projects/{projectId}/${segment}`, method === "GET" ? "safe" : "write-once", evidence);
}

export function entityItemRoute(kind: AsEntityKind, method: "GET" | "PATCH" | "DELETE"): AssuranceStudioRoute {
  const [segment, id] = AS_ENTITY_SEGMENTS[kind];
  const evidence = ["asset", "zone", "dataflow", "attack-path"].includes(kind) || (method === "DELETE" && ["component", "requirement"].includes(kind))
    ? "assurance-studio-api-gaps.md §2" : "openapi";
  return route(method, `/api/projects/{projectId}/${segment}/{${id}}`, method === "GET" ? "safe" : "write-once", evidence);
}

export const ASSURANCE_STUDIO_ROUTES = {
  health: route("GET", "/api/projects", "safe"),
  listProjectSbomPackages: route("GET", "/api/projects/{id}/sbom", "safe", "assurance-studio-api-gaps.md §6"),
  listVerificationChecks: route("GET", "/api/projects/{projectId}/verification/checks", "safe"),
  getVerificationCheck: route("GET", "/api/projects/{projectId}/verification/checks/{checkId}", "safe"),
  runVerificationChecks: route("POST", "/api/projects/{projectId}/verification/run", "write-once"),
} as const satisfies Record<string, AssuranceStudioRoute>;

export const AS_CREATABLE_KINDS = ["threat", "risk", "mitigation", "asset", "zone", "dataflow", "component", "requirement"] as const satisfies readonly AsCreatableEntityKind[];
