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

function pagePayload(
  value: unknown,
  itemKeys: readonly string[],
): { items: unknown[]; total: number | null; hasMore?: boolean } {
  if (Array.isArray(value)) return { items: value, total: null };
  const envelope = object(value);
  const data = envelope.data;
  const nested = data !== null && data !== undefined && !Array.isArray(data) && typeof data === "object"
    ? object(data)
    : envelope;
  const candidates = [
    ...itemKeys.flatMap(key => [envelope[key], nested[key]]),
    envelope.items, envelope.results, envelope.entities, envelope.packages,
    nested.items, nested.results, nested.entities, nested.packages,
    Array.isArray(data) ? data : undefined,
  ];
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

const AS_ENTITY_COLLECTION_KEYS = {
  threat: ["threats"], risk: ["risks"], mitigation: ["mitigations"],
  asset: ["assets"], zone: ["zones"], dataflow: ["data_flows", "dataFlows"],
  component: ["components"], requirement: ["requirements"],
  "attack-path": ["attack_paths", "attackPaths"],
} as const satisfies Record<AsEntityKind, readonly string[]>;

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

function sameJson(left: Json, right: Json): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function aliasField(
  fields: Record<string, Json>,
  source: string,
  target: string,
): void {
  const value = fields[source];
  if (value === undefined) return;
  const existing = fields[target];
  if (existing !== undefined && !sameJson(existing, value)) {
    throw new RemoteError("Assurance Studio PATCH field aliases conflict", {
      service: "assurance-studio", code: "AS_AMBIGUOUS_PATCH_FIELDS", status: null,
      retryable: false, retryAfterMs: null, details: { source, target },
    });
  }
  fields[target] = value;
  delete fields[source];
}

function updateFields(kind: AsEntityKind, input: Record<string, Json>): Record<string, Json> {
  const fields = { ...input };
  aliasField(fields, "reviewVersion", "review_version");
  aliasField(fields, "reviewStatus", "review_status");
  if (kind === "dataflow") {
    aliasField(fields, "source_component_id", "from_component");
    aliasField(fields, "target_component_id", "to_component");
    aliasField(fields, "is_encrypted", "encrypted");
    aliasField(fields, "is_authenticated", "authenticated");
    aliasField(fields, "is_bidirectional", "bidirectional");
  }
  return fields;
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
    if (!this.#baseUrl.pathname.endsWith("/")) this.#baseUrl.pathname += "/";
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
    const url = new URL(routePath(route, parameters).replace(/^\/+/u, ""), this.#baseUrl);
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
    }, ctx?.signal, "assurance-studio");
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

  #pageNumberPages<T>(
    page: RemotePageRequest | undefined,
    ctx: RemoteCallContext | undefined,
    loadPage: (pageNumber: number, pageSize: number) => Promise<{
      items: T[];
      total: number | null;
      hasMore?: boolean;
    }>,
  ): AsyncIterable<RemotePage<T>> {
    let nextPageNumber = 1;
    let normalizedIndex = 0;
    const reset = () => {
      nextPageNumber = 1;
      normalizedIndex = 0;
    };
    const pagingDrift = (): RemoteError => new RemoteError(
      "Assurance Studio paging changed while resuming",
      {
        service: "assurance-studio", code: "AS_PAGING_DRIFT", status: null,
        retryable: false, retryAfterMs: null, details: null,
      },
    );

    return iterateRemotePages(page, ctx, {
      service: "assurance-studio", defaultPageSize: 50, maxPageSize: 200,
    }, async request => {
      if (request.index < normalizedIndex) reset();
      while (normalizedIndex < request.index) {
        const skipped = await loadPage(nextPageNumber, request.pageSize);
        const skippedHasMore = skipped.hasMore ?? (skipped.total === null
          ? skipped.items.length === request.pageSize
          : normalizedIndex + skipped.items.length < skipped.total);
        if (
          skipped.items.length === 0 ||
          normalizedIndex + skipped.items.length > request.index ||
          !skippedHasMore
        ) {
          throw pagingDrift();
        }
        normalizedIndex += skipped.items.length;
        nextPageNumber += 1;
      }
      if (normalizedIndex !== request.index) throw pagingDrift();

      const batch = await loadPage(nextPageNumber, request.pageSize);
      const startIndex = normalizedIndex;
      const hasMore = batch.hasMore ?? (batch.total === null
        ? batch.items.length === request.pageSize
        : startIndex + batch.items.length < batch.total);
      normalizedIndex += batch.items.length;
      nextPageNumber += 1;
      return { items: batch.items, total: batch.total, hasMore };
    });
  }

  listEntities(kind: AsEntityKind, input: { projectId: string; page?: RemotePageRequest; filters?: Record<string, Json> }, ctx?: RemoteCallContext): AsyncIterable<RemotePage<AsEntity>> {
    const route = entityCollectionRoute(kind, "GET");
    return this.#pageNumberPages(input.page, ctx, async (pageNumber, pageSize) => {
      const raw = await this.#json(route, { projectId: input.projectId }, {
        page: pageNumber, limit: pageSize,
        ...(input.filters ?? {}),
      }, undefined, ctx);
      const normalized = pagePayload(raw, AS_ENTITY_COLLECTION_KEYS[kind]);
      const items = normalized.items.map(item => normalizeEntity(kind, input.projectId, item));
      return { items, total: normalized.total, hasMore: normalized.hasMore };
    });
  }

  async getEntity(kind: AsEntityKind, input: { projectId: string; id: string }, ctx?: RemoteCallContext): Promise<AsEntity> {
    const [, idName] = AS_ENTITY_SEGMENTS[kind];
    const value = await this.#json(entityItemRoute(kind, "GET"), { projectId: input.projectId, [idName]: input.id }, {}, undefined, ctx);
    return normalizeEntity(kind, input.projectId, value);
  }

  async createEntity(kind: AsCreatableEntityKind, input: { projectId: string; fields: Record<string, Json> }, ctx?: RemoteCallContext): Promise<AsWriteResult> {
    const baseFields = { ...input.fields };
    aliasField(baseFields, "reviewStatus", "review_status");
    const requestedReview = baseFields.review_status;
    const desiredReview = reviewStatus(requestedReview);
    if (requestedReview !== undefined && desiredReview === null) {
      throw new RemoteError("Assurance Studio review status is invalid", {
        service: "assurance-studio", code: "AS_INVALID_REVIEW_STATUS", status: null,
        retryable: false, retryAfterMs: null, details: null,
      });
    }
    delete baseFields.review_status;
    const value = await this.#json(entityCollectionRoute(kind, "POST"), { projectId: input.projectId }, {}, createFields(kind, baseFields), ctx);
    let entity = normalizeEntity(kind, input.projectId, value);
    if (desiredReview === null) return { success: true, entity, reviewStatusSet: true, reviewStatusReason: null };
    if (!REVIEW_PATCH_KINDS.has(kind)) return {
      success: true, entity, reviewStatusSet: false,
      reviewStatusReason: "Assurance Studio does not accept review_status for this entity type",
    };
    if (entity.reviewVersion === null) return {
      success: true, entity, reviewStatusSet: false,
      reviewStatusReason: "Assurance Studio did not return the review version required for a safe PATCH",
    };
    try {
      const updated = await this.updateEntity(kind, {
        projectId: input.projectId,
        id: entity.id,
        fields: { review_status: desiredReview, review_version: entity.reviewVersion },
      }, ctx);
      entity = updated.entity;
      return { success: true, entity, reviewStatusSet: updated.reviewStatusSet, reviewStatusReason: updated.reviewStatusReason };
    } catch (error: unknown) {
      if (!(error instanceof RemoteError)) throw error;
      if (error.code === "REMOTE_ABORTED") throw error;
      try {
        const current = await this.getEntity(kind, { projectId: input.projectId, id: entity.id }, ctx);
        if (current.reviewStatus === desiredReview) return {
          success: true, entity: current, reviewStatusSet: true, reviewStatusReason: null,
        };
        entity = current;
      } catch (readError: unknown) {
        if (!(readError instanceof RemoteError)) throw readError;
        if (readError.code === "REMOTE_ABORTED") throw readError;
      }
      return {
        success: true,
        entity,
        reviewStatusSet: false,
        reviewStatusReason: error.code === "REMOTE_WRITE_INDETERMINATE"
          ? "Review status PATCH outcome is indeterminate; read-back did not confirm it"
          : "Review status PATCH failed after the entity was created",
      };
    }
  }

  async updateEntity(kind: AsEntityKind, input: { projectId: string; id: string; fields: Record<string, Json>; force?: boolean }, ctx?: RemoteCallContext): Promise<AsWriteResult> {
    const [, idName] = AS_ENTITY_SEGMENTS[kind];
    const fields = updateFields(kind, input.fields);
    const desiredReview = typeof fields.review_status === "string";
    if (desiredReview && !REVIEW_PATCH_KINDS.has(kind)) delete fields.review_status;
    const mutationFields = Object.keys(fields).filter(key => key !== "review_version");
    if (mutationFields.length > 0 && input.force !== true && stringValue(fields.review_version) === null) {
      throw new RemoteError("Assurance Studio PATCH requires a decimal review version or force=true", {
        service: "assurance-studio", code: "AS_REVIEW_VERSION_REQUIRED", status: null,
        retryable: false, retryAfterMs: null, details: null,
      });
    }
    const value = mutationFields.length === 0
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
    const itemKeys = route === ASSURANCE_STUDIO_ROUTES.listVerificationChecks
      ? ["checks", "verification_checks"]
      : ["packages", "sbom_packages"];
    return this.#pageNumberPages(input.page, ctx, async (pageNumber, pageSize) => {
      const raw = await this.#json(route, { projectId: input.projectId, id: input.projectId }, {
        page: pageNumber, limit: pageSize,
        ...(input.filters ?? {}),
      }, undefined, ctx);
      const normalized = pagePayload(raw, itemKeys);
      const items = normalized.items.map(object);
      return { items, total: normalized.total, hasMore: normalized.hasMore };
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
