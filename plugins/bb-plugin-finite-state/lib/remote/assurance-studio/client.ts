import { responseError, transportError } from "../errors.js";
import { RemoteLimiter, systemScheduler } from "../rate-limit.js";
import {
  AS_ENTITY_SEGMENTS,
  ASSURANCE_STUDIO_ROUTES,
  entityCollectionRoute,
  entityItemRoute,
  type AssuranceStudioRoute,
} from "./routes.js";
import {
  RemoteError,
  iterateRemotePages,
  type AsCreatableEntityKind,
  type AsDeleteImpact,
  type AsEntity,
  type AsEntityKind,
  type AsReviewStatus,
  type AssuranceStudioClient as AssuranceStudioClientContract,
  type AsWriteResult,
  type Json,
  type RemoteCallContext,
  type RemoteHealth,
  type RemotePage,
  type RemotePageRequest,
} from "../types.js";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AssuranceStudioClientOptions {
  baseUrl: string;
  apiKey: string;
  concurrency?: number;
  fetch?: Fetch;
  limiter?: RemoteLimiter;
}

function clean(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(?:^|_)(?:embedding|embeddings|vector)(?:$|_)/iu.test(key)) continue;
      output[key] = clean(item);
    }
    return output;
  }
  return null;
}

function object(value: unknown): Record<string, Json> {
  const normalized = clean(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new RemoteError("Assurance Studio returned an invalid JSON object", {
      service: "assurance-studio", code: "AS_INVALID_RESPONSE", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
  }
  return normalized;
}

function payload(value: unknown): Record<string, Json> {
  const envelope = object(value);
  const nested = envelope.data ?? envelope.result ?? envelope.entity;
  return nested !== undefined && nested !== null && !Array.isArray(nested) && typeof nested === "object"
    ? object(nested)
    : envelope;
}

function stringValue(value: Json | undefined): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function booleanValue(value: Json | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function reviewStatus(value: Json | undefined): AsReviewStatus | null {
  return value === "pending" || value === "ai_approved" || value === "ai_flagged" ||
    value === "human_approved" || value === "human_rejected"
    ? value
    : null;
}

function normalizeEntity(kind: AsEntityKind, projectId: string, value: unknown): AsEntity {
  const fields = payload(value);
  const id = stringValue(fields.id ?? fields[`${kind.replace("-", "_")}_id`]);
  if (id === null) throw new RemoteError("Assurance Studio entity had no identifier", {
    service: "assurance-studio", code: "AS_INVALID_ENTITY", status: null,
    retryable: false, retryAfterMs: null, details: { kind },
  });
  return {
    id,
    projectId: stringValue(fields.project_id ?? fields.projectId) ?? projectId,
    kind,
    reviewVersion: stringValue(fields.review_version ?? fields.reviewVersion),
    reviewStatus: reviewStatus(fields.review_status ?? fields.reviewStatus),
    humanEdited: booleanValue(fields.human_edited ?? fields.humanEdited),
    fields,
  };
}

function pagePayload(value: unknown): { items: unknown[]; total: number | null; hasMore?: boolean } {
  if (Array.isArray(value)) return { items: value, total: null };
  const envelope = object(value);
  const data = envelope.data;
  const nested = data !== null && data !== undefined && !Array.isArray(data) && typeof data === "object"
    ? object(data)
    : envelope;
  const candidates = [envelope.items, envelope.results, envelope.entities, envelope.packages,
    nested.items, nested.results, nested.entities, nested.packages, Array.isArray(data) ? data : undefined];
  const items = candidates.find(Array.isArray);
  if (!Array.isArray(items)) throw new RemoteError("Assurance Studio list response had no items", {
    service: "assurance-studio", code: "AS_INVALID_RESPONSE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
  const totalValue = nested.total ?? nested.total_count ?? nested.count ?? envelope.total;
  const hasMoreValue = nested.has_more ?? nested.hasMore;
  return {
    items,
    total: typeof totalValue === "number" && Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : null,
    ...(typeof hasMoreValue === "boolean" ? { hasMore: hasMoreValue } : {}),
  };
}

function routePath(route: AssuranceStudioRoute, parameters: Readonly<Record<string, string>>): string {
  return route.path.replace(/\{([^}]+)\}/gu, (_match, key: string) => {
    const value = parameters[key];
    if (!value) throw new TypeError(`Missing route parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

function queryValue(value: Json): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

function createFields(kind: AsCreatableEntityKind, fields: Record<string, Json>): Record<string, Json> {
  if (kind !== "dataflow") return fields;
  const output = { ...fields };
  const aliases = {
    from_component: "source_component_id", to_component: "target_component_id",
    encrypted: "is_encrypted", authenticated: "is_authenticated", bidirectional: "is_bidirectional",
  } as const;
  for (const [normalized, create] of Object.entries(aliases)) {
    if (output[normalized] !== undefined) {
      output[create] = output[normalized];
      delete output[normalized];
    }
  }
  return output;
}

const REVIEW_PATCH_KINDS = new Set<AsEntityKind>([
  "threat", "asset", "zone", "dataflow", "component", "requirement", "attack-path",
]);

export class AssuranceStudioClient implements AssuranceStudioClientContract {
  readonly #baseUrl: URL;
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #limiter: RemoteLimiter;

  constructor(options: AssuranceStudioClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#limiter = options.limiter ?? new RemoteLimiter({
      concurrency: options.concurrency ?? 8, maxAttempts: 6, maxBackoffMs: 64_000,
      scheduler: systemScheduler, random: Math.random,
    });
  }

  close(): void { this.#limiter.close(); }

  async #send(
    route: AssuranceStudioRoute,
    parameters: Readonly<Record<string, string>>,
    query: Readonly<Record<string, Json | undefined>>,
    body: Json | undefined,
    ctx?: RemoteCallContext,
    accepted: readonly number[] = [],
  ): Promise<Response> {
    const url = new URL(routePath(route, parameters), this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, queryValue(value));
    }
    return await this.#limiter.run(async () => {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: route.method,
          headers: {
            "X-API-Key": this.#apiKey,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(ctx?.signal ? { signal: ctx.signal } : {}),
        });
      } catch (error: unknown) {
        throw transportError("assurance-studio", route.path, route.retry !== "write-once", error);
      }
      if (!response.ok && !accepted.includes(response.status)) {
        const error = await responseError("assurance-studio", response, Date.now());
        if (route.retry === "write-once" && error.retryable) {
          throw new RemoteError(error.message, { ...error, retryable: false });
        }
        throw error;
      }
      return response;
    }, ctx?.signal);
  }

  async #json(
    route: AssuranceStudioRoute,
    parameters: Readonly<Record<string, string>>,
    query: Readonly<Record<string, Json | undefined>>,
    body: Json | undefined,
    ctx?: RemoteCallContext,
  ): Promise<unknown> {
    const response = await this.#send(route, parameters, query, body, ctx);
    try { return await response.json(); } catch {
      throw new RemoteError("Assurance Studio returned invalid JSON", {
        service: "assurance-studio", code: "AS_INVALID_JSON", status: response.status,
        retryable: false, retryAfterMs: null, details: null,
      });
    }
  }

  async health(ctx?: RemoteCallContext): Promise<RemoteHealth> {
    await this.#json(ASSURANCE_STUDIO_ROUTES.health, {}, { page: 1, limit: 1 }, undefined, ctx);
    return { configured: true, reachable: true, detail: null };
  }

  listEntities(kind: AsEntityKind, input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<AsEntity>> {
    const route = entityCollectionRoute(kind, "GET");
    return iterateRemotePages(input.page, ctx, { service: "assurance-studio", defaultPageSize: 50, maxPageSize: 200 }, async request => {
      const raw = await this.#json(route, { projectId: input.projectId }, {
        page: Math.floor(request.index / request.pageSize) + 1, limit: request.pageSize,
        ...(input.filters ?? {}),
      }, undefined, ctx);
      const normalized = pagePayload(raw);
      const items = normalized.items.map(item => normalizeEntity(kind, input.projectId, item));
      const hasMore = normalized.hasMore ?? (normalized.total === null
        ? items.length === request.pageSize
        : request.index + items.length < normalized.total);
      return { items, total: normalized.total, hasMore };
    });
  }

  async getEntity(kind: AsEntityKind, input: { projectId: string; id: string }, ctx?: RemoteCallContext): Promise<AsEntity> {
    const [, idName] = AS_ENTITY_SEGMENTS[kind];
    const value = await this.#json(entityItemRoute(kind, "GET"), { projectId: input.projectId, [idName]: input.id }, {}, undefined, ctx);
    return normalizeEntity(kind, input.projectId, value);
  }

  async createEntity(kind: AsCreatableEntityKind, input: { projectId: string; fields: Record<string, Json> }, ctx?: RemoteCallContext): Promise<AsWriteResult> {
    const desiredReview = typeof input.fields.review_status === "string" ? input.fields.review_status : null;
    const baseFields = { ...input.fields };
    delete baseFields.review_status;
    const value = await this.#json(entityCollectionRoute(kind, "POST"), { projectId: input.projectId }, {}, createFields(kind, baseFields), ctx);
    let entity = normalizeEntity(kind, input.projectId, value);
    if (desiredReview === null) return { success: true, entity, reviewStatusSet: true, reviewStatusReason: null };
    if (!REVIEW_PATCH_KINDS.has(kind)) return {
      success: true, entity, reviewStatusSet: false,
      reviewStatusReason: "Assurance Studio does not accept review_status for this entity type",
    };
    const updated = await this.updateEntity(kind, { projectId: input.projectId, id: entity.id, fields: { review_status: desiredReview } }, ctx);
    entity = updated.entity;
    return { success: true, entity, reviewStatusSet: updated.reviewStatusSet, reviewStatusReason: updated.reviewStatusReason };
  }

  async updateEntity(kind: AsEntityKind, input: { projectId: string; id: string; fields: Record<string, Json>; force?: boolean }, ctx?: RemoteCallContext): Promise<AsWriteResult> {
    const [, idName] = AS_ENTITY_SEGMENTS[kind];
    const desiredReview = typeof input.fields.review_status === "string";
    const fields = { ...input.fields };
    if (desiredReview && !REVIEW_PATCH_KINDS.has(kind)) delete fields.review_status;
    const value = Object.keys(fields).length === 0
      ? await this.getEntity(kind, input, ctx)
      : normalizeEntity(kind, input.projectId, await this.#json(entityItemRoute(kind, "PATCH"), { projectId: input.projectId, [idName]: input.id }, { force: input.force }, fields, ctx));
    return {
      success: true,
      entity: value,
      reviewStatusSet: !(desiredReview && !REVIEW_PATCH_KINDS.has(kind)),
      reviewStatusReason: desiredReview && !REVIEW_PATCH_KINDS.has(kind)
        ? "Assurance Studio does not accept review_status for this entity type"
        : null,
    };
  }

  async deleteEntity(kind: AsEntityKind, input: { projectId: string; id: string; mode?: "cascade" | "detach"; force?: boolean }, ctx?: RemoteCallContext): Promise<{ success: true } | { success: false; impact: AsDeleteImpact }> {
    const [, idName] = AS_ENTITY_SEGMENTS[kind];
    const response = await this.#send(entityItemRoute(kind, "DELETE"), { projectId: input.projectId, [idName]: input.id }, { mode: input.mode, force: input.force }, undefined, ctx, [409]);
    if (response.status !== 409) return { success: true };
    let value: unknown;
    try { value = await response.json(); } catch { value = {}; }
    const impact = payload(value);
    const actions = impact.allowed_actions ?? impact.allowedActions;
    const references = impact.references;
    return {
      success: false,
      impact: {
        allowedActions: Array.isArray(actions)
          ? actions.filter((item): item is "cascade" | "detach" => item === "cascade" || item === "detach")
          : [],
        recommendedAction: impact.recommended_action === "cascade" || impact.recommended_action === "detach"
          ? impact.recommended_action : impact.recommendedAction === "cascade" || impact.recommendedAction === "detach"
            ? impact.recommendedAction : null,
        references: Array.isArray(references) ? references.map(clean) : [],
      },
    };
  }

  #recordPages(route: AssuranceStudioRoute, input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<Record<string, Json>>> {
    return iterateRemotePages(input.page, ctx, { service: "assurance-studio", defaultPageSize: 50, maxPageSize: 200 }, async request => {
      const raw = await this.#json(route, { projectId: input.projectId, id: input.projectId }, {
        page: Math.floor(request.index / request.pageSize) + 1, limit: request.pageSize,
        ...(input.filters ?? {}),
      }, undefined, ctx);
      const normalized = pagePayload(raw);
      const items = normalized.items.map(object);
      return { items, total: normalized.total, hasMore: normalized.hasMore ?? (normalized.total === null ? items.length === request.pageSize : request.index + items.length < normalized.total) };
    });
  }

  listProjectSbomPackages(input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext) {
    return this.#recordPages(ASSURANCE_STUDIO_ROUTES.listProjectSbomPackages, input, ctx);
  }
  listVerificationChecks(input: { projectId: string; status?: string; type?: string; requirementId?: string; page?: RemotePageRequest }, ctx?: RemoteCallContext) {
    return this.#recordPages(ASSURANCE_STUDIO_ROUTES.listVerificationChecks, {
      projectId: input.projectId, page: input.page,
      filters: { ...(input.status ? { status: input.status } : {}), ...(input.type ? { type: input.type } : {}), ...(input.requirementId ? { requirement_id: input.requirementId } : {}) },
    }, ctx);
  }
  async getVerificationCheck(input: { projectId: string; checkId: string }, ctx?: RemoteCallContext) {
    return payload(await this.#json(ASSURANCE_STUDIO_ROUTES.getVerificationCheck, input, {}, undefined, ctx));
  }
  async runVerificationChecks(input: { projectId: string; checkIds?: string[]; rerunPassed?: boolean }, ctx?: RemoteCallContext) {
    const value = payload(await this.#json(ASSURANCE_STUDIO_ROUTES.runVerificationChecks, { projectId: input.projectId }, {}, {
      ...(input.checkIds ? { check_ids: input.checkIds } : {}), ...(input.rerunPassed !== undefined ? { rerun_passed: input.rerunPassed } : {}),
    }, ctx));
    const runId = stringValue(value.run_id ?? value.runId);
    const checksQueued = value.checks_queued ?? value.checksQueued;
    const status = stringValue(value.status);
    if (runId === null || typeof checksQueued !== "number" || !Number.isSafeInteger(checksQueued) || status === null) {
      throw new RemoteError("Assurance Studio verification run response was invalid", { service: "assurance-studio", code: "AS_INVALID_RESPONSE", status: null, retryable: false, retryAfterMs: null, details: null });
    }
    return { runId, checksQueued, status };
  }
}
