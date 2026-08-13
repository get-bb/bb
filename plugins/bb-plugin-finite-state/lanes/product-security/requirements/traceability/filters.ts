import type { JsonValue } from "../../../../shared/contract.js";
import {
  earsPatternSchema,
  requirementEvidenceStateSchema,
  requirementIdSchema,
  requirementTypeSchema,
  verificationTierSchema,
  type EarsPattern,
  type RequirementEvidenceState,
  type VerificationTier,
} from "../cards/schema.js";

export interface RequirementFilters {
  text?: string;
  pattern?: EarsPattern[];
  reqType?: string[];
  priority?: string[];
  evidenceState?: RequirementEvidenceState[];
  stale?: boolean;
  tier?: VerificationTier;
  standardClause?: string;
  threat?: string;
  localOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface TraceabilityRouteState {
  view: "list" | "requirement";
  requirementId: string | null;
  filters: RequirementFilters;
  malformedId: string | null;
}

const MAX_MULTI_VALUES = 20;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function trimmed(value: string | null | undefined, maxLength = 512): string | undefined {
  const next = value?.trim();
  return next ? next.slice(0, maxLength) : undefined;
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].slice(0, MAX_MULTI_VALUES);
}

function parseMany<T extends string>(
  params: URLSearchParams,
  key: string,
  parse: (value: string) => T | null,
): T[] | undefined {
  const parsed = unique(params.getAll(key)).flatMap((value) => {
    const result = parse(value);
    return result === null ? [] : [result];
  });
  return parsed.length > 0 ? parsed : undefined;
}

function parseEnum<T extends string>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): (value: string) => T | null {
  return (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success && parsed.data !== undefined ? parsed.data : null;
  };
}

export function normalizeRequirementFilters(
  filters: RequirementFilters,
): RequirementFilters {
  const text = trimmed(filters.text, 500);
  const pattern = filters.pattern
    ? unique(filters.pattern).filter((value) => earsPatternSchema.safeParse(value).success)
    : [];
  const reqType = filters.reqType
    ? unique(filters.reqType.map((value) => value.trim())).filter((value) =>
        requirementTypeSchema.safeParse(value).success,
      )
    : [];
  const priority = filters.priority
    ? unique(filters.priority.map((value) => value.trim()).filter(Boolean))
    : [];
  const evidenceState = filters.evidenceState
    ? unique(filters.evidenceState).filter((value) =>
        requirementEvidenceStateSchema.safeParse(value).success,
      )
    : [];
  const standardClause = trimmed(filters.standardClause);
  const threat = trimmed(filters.threat);
  const cursor = trimmed(filters.cursor, 4096);
  const tier = verificationTierSchema.safeParse(filters.tier).success
    ? filters.tier
    : undefined;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isInteger(filters.limit) ? filters.limit ?? DEFAULT_LIMIT : DEFAULT_LIMIT),
  );
  return {
    ...(text ? { text } : {}),
    ...(pattern.length > 0 ? { pattern } : {}),
    ...(reqType.length > 0 ? { reqType } : {}),
    ...(priority.length > 0 ? { priority } : {}),
    ...(evidenceState.length > 0 ? { evidenceState } : {}),
    ...(filters.stale === true ? { stale: true } : {}),
    ...(tier ? { tier } : {}),
    ...(standardClause ? { standardClause } : {}),
    ...(threat ? { threat } : {}),
    ...(filters.localOnly === true ? { localOnly: true } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
  };
}

export function serializeRequirementFilters(filters: RequirementFilters): string {
  const normalized = normalizeRequirementFilters(filters);
  const params = new URLSearchParams();
  if (normalized.text) params.set("q", normalized.text);
  for (const value of normalized.pattern ?? []) params.append("pattern", value);
  for (const value of normalized.reqType ?? []) params.append("type", value);
  for (const value of normalized.priority ?? []) params.append("priority", value);
  for (const value of normalized.evidenceState ?? []) params.append("evidence", value);
  if (normalized.stale) params.set("stale", "1");
  if (normalized.tier) params.set("tier", normalized.tier);
  if (normalized.standardClause) params.set("clause", normalized.standardClause);
  if (normalized.threat) params.set("threat", normalized.threat);
  if (normalized.localOnly) params.set("local", "1");
  if (normalized.cursor) params.set("cursor", normalized.cursor);
  if (normalized.limit !== DEFAULT_LIMIT) params.set("limit", String(normalized.limit));
  return params.toString();
}

