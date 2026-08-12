import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AsEntity, AsEntityKind, Json } from "../../../lib/remote/types.js";
import type { MockHandler, MockHandlerContext } from "../types.js";
import {
  AssuranceStudioState,
  MockAssuranceStudioError,
} from "./state.js";

const SEGMENTS = {
  threat: ["threats", "threatId"],
  risk: ["risks", "riskId"],
  mitigation: ["mitigations", "mitigationId"],
  asset: ["assets", "assetId"],
  zone: ["zones", "zoneId"],
  dataflow: ["data-flows", "dataFlowId"],
  component: ["components", "componentId"],
  requirement: ["requirements", "requirementId"],
  "attack-path": ["attack-paths", "pathId"],
} as const satisfies Record<AsEntityKind, readonly [string, string]>;

export const AS_CREATABLE_KINDS = [
  "threat", "risk", "mitigation", "zone", "dataflow", "component", "requirement",
] as const;

function wire(entity: AsEntity): Record<string, Json> {
  return {
    ...entity.fields,
    id: entity.id,
    kind: entity.kind,
    project_id: entity.projectId,
    review_version: entity.reviewVersion,
    review_status: entity.reviewStatus,
    human_edited: entity.humanEdited,
  };
}

function jsonError(error: MockAssuranceStudioError): Response {
  if (error.code === "DeletionImpact") return Response.json(error.details, { status: 409 });
  return Response.json({ error: { code: error.code, details: error.details } }, { status: error.status });
}

async function body(context: MockHandlerContext): Promise<Record<string, Json>> {
  const value = await context.request.json();
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new MockAssuranceStudioError(400, "AS_INVALID_BODY", null);
  }
  return value as Record<string, Json>;
}

function page(context: MockHandlerContext): { page: number; limit: number } {
  const query = new URL(context.request.url).searchParams;
  const pageNumber = Number(query.get("page") ?? "1");
  const limit = Number(query.get("limit") ?? "50");
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new MockAssuranceStudioError(400, "AS_INVALID_PAGE", null);
  }
  return { page: pageNumber, limit };
}

function filterValue(entity: AsEntity, key: string): Json | undefined {
  if (key === "review_status" || key === "reviewStatus") return entity.reviewStatus;
  if (key === "human_edited" || key === "humanEdited") return entity.humanEdited;
  return entity.fields[key] ?? entity.fields[key.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase())];
}

function matchesFilters(entity: AsEntity, query: URLSearchParams): boolean {
  for (const [key, expected] of query) {
    if (key === "page" || key === "limit") continue;
    if (key === "q") {
      if (!JSON.stringify(entity.fields).toLocaleLowerCase().includes(expected.toLocaleLowerCase())) {
        return false;
      }
      continue;
    }
    const actual = filterValue(entity, key);
    if (actual === undefined) return false;
    const normalized = typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean"
      ? String(actual)
      : JSON.stringify(actual);
    if (normalized !== expected) return false;
  }
  return true;
}

function respond(action: () => Response | Promise<Response>): Promise<Response> {
  return Promise.resolve().then(action).catch((error: unknown) => {
    if (error instanceof MockAssuranceStudioError) return jsonError(error);
    throw error;
  });
}

export function listHandler(state: AssuranceStudioState, kind: AsEntityKind): MockHandler {
  return (context) => respond(() => {
    const paging = page(context);
    const query = new URL(context.request.url).searchParams;
    const all = state.list(kind).filter((entity) =>
      entity.projectId === context.params.projectId && matchesFilters(entity, query),
    );
    const start = (paging.page - 1) * paging.limit;
    const items = all.slice(start, start + paging.limit).map(wire);
    return Response.json({
      success: true,
      data: {
        items,
        total: all.length,
        page: paging.page,
        pageSize: paging.limit,
        hasMore: start + items.length < all.length,
      },
    });
  });
}

export function projectSbomListHandler(
  state: AssuranceStudioState,
  fixtureRoot: string,
): MockHandler {
  const frozenPage = JSON.parse(
    readFileSync(resolve(fixtureRoot, "assurance-studio/project-sbom-page-1.json"), "utf8"),
  ) as { success: true; data: { page: number; pageSize: number } };
  return (context) => respond(() => {
    const paging = page(context);
    const projectExists = state.list("component").some((entity) =>
      entity.projectId === context.params.id,
    );
    if (!projectExists) {
      throw new MockAssuranceStudioError(404, "AS_PROJECT_NOT_FOUND", context.params.id);
    }
    if (paging.page !== frozenPage.data.page || paging.limit !== frozenPage.data.pageSize) {
      throw new MockAssuranceStudioError(404, "AS_FIXTURE_PAGE_UNAVAILABLE", {
        page: paging.page,
        pageSize: paging.limit,
      });
    }
    return Response.json(frozenPage);
  });
}

export function getHandler(state: AssuranceStudioState, kind: AsEntityKind): MockHandler {
  const [, idName] = SEGMENTS[kind];
  return (context) => respond(() => Response.json({
    data: wire(state.get(kind, context.params[idName], context.params.projectId)),
  }));
}

export function createHandler(
  state: AssuranceStudioState,
  kind: (typeof AS_CREATABLE_KINDS)[number],
): MockHandler {
  return (context) => respond(async () => {
    const fields = await body(context);
    if (fields.review_status !== undefined || fields.reviewStatus !== undefined) {
      throw new MockAssuranceStudioError(400, "AS_CREATE_REVIEW_STATUS_UNAVAILABLE", null);
    }
    const entity = state.create(kind, context.params.projectId, fields);
    const reviewStatusSet = kind !== "risk" && kind !== "mitigation";
    return Response.json({
      success: true,
      entity: wire(entity),
      review_status_set: reviewStatusSet,
      review_status_reason: reviewStatusSet
        ? null
        : "Assurance Studio does not accept review_status for this entity type",
    }, { status: 201 });
  });
}

export function updateHandler(state: AssuranceStudioState, kind: AsEntityKind): MockHandler {
  const [, idName] = SEGMENTS[kind];
  return (context) => respond(async () => {
    const query = new URL(context.request.url).searchParams;
    const fields = await body(context);
    if ((kind === "risk" || kind === "mitigation") &&
      (fields.review_status !== undefined || fields.reviewStatus !== undefined)) {
      throw new MockAssuranceStudioError(400, "AS_REVIEW_STATUS_UNAVAILABLE", { kind });
    }
    const entity = state.update(
      kind,
      context.params[idName],
      context.params.projectId,
      fields,
      query.get("force") === "true",
    );
    const reviewStatusSet = kind !== "risk" && kind !== "mitigation";
    return Response.json({
      success: true,
      entity: wire(entity),
      review_status_set: reviewStatusSet,
      review_status_reason: reviewStatusSet
        ? null
        : "Assurance Studio does not accept review_status for this entity type",
    });
  });
}

export function deleteHandler(state: AssuranceStudioState, kind: AsEntityKind): MockHandler {
  const [, idName] = SEGMENTS[kind];
  return (context) => respond(() => {
    const mode = new URL(context.request.url).searchParams.get("mode");
    const forceValue = new URL(context.request.url).searchParams.get("force");
    if (mode !== null && mode !== "cascade" && mode !== "detach") {
      throw new MockAssuranceStudioError(400, "AS_INVALID_DELETE_MODE", mode);
    }
    if (forceValue !== null && forceValue !== "true" && forceValue !== "false") {
      throw new MockAssuranceStudioError(400, "AS_INVALID_FORCE", forceValue);
    }
    state.delete(
      kind,
      context.params[idName],
      context.params.projectId,
      mode ?? undefined,
      forceValue === "true",
    );
    return Response.json({ success: true });
  });
}

export function routeId(kind: AsEntityKind, method: "GET" | "POST" | "PATCH" | "DELETE", item: boolean): string {
  const [segment, idName] = SEGMENTS[kind];
  const suffix = item ? `/${segment}/{${idName}}` : `/${segment}`;
  return `assurance-studio:${method}:/api/projects/{projectId}${suffix}`;
}