export function parseRequirementFilters(query: string): RequirementFilters {
  let decoded = query;
  try {
    decoded = decodeURIComponent(query);
  } catch {
    decoded = "";
  }
  const params = new URLSearchParams(decoded);
  const limitValue = Number(params.get("limit"));
  return normalizeRequirementFilters({
    text: trimmed(params.get("q"), 500),
    pattern: parseMany(params, "pattern", parseEnum(earsPatternSchema)),
    reqType: parseMany(params, "type", parseEnum(requirementTypeSchema)),
    priority: parseMany(params, "priority", (value) => trimmed(value, 100) ?? null),
    evidenceState: parseMany(
      params,
      "evidence",
      parseEnum(requirementEvidenceStateSchema),
    ),
    stale: params.get("stale") === "1" || undefined,
    tier: parseEnum(verificationTierSchema)(params.get("tier") ?? "") ?? undefined,
    standardClause: trimmed(params.get("clause")),
    threat: trimmed(params.get("threat")),
    localOnly: params.get("local") === "1" || undefined,
    cursor: trimmed(params.get("cursor"), 4096),
    limit: Number.isInteger(limitValue) && limitValue > 0 ? limitValue : DEFAULT_LIMIT,
  });
}

export function traceabilitySubPath(
  filters: RequirementFilters,
  requirementId?: string | null,
): string {
  const query = serializeRequirementFilters({ ...filters, cursor: undefined });
  const requirement = requirementId ? `/${requirementId}` : "";
  return `requirements/trace${requirement}${query ? `/${encodeURIComponent(query)}` : ""}`;
}

export function parseTraceabilityDetail(
  detail: readonly string[],
): TraceabilityRouteState {
  if (detail[0] !== "trace") {
    return {
      view: "requirement",
      requirementId: null,
      filters: normalizeRequirementFilters({}),
      malformedId: detail[0]?.slice(0, 512) ?? "",
    };
  }
  const candidateId = detail[1];
  let decodedCandidate = candidateId ?? "";
  try {
    decodedCandidate = decodeURIComponent(decodedCandidate);
  } catch {
    decodedCandidate = "";
  }
  if (candidateId === undefined || decodedCandidate.includes("=")) {
    const filters = parseRequirementFilters(candidateId ?? "");
    return { view: "list", requirementId: null, filters, malformedId: null };
  }
  const filters = parseRequirementFilters(detail[2] ?? "");
  const parsedId = requirementIdSchema.safeParse(candidateId);
  return parsedId.success
    ? { view: "requirement", requirementId: parsedId.data, filters, malformedId: null }
    : {
        view: "requirement",
        requirementId: null,
        filters,
        malformedId: candidateId.slice(0, 512),
      };
}

export function filtersToRpc(
  filters: RequirementFilters,
  requirementId?: string | null,
  refresh = false,
): Record<string, JsonValue> {
  const normalized = normalizeRequirementFilters(filters);
  return {
    view: "traceability",
    ...(normalized.text ? { text: normalized.text } : {}),
    ...(normalized.pattern ? { pattern: normalized.pattern } : {}),
    ...(normalized.reqType ? { reqType: normalized.reqType } : {}),
    ...(normalized.priority ? { priority: normalized.priority } : {}),
    ...(normalized.evidenceState ? { evidenceState: normalized.evidenceState } : {}),
    ...(normalized.stale ? { stale: true } : {}),
    ...(normalized.tier ? { tier: normalized.tier } : {}),
    ...(normalized.standardClause ? { standardClause: normalized.standardClause } : {}),
    ...(normalized.threat ? { threat: normalized.threat } : {}),
    ...(normalized.localOnly ? { localOnly: true } : {}),
    ...(requirementId ? { requirementId } : {}),
    ...(refresh ? { refresh: true } : {}),
  };
}

export function traceabilityRpcRequest(
  projectId: string,
  projectVersionId: string | null,
  filters: RequirementFilters,
  requirementId?: string | null,
  refresh = false,
) {
  const normalized = normalizeRequirementFilters(filters);
  return {
    projectId,
    projectVersionId,
    pageSize: normalized.limit ?? DEFAULT_LIMIT,
    continuation: normalized.cursor ?? null,
    filters: filtersToRpc(normalized, requirementId, refresh),
  };
}
